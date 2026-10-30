'use strict';
// Actual HTTP + Sharp + GridFS + Mongo transactions. Disposable loopback only.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path'), os = require('node:os'), net = require('node:net');
const mongoose = require('mongoose');
const storage = require('../services/storageService');
const Receipt = require('../models/PhotoUploadReceipt'), Attempt = require('../models/PhotoUploadAttempt');
const Trip = require('../models/Trip'), Recommendation = require('../models/Recommendation'), User = require('../models/User');
const service = require('../services/photoUploadIdempotency');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function gate() { let arrive, release; const entered = new Promise(r=>arrive=r), wait = new Promise(r=>release=r); return { entered, release, pause: async()=>{arrive(); await wait;} }; }
async function main() {
 assert(process.env.MONGOD_BINARY && path.isAbsolute(process.env.MONGOD_BINARY));
 assert(!existsSync(path.join(__dirname,'../.env')),'No live environment allowed');
 const dir=await mkdtemp(path.join(os.tmpdir(),'photo-retry-fixture-'));
 const portServer=net.createServer(); await new Promise(r=>portServer.listen(0,'127.0.0.1',r)); const port=portServer.address().port; await new Promise(r=>portServer.close(r));
 const standalone=process.env.PHOTO_RETRY_STANDALONE==='true';
 const child=spawn(process.env.MONGOD_BINARY,['--dbpath',dir,'--bind_ip','127.0.0.1','--port',String(port),'--nounixsocket',...(!standalone?['--replSet','photoRetry']:[]),'--wiredTigerCacheSizeGB','0.25'],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
 let logs='',boot,server,passed=0; child.stdout.on('data',c=>logs+=c); child.stderr.on('data',c=>logs+=c);
 const ok=label=>console.log(`PHOTO_RETRY_PASS ${++passed}: ${label}`);
 const originalUpload=storage.uploadFile;
 try {
  for(let n=0;n<150&&!logs.includes('Waiting for connections');n++){assert.equal(child.exitCode,null,logs);await sleep(100);}
  boot=new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`);await boot.connect();
  if(!standalone)await boot.db('admin').command({replSetInitiate:{_id:'photoRetry',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
  for(let n=0;n<150;n++){if((await boot.db('admin').command({hello:1})).isWritablePrimary)break;await sleep(100);}
  await boot.close();boot=null; await mongoose.connect(`mongodb://127.0.0.1:${port}/photo_retry_fixture${standalone?'':'?replicaSet=photoRetry'}`);
  await Promise.all([Receipt.init(),Attempt.init(),Trip.init(),Recommendation.init(),User.init(),require('../models/MobileTripDeletion').init(),require('../models/RecommendationDeletion').init()]);
  const owner=await User.create({username:'Synthetic photo owner',email:'photo-owner@example.com',password:'synthetic-fixture-password',isEmailVerified:true});
  const stranger=await User.create({username:'Synthetic photo stranger',email:'photo-stranger@example.com',password:'synthetic-fixture-password',isEmailVerified:true});
  process.env.JWT_SECRET='synthetic-photo-fixture-only';
  const jwt=require('jsonwebtoken'), token=jwt.sign({id:owner.id},process.env.JWT_SECRET), otherToken=jwt.sign({id:stranger.id},process.env.JWT_SECRET);
  const express=require('express'),app=express();app.use(express.json());
  app.use((req,res,next)=>{if(req.headers['x-fixture-drop-response'])res.json=()=>res.destroy();next();});
  app.use('/trips',require('../routes/tripRoutes'));app.use('/v2/recommendations',require('../routes/recommendationJsonRoute'));
  app.use((err,req,res,next)=>res.status(err.statusCode|| (res.statusCode>=400?res.statusCode:500)).json({message:err.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const sharp=require('sharp'); const bytes=await sharp({create:{width:8,height:8,channels:3,background:'#abcdef'}}).png().toBuffer();
  const different=await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toBuffer();
  const files=mongoose.connection.db.collection('gpxUploads.files');
  const makeTrip=()=>Trip.create({user:owner._id,title:'Synthetic trip',format:'json',durationMillis:1000,distanceMeters:1,defaultTripVisibility:'private'});
  const makeRec=trip=>Recommendation.create({user:owner._id,name:'Synthetic place',description:'Fixture',rating:3,primaryCategory:'OTHER',location:{type:'Point',coordinates:[0,0]},associatedTrip:trip?._id});
  const route=(kind,id)=>kind==='trip'?`/trips/${id}/photos`:`/v2/recommendations/${id}/photos`;
  async function upload(kind,id,key,opts={}) { const form=new FormData(); for(let i=0;i<(opts.count||1);i++)form.append('photos',new Blob([opts.bytes||bytes],{type:'image/png'}),'fixture.png');
   const response=await fetch(base+route(kind,id)+(opts.legacy?'':'/reliable'),{method:'POST',headers:{Authorization:`Bearer ${opts.token||token}`,...(key!==null?{'X-Photo-Upload-Id':key}:{}),...(opts.drop?{'X-Fixture-Drop-Response':'1'}:{})},body:form,signal:AbortSignal.timeout(20000)});
   return {status:response.status,body:await response.json()}; }
  async function remove(kind,id,photo) {const response=await fetch(base+route(kind,id)+'/'+photo,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});return {status:response.status,body:await response.json()};}
  if(standalone){const target=await makeTrip();assert.equal((await upload('trip',target.id,'standalone')).status,503);assert.equal((await Trip.findById(target.id)).photos.length,0);assert.equal(await Receipt.countDocuments({}),0);assert.equal(await files.countDocuments({}),0);ok('standalone fails closed before any receipt or file write');return;}
  for(const kind of ['trip','recommendation']) {
   const parent=await makeTrip(),target=kind==='trip'?parent:await makeRec(parent),model=kind==='trip'?Trip:Recommendation;
   await assert.rejects(upload(kind,target.id,'lost-response',{drop:true}));
   const retry=await upload(kind,target.id,'lost-response');assert.equal(retry.status,200,JSON.stringify(retry));assert.equal(retry.body.photoUploadId,'lost-response');assert.equal(retry.body.photoUploadProtocol,1);
   assert.deepEqual((await model.findById(target.id)).photos.map(String),retry.body.photoIds);assert.equal(await files.countDocuments({'metadata.photoReceipt':service.receiptId(owner.id,kind,target.id,'lost-response')}),1);
   const again=await upload(kind,target.id,'lost-response');assert.deepEqual(again.body,retry.body);
   assert.equal((await upload(kind,target.id,'lost-response',{bytes:different})).status,409);
   assert.equal((await upload(kind,target.id,'lost-response',{token:otherToken})).status,403);
   assert.equal((await remove(kind,target.id,retry.body.photoIds[0])).status,200);
   assert.equal((await upload(kind,target.id,'lost-response')).status,410);assert.equal((await model.findById(target.id)).photos.length,0);
   ok(`${kind}: lost response/replay/payload conflict/owner isolation/individual deletion`);
  }
  const target=await makeTrip();
  for(const key of [null,'','bad key','x'.repeat(129)])assert.equal((await upload('trip',target.id,key)).status,400);
  assert.equal((await upload('trip',target.id,'multi',{count:2})).status,400);
  assert.equal((await Trip.findById(target.id)).photos.length,0);ok('malformed or missing identities and multiple files fail before write');
  const concurrent=await Promise.all(Array.from({length:6},()=>upload('trip',target.id,'concurrent')));
  assert(concurrent.every(r=>r.status===200),JSON.stringify(concurrent));assert.equal(new Set(concurrent.map(r=>r.body.photoIds[0])).size,1);
  assert.equal((await Trip.findById(target.id)).photos.length,1);assert.equal(await files.countDocuments({'metadata.photoReceipt':service.receiptId(owner.id,'trip',target.id,'concurrent')}),1);ok('six concurrent same-key requests attach one canonical file and clean losers');
  // A stored file survives a synthetic crash/error before attachment and is reused.
  let crashed=false;storage.uploadFile=async(...args)=>{const id=await originalUpload(...args);if(!crashed){crashed=true;throw Error('Synthetic process interruption after stream completion');}return id;};
  assert.equal((await upload('trip',target.id,'stored-before-crash')).status,500);storage.uploadFile=originalUpload;
  const recovered=await upload('trip',target.id,'stored-before-crash');assert.equal(recovered.status,200);
  assert.equal(await files.countDocuments({'metadata.photoReceipt':service.receiptId(owner.id,'trip',target.id,'stored-before-crash')}),1);ok('completed pending candidate recovered without uploading another file');
  // Delete target while stream has finished but its transaction has not begun.
  for(const kind of ['trip','recommendation']) {
   const parent=await makeTrip(),item=kind==='trip'?parent:await makeRec(parent),pause=gate();
   storage.uploadFile=async(...args)=>{const id=await originalUpload(...args);await pause.pause();return id;};
   const pending=upload(kind,item.id,'delete-race');await pause.entered;
   if(kind==='trip')await require('../services/mobileTripDeletion').deleteTrip(item.id,owner.id);
   else await require('../services/recommendationDeletion').deleteRecommendation(item.id,owner.id);
   pause.release();const result=await pending;storage.uploadFile=originalUpload;assert.equal(result.status,410,JSON.stringify(result));
   // The existing deletion receipt owns late files; retry drains its durable queue.
   if(kind==='trip')await require('../services/mobileTripDeletion').deleteTrip(item.id,owner.id);
   else await require('../services/recommendationDeletion').deleteRecommendation(item.id,owner.id);
   assert.equal(await files.countDocuments({'metadata.photoReceipt':service.receiptId(owner.id,kind,item.id,'delete-race')}),0);ok(`${kind}: deletion between file storage and attachment prevents resurrection and cleans file`);
  }
  // A delayed concurrent loser must not recreate the canonical photo deleted
  // after the winning upload returned.
  {
   const item=await makeTrip(),pause=gate();let first=true;
   storage.uploadFile=async(...args)=>{const id=await originalUpload(...args);if(first){first=false;await pause.pause();}return id;};
   const pending=upload('trip',item.id,'loser-after-delete');await pause.entered;
   const winner=await upload('trip',item.id,'loser-after-delete');assert.equal(winner.status,200);
   assert.equal((await remove('trip',item.id,winner.body.photoIds[0])).status,200);
   pause.release();const loser=await pending;storage.uploadFile=originalUpload;assert.equal(loser.status,410);
   assert.equal((await Trip.findById(item.id)).photos.length,0);ok('delayed same-key request cannot resurrect individually deleted canonical photo');
  }
  // Force two DISTINCT candidate IDs: first request registers its ID but has
  // not stored a final file when second request wins; delete before loser commit.
  {
   const item=await makeTrip(),before=gate(),after=gate();let first=true,loserId;
   storage.uploadFile=async(...args)=>{if(first){first=false;loserId=args[4];await before.pause();const id=await originalUpload(...args);await after.pause();return id;}return originalUpload(...args);};
   const pending=upload('trip',item.id,'distinct-loser');await before.entered;
   const winner=await upload('trip',item.id,'distinct-loser');assert.equal(winner.status,200);assert.notEqual(winner.body.photoIds[0],loserId);
   before.release();await after.entered;assert.equal((await remove('trip',item.id,winner.body.photoIds[0])).status,200);
   after.release();const loser=await pending;storage.uploadFile=originalUpload;assert.equal(loser.status,410);
   assert.equal((await Trip.findById(item.id)).photos.length,0);assert.equal(await files.countDocuments({'metadata.photoReceipt':service.receiptId(owner.id,'trip',item.id,'distinct-loser')}),0);ok('distinct concurrent loser cannot attach after canonical photo deletion');
  }
  // A place upload also fences deletion of its associated parent trip.
  {
   const parent=await makeTrip(),item=await makeRec(parent),pause=gate();
   storage.uploadFile=async(...args)=>{const id=await originalUpload(...args);await pause.pause();return id;};
   const pending=upload('recommendation',item.id,'parent-deleted');await pause.entered;
   await require('../services/mobileTripDeletion').deleteTrip(parent.id,owner.id);pause.release();
   const response=await pending;storage.uploadFile=originalUpload;assert.equal(response.status,410);
   await require('../services/mobileTripDeletion').deleteTrip(parent.id,owner.id);
   assert.equal(await Recommendation.countDocuments({_id:item.id}),0);assert.equal(await files.countDocuments({'metadata.photoReceipt':service.receiptId(owner.id,'recommendation',item.id,'parent-deleted')}),0);ok('linked place upload cannot survive parent deletion');
  }
  // A failed storage cleanup must not reopen a receipt for replay/reattachment.
  {
   const item=await makeTrip(),uploaded=await upload('trip',item.id,'delete-cleanup-failure'),photo=uploaded.body.photoIds[0];
   await files.updateOne({_id:new mongoose.Types.ObjectId(photo)},{$set:{'metadata.userId':stranger.id}});
   assert.equal((await remove('trip',item.id,photo)).status,403);
   assert.equal((await upload('trip',item.id,'delete-cleanup-failure')).status,410);
   assert.equal((await Trip.findById(item.id)).photos.length,1);
   await files.updateOne({_id:new mongoose.Types.ObjectId(photo)},{$set:{'metadata.userId':owner.id}});
   assert.equal((await remove('trip',item.id,photo)).status,200);assert.equal((await Trip.findById(item.id)).photos.length,0);ok('failed deletion cleanup preserves reference and permanent receipt refusal until deletion retry');
  }
  {
   const item=await makeTrip();storage.uploadFile=async(...args)=>{await mongoose.connection.db.collection('gpxUploads.chunks').insertOne({files_id:new mongoose.Types.ObjectId(args[4]),n:0,data:Buffer.from('synthetic incomplete chunk')});throw Error('Synthetic process loss after partial chunk, before files document');};
   assert.equal((await upload('trip',item.id,'storage-failure')).status,500);assert.equal((await Trip.findById(item.id)).photos.length,0);
   storage.uploadFile=originalUpload;assert.equal((await upload('trip',item.id,'storage-failure')).status,200);
   assert.equal((await Trip.findById(item.id)).photos.length,1);
   // An attempt interrupted before the files document exists is retained, never
   // mistaken for a completed candidate or unsafely deleted as another stream.
   assert.equal(await Attempt.countDocuments({receipt:service.receiptId(owner.id,'trip',item.id,'storage-failure')}),1);ok('partial GridFS candidate is not recovered as complete; retry succeeds and unfinished attempt remains durable');
  }
  // Legacy callers still work without a key; reliable endpoint never falls back.
  const legacy=await upload('trip',target.id,null,{legacy:true});assert.equal(legacy.status,200);assert.equal(legacy.body.photoUploadProtocol,undefined);ok('legacy upload endpoint compatibility');
  assert.equal(await Attempt.countDocuments({}),1); console.log(`PHOTO_RETRY_DONE ${passed} groups`);
 } finally {storage.uploadFile=originalUpload;if(server)await new Promise(r=>server.close(r));if(boot)await boot.close();await mongoose.disconnect();child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await rm(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

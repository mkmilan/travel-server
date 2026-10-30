'use strict';
// Real standalone Mongo proves transaction requirements fail before destructive effects.
const assert=require('node:assert/strict'),{createRequire}=require('node:module'),{spawn}=require('node:child_process'),{once}=require('node:events'),fs=require('node:fs/promises'),net=require('node:net');
const path=require('node:path'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..');
const BINARY=process.env.MONGOD_BINARY;assert(BINARY && path.isAbsolute(BINARY),'Set MONGOD_BINARY to a verified official mongod');
assert.equal(process.argv.length,2);assert(!require('node:fs').existsSync(ROOT+'/.env'));
const req=createRequire(ROOT+'/package.json'),mongoose=req('mongoose'),storage=req('./services/storageService');
const Trip=req('./models/Trip'),Recommendation=req('./models/Recommendation'),User=req('./models/User'),Receipt=req('./models/RecommendationDeletion'),TripReceipt=req('./models/MobileTripDeletion');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){let child,logs='';const dir=await fs.mkdtemp(path.join(os.tmpdir(),'standalone-fail-closed-'));const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));
 try{
  child=spawn(BINARY,['--dbpath',dir,'--bind_ip','127.0.0.1','--port',String(p),'--nounixsocket','--wiredTigerCacheSizeGB','0.25'],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});for(const out of[child.stdout,child.stderr])out.on('data',x=>logs+=x);
  for(let n=0;n<100&&!logs.includes('Waiting for connections');n++){if(child.exitCode!==null)throw Error(logs);await sleep(100);}
  await mongoose.connect(`mongodb://127.0.0.1:${p}/standalone_fail_closed_fixture`,{serverSelectionTimeoutMS:5000});await Promise.all([Trip,Recommendation,User,Receipt,TripReceipt].map(m=>m.init()));
  const{uploadIndexes}=req('./services/uploadIdempotency');for(const[m,spec]of[[Trip,uploadIndexes.trip],[Recommendation,uploadIndexes.recommendation]]){const{key,...opts}=spec;await m.collection.createIndex(key,opts);}
  assert.equal((await mongoose.connection.db.admin().command({hello:1})).setName,undefined);
  const owner=await User.create({username:'Standalone Fixture',email:'standalone@example.com',password:'Synthetic-only-password',isEmailVerified:true});
  const body={uploadProtocol:1,uploadId:'standalone-recording',title:'Synthetic',startTime:'2026-01-01T00:00:00Z',segments:[{track:[{lat:1,lon:1,t:'2026-01-01T00:00:00Z'},{lat:1,lon:1.01,t:'2026-01-01T00:01:00Z'}]}],recommendations:[]};let result,error;
  await req('./controllers/tripJsonController').createRecordingUpload({user:owner,body},{status(){return this;},json(v){result=v;}},e=>{error=e;});assert.equal(error?.statusCode,503);assert.equal(result,undefined);assert.equal(await Trip.countDocuments(),0);assert.equal(await Recommendation.countDocuments(),0);
  console.log('STANDALONE_PASS recording upload returns 503 before trip/child creation without transaction support');
  const file=await storage.uploadFile(Buffer.from('Synthetic only'),'fixture.webp','image/webp',{userId:owner.id});
  const rec=await Recommendation.create({user:owner._id,name:'Synthetic retained place',description:'Fixture',rating:3,primaryCategory:'OTHER',location:{type:'Point',coordinates:[0,0]},photos:[file]});
  await assert.rejects(req('./services/recommendationDeletion').deleteRecommendation(rec.id,owner._id),{statusCode:503});assert(await Recommendation.exists({_id:rec._id}));assert.deepEqual((await Recommendation.findById(rec._id)).photos,[file]);assert.equal(await Receipt.countDocuments(),0);const id=new mongoose.Types.ObjectId(file);assert.equal(await mongoose.connection.db.collection('gpxUploads.files').countDocuments({_id:id}),1);assert.equal(await mongoose.connection.db.collection('gpxUploads.chunks').countDocuments({files_id:id}),1);
  console.log('STANDALONE_PASS place deletion returns 503 with original record/photo reference/file/chunks intact and no false deletion receipt');
  console.log('STANDALONE_FAIL_CLOSED_PASS 2 actual Mongo checks');
 }finally{await mongoose.disconnect();if(child?.pid&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await Promise.race([done,sleep(5000)]);if(child.exitCode===null){child.kill('SIGKILL');await done;}}await fs.rm(dir,{recursive:true,force:true});console.log('DISPOSABLE_STANDALONE_REMOVED',dir);}}
main().catch(e=>{console.error(e);process.exitCode=1;});

// Disposable real-Mongo proof for the narrower implementation. No external URI accepted.
const assert = require('node:assert/strict');
const {createRequire}=require('node:module');
const root=require('node:path').resolve(__dirname,'..');
const req=createRequire(root+'/package.json');
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const {once}=require('node:events');
const mongoose=req('mongoose');
const storage=req('./services/storageService'); // subscribe before real connection opens
const Trip=req('./models/Trip'),Recommendation=req('./models/Recommendation'),User=req('./models/User'),Receipt=req('./models/MobileTripDeletion');
const {createTripDeletionService}=req('./services/mobileTripDeletion');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){
 assert.equal(process.argv.length,2,'No arguments/remote URIs accepted');
 const binary=process.env.MONGOD_BINARY;
 assert(binary, 'Set MONGOD_BINARY to a locally verified official mongod executable');
 const p=await port(),dir=await fs.mkdtemp('/tmp/narrow-mongo-real-');
 let child,boot,spawnError,observedVersion,logs='',passed=0;
 const ok=label=>{passed++;console.log(`PROOF ${passed}: ${label}`);};
 try {
  child=spawn(binary,['--dbpath',dir,'--bind_ip','127.0.0.1','--port',String(p),'--nounixsocket','--replSet','narrowFixture','--wiredTigerCacheSizeGB','0.5'],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
  child.on('error',error=>{spawnError=error;});
  for(const s of [child.stdout,child.stderr])s.on('data',v=>logs+=v);
  for(let n=0;n<150&&!logs.includes('Waiting for connections');n++){if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error(logs);await wait(100);}
  boot=new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${p}/?directConnection=true`,{serverSelectionTimeoutMS:5000});
  await boot.connect();await boot.db('admin').command({replSetInitiate:{_id:'narrowFixture',members:[{_id:0,host:`127.0.0.1:${p}`}]}});
  let ready=false;for(let n=0;n<150;n++){if((await boot.db('admin').command({hello:1})).isWritablePrimary){ready=true;break;}await wait(100);}assert(ready);await boot.close();boot=null;
  await mongoose.connect(`mongodb://127.0.0.1:${p}/narrow_fixture?replicaSet=narrowFixture`,{serverSelectionTimeoutMS:5000});
  observedVersion=(await mongoose.connection.db.admin().command({buildInfo:1})).version;
  console.log('REAL MongoDB:',observedVersion,'replicaSet=narrowFixture loopback-only; binary provenance verified by caller');
  await Promise.all([Trip.init(),Recommendation.init(),User.init(),Receipt.init()]);
  const {uploadIndexes}=req('./services/uploadIdempotency');
  for(const [model,spec]of [[Trip,uploadIndexes.trip],[Recommendation,uploadIndexes.recommendation]])await model.collection.createIndex(spec.key,{name:spec.name,unique:spec.unique,partialFilterExpression:spec.partialFilterExpression});
  const owner=await User.create({username:'Narrow Synthetic Owner',email:'narrow-owner@example.com',password:'Synthetic-password-only',isEmailVerified:true});
  const foreign=await User.create({username:'Narrow Synthetic Foreign',email:'narrow-foreign@example.com',password:'Synthetic-password-only',isEmailVerified:true});
  const files=mongoose.connection.db.collection('gpxUploads.files'),chunks=mongoose.connection.db.collection('gpxUploads.chunks');
  const O=mongoose.Types.ObjectId;
  let failStorage=null;
  const service=createTripDeletionService({Trip,Recommendation,User,Receipt,connection:mongoose.connection,isValidId:mongoose.isObjectIdOrHexString,
   storage:{deleteFile:async(id,user)=>{if(id===failStorage)throw Error('Synthetic injected storage outage');return storage.deleteFile(id,user);}},
   findFile:id=>files.findOne({_id:new O(id)}),hasChunks:async id=>!!await chunks.findOne({files_id:new O(id)},{projection:{_id:1}})});
  const trip=(extra={})=>Trip.create({user:owner._id,title:'Synthetic narrow trip',format:'json',durationMillis:1000,distanceMeters:1,defaultTripVisibility:'private',...extra});
  const rec=(id,user=owner._id,photos=[])=>Recommendation.create({user,name:'Synthetic narrow rec',description:'Fixture only',rating:3,primaryCategory:'OTHER',location:{type:'Point',coordinates:[0,0]},associatedTrip:id,photos});
  const file=(user=owner.id)=>storage.uploadFile(Buffer.from('synthetic bytes only'),'fixture.webp','image/webp',{userId:user});
  const exists=id=>files.countDocuments({_id:new O(id)}),chunkCount=id=>chunks.countDocuments({files_id:new O(id)});
  // Identical bytes are independent fresh IDs in actual GridFS.
  const first=await file(),second=await file();assert.notEqual(first,second);assert.equal(await exists(first),1);assert.equal(await exists(second),1);
  await storage.deleteFile(first,owner._id);assert.equal(await exists(second),1);await storage.deleteFile(second,owner._id);ok('identical file content uploaded twice produces independent real GridFS IDs');
  const t=await trip(),survivor=await trip(),exclusive=await file(),shared=await file(),avatar=await file(),foreignFile=await file(foreign.id),childFile=await file();
  await Trip.updateOne({_id:t._id},{$set:{photos:[exclusive,shared,avatar,foreignFile]}});
  await Trip.updateOne({_id:survivor._id},{$set:{photos:[shared]}});
  await User.updateOne({_id:owner._id},{$set:{profilePictureUrl:avatar}});
  const ownRec=await rec(t._id,owner._id,[childFile]),foreignRec=await rec(t._id,foreign._id,[shared]);
  await assert.rejects(service.deleteTrip(t.id,foreign._id),{statusCode:404});assert(await Trip.exists({_id:t._id}));
  const r=await service.deleteTrip(t.id,owner._id);assert.deepEqual(r,{tripId:t.id,deleted:true,cleanupPending:false});
  assert.equal(await Trip.countDocuments({_id:t._id}),0);assert.equal(await Recommendation.countDocuments({_id:ownRec._id}),0);assert.equal(await Recommendation.countDocuments({_id:foreignRec._id}),1);
  for(const id of [exclusive,childFile]){assert.equal(await exists(id),0);assert.equal(await chunkCount(id),0);}
  for(const id of [shared,avatar,foreignFile]){assert.equal(await exists(id),1);assert.equal(await chunkCount(id),1);}
  await assert.rejects(service.deleteTrip(t.id,foreign._id),{statusCode:404});ok('real owner cascade removes exact owned children/files, preserves foreign records + surviving/shared/avatar/foreign files');
  // Force an exception AFTER Mongo actually deletes a trip inside the transaction.
  const rollback=await trip(),rollbackRec=await rec(rollback._id),rollbackFile=await file();await Trip.updateOne({_id:rollback._id},{$set:{photos:[rollbackFile]}});
  const originalDelete=Trip.deleteOne;
  Trip.deleteOne=async function(...args){const result=await originalDelete.apply(this,args);if(String(args[0]._id)===rollback.id)throw Error('Injected after real trip delete');return result;};
  try{await assert.rejects(service.deleteTrip(rollback.id,owner._id),/Injected after real trip delete/);}finally{Trip.deleteOne=originalDelete;}
  assert(await Trip.exists({_id:rollback._id}));assert(await Recommendation.exists({_id:rollbackRec._id}));assert.equal(await Receipt.countDocuments({_id:rollback._id}),0);assert.equal(await exists(rollbackFile),1);assert.equal(await chunkCount(rollbackFile),1);
  await service.deleteTrip(rollback.id,owner._id);ok('real metadata transaction rollback restores trip/children and prevents manifest/files deletion after injected post-delete failure');
  const pendingTrip=await trip(),pendingFile=await file();await Trip.updateOne({_id:pendingTrip._id},{$set:{photos:[pendingFile]}});failStorage=pendingFile;
  assert.equal((await service.deleteTrip(pendingTrip.id,owner._id)).cleanupPending,true);assert.equal(await Trip.countDocuments({_id:pendingTrip._id}),0);
  let pending=await Receipt.findById(pendingTrip._id).lean();assert.deepEqual(pending.pendingFiles,[pendingFile]);assert.equal(await exists(pendingFile),1);assert.equal(await chunkCount(pendingFile),1);
  assert.equal(await Receipt.countDocuments({user:owner._id,'pendingFiles.0':{$exists:true}}),1);
  failStorage=null;assert.equal((await service.deleteTrip(pendingTrip.id,owner._id)).cleanupPending,false);assert.equal(await exists(pendingFile),0);assert.equal(await chunkCount(pendingFile),0);ok('real durable file-outage pending receipt survives metadata deletion; owner retry deletes actual GridFS file/chunks');
  const late=await file();await service.addPendingFiles(pendingTrip.id,owner._id,[late]);assert.equal(await Receipt.countDocuments({_id:pendingTrip._id,user:owner._id,'pendingFiles.0':{$exists:true}}),1);await service.deleteTrip(pendingTrip.id,owner._id);assert.equal(await exists(late),0);ok('late known file reopens completed receipt and is discoverable by owner pending query');
  // Validate known preserved legacy storage boundaries rather than fake success claims.
  const noChunksTrip=await trip(),noChunks=await file();await chunks.deleteMany({files_id:new O(noChunks)});await Trip.updateOne({_id:noChunksTrip._id},{$set:{photos:[noChunks]}});assert.equal((await service.deleteTrip(noChunksTrip.id,owner._id)).cleanupPending,false);assert.equal(await exists(noChunks),0);ok('real existing file record with missing chunks deletes idempotently');
  const absentTrip=await trip(),absent=String(new O());await Trip.updateOne({_id:absentTrip._id},{$set:{photos:[absent]}});assert.equal((await service.deleteTrip(absentTrip.id,owner._id)).cleanupPending,false);ok('missing file and no chunks settles safely');
  const orphanTrip=await trip(),orphan=await file();await files.deleteOne({_id:new O(orphan)});await Trip.updateOne({_id:orphanTrip._id},{$set:{photos:[orphan]}});
  assert.equal((await service.deleteTrip(orphanTrip.id,owner._id)).cleanupPending,true);assert.equal(await chunkCount(orphan),1);
  assert.deepEqual((await Receipt.findById(orphanTrip._id).lean()).pendingFiles,[orphan]);
  assert.equal((await service.deleteTrip(orphanTrip.id,owner._id)).cleanupPending,true);assert.equal(await chunkCount(orphan),1);
  console.log('SAFE PENDING: missing GridFS file document + remaining exact chunks stays pending; no ownership guessed, storage review required.');ok('real missing-file/chunk case stays durable pending on repeat retry without deleting ambiguous chunks');
  const recording=req('./controllers/tripJsonController');
  const payload={uploadProtocol:1,uploadId:'narrow-real-recording',title:'Synthetic recording',startTime:'2026-01-01T00:00:00Z',defaultTripVisibility:'private',defaultTravelMode:'walking',segments:[{track:[{lat:1,lon:1,t:'2026-01-01T00:00:00Z'},{lat:1,lon:1.01,t:'2026-01-01T00:01:00Z'}]}],recommendations:[{uploadId:'child-1',name:'Fixture',description:'Synthetic only',latitude:1,longitude:1,primaryCategory:'OTHER'}]};
  const run=async(body,user=owner)=>{let status,result,failure;await recording.createRecordingUpload({body,user},{status(value){status=value;return this;},json(value){result=value;}},err=>{failure=err;});if(failure)throw failure;return{status,result};};
  const uploaded=await run(payload);assert.equal(uploaded.status,201);assert.equal(uploaded.result.uploadComplete,true);const recordedId=String(uploaded.result.trip._id);
  await service.deleteTrip(recordedId,owner._id);
  for(const body of [payload,{...payload,title:'Changed replay'}]){const blocked=await run(body);assert.equal(blocked.status,410);assert.equal(blocked.result.code,'TRIP_DELETED');assert.equal(blocked.result.tripId,recordedId);assert.equal(blocked.result.uploadId,payload.uploadId);}
  assert.equal(await Trip.countDocuments({user:owner._id,clientUploadId:payload.uploadId}),0);assert.equal(await Recommendation.countDocuments({associatedTrip:recordedId}),0);
  const tombstone=await Receipt.findById(recordedId).lean();assert.deepEqual(Object.keys(tombstone).filter(k=>!['_id','user','uploadId','pendingFiles','phase','createdAt','updatedAt','__v'].includes(k)),[]);
  assert.equal((await run(payload,foreign)).status,201);ok('actual recording controller rejects same/changed replay with 410 against real content-free owner-scoped tombstone');
  const racePayload={...payload,uploadId:'race-recording'};const preRace=await run(racePayload),raceId=String(preRace.result.trip._id);
  const originalFind=Trip.findOne;let injected=false;
  Trip.findOne=function(query,...args){if(!injected&&query.clientUploadId===racePayload.uploadId){injected=true;return service.deleteTrip(raceId,owner._id).then(()=>originalFind.call(this,query,...args));}return originalFind.call(this,query,...args);};
  let raced;try{raced=await run(racePayload);}finally{Trip.findOne=originalFind;}
  assert.equal(raced.status,410);assert.equal(raced.result.tripId,raceId);assert.equal(await Trip.countDocuments({user:owner._id,clientUploadId:racePayload.uploadId}),0);ok('actual recording controller compensates real recreation when deletion occurs after precheck before identity lookup');
  // Actual JSON controllers with real owned, foreign and legacy dangling links.
  const jsonRecommendations=req('./controllers/recommendationJsonController');
  const invokeRec=async(handler,recordId,body,user=owner)=>{
   let status,result;await handler({params:{recommendationId:recordId},body,user},{status(value){status=value;return this;},json(value){result=value;}},error=>{throw error;});return{status,result};
  };
  const ownedTarget=await trip(),foreignTarget=await trip({user:foreign._id}),missingTarget=new O();
  for(const oldTarget of [foreignTarget._id,missingTarget])for(const target of [null,ownedTarget.id]){
   const legacy=await rec(oldTarget);
   const repaired=await invokeRec(jsonRecommendations.updateRecommendationJson,legacy.id,{associatedTrip:target,name:'Repaired fixture'});
   assert.equal(repaired.status,200);const stored=await Recommendation.findById(legacy._id);assert.equal(stored.associatedTrip?.toString()||null,target);
  }
  ok('real owned legacy dangling/foreign-linked recommendations can explicitly detach or reassign to owned trip');
  const ordinary=await rec(ownedTarget._id);
  assert.equal((await invokeRec(jsonRecommendations.updateRecommendationJson,ordinary.id,{name:'Ordinary edit'})).status,200);
  const createData={name:'Standalone fixture',description:'Synthetic only',latitude:0,longitude:0,primaryCategory:'OTHER'};
  for(const target of [null,ownedTarget.id])assert.equal((await invokeRec(jsonRecommendations.createSingleRecommendationJson,null,{...createData,associatedTrip:target})).status,201);
  for(const [target,status]of [['invalid',400],[foreignTarget.id,404],[String(missingTarget),404]]){
   assert.equal((await invokeRec(jsonRecommendations.updateRecommendationJson,ordinary.id,{associatedTrip:target})).status,status);
   assert.equal((await invokeRec(jsonRecommendations.createSingleRecommendationJson,null,{...createData,associatedTrip:target})).status,status);
  }
  assert.equal((await invokeRec(jsonRecommendations.updateRecommendationJson,ordinary.id,{associatedTrip:null},foreign)).status,403);
  assert.equal(String((await Recommendation.findById(ordinary._id)).associatedTrip),ownedTarget.id);
  ok('actual JSON create/edit controllers preserve ordinary writes, reject forbidden targets with 400/404 and enforce recommendation ownership');
  const gpx=await trip({format:'gpx',gpxFileRef:'synthetic-reference',startDate:new Date(),endDate:new Date()});await assert.rejects(service.deleteTrip(gpx.id,owner._id),{statusCode:409});assert(await Trip.exists({_id:gpx._id}));ok('GPX rejected unchanged by mobile permanent deletion');
  console.log(`REAL_MONGO_PROOF_PASS ${passed} checks; observed MongoDB ${observedVersion}; disposable single-node replica only; no HTTP/device/process-kill isolation claim.`);
 } finally {
  if(boot)await boot.close();
  await mongoose.disconnect();
  if(child&&child.pid&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await Promise.race([exited,wait(5000)]);if(child.exitCode===null){child.kill('SIGKILL');await exited;}}
  await fs.rm(dir,{recursive:true,force:true});console.log('DISPOSABLE_DATABASE_REMOVED',dir);
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

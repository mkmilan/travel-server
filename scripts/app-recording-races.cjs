'use strict';
// Actual DB/transactions, instrumented boundaries only. No external URI accepted.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),net=require('node:net');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{createRequire}=require('node:module');
assert.equal(process.argv.length,2);
const ROOT=path.resolve(__dirname,'..');
const os=require('node:os');
const req=createRequire(ROOT+'/package.json'),mongoose=req('mongoose');
const storage=req('./services/storageService');
const Trip=req('./models/Trip'),Recommendation=req('./models/Recommendation'),User=req('./models/User');
const TripDeletion=req('./models/MobileTripDeletion'),RecommendationDeletion=req('./models/RecommendationDeletion');
const upload=req('./services/recordingUpload'),places=req('./services/recommendationDeletion'),trips=req('./services/mobileTripDeletion');
const controller=req('./controllers/tripJsonController');
const {fingerprint,uploadIndexes}=req('./services/uploadIdempotency');
const BINARY=process.env.MONGOD_BINARY;
assert(BINARY && path.isAbsolute(BINARY),'Set MONGOD_BINARY to a verified official mongod');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function gate(){let entered,release;const reached=new Promise(r=>entered=r),opened=new Promise(r=>release=r);return{reached,release,pause:async()=>{entered();await opened;}};}
async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out: '+label)),15000)})]);}finally{clearTimeout(timer);}}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
let passed=0;const ok=label=>console.log(`RECORDING_RACE_PROOF ${++passed}: ${label}`);
function payload(key){return{uploadProtocol:1,uploadId:key,title:'Synthetic recording race',startTime:'2026-01-01T00:00:00Z',defaultTripVisibility:'private',defaultTravelMode:'walking',segments:[{track:[{lat:1,lon:1,t:'2026-01-01T00:00:00Z'},{lat:1,lon:1.01,t:'2026-01-01T00:01:00Z'}]}],recommendations:[{uploadId:'child-1',name:'Synthetic place',description:'No real data',latitude:1,longitude:1,primaryCategory:'OTHER'}]};}
async function main(){
 assert.equal(require('node:fs').existsSync(path.join(ROOT,'.env')),false,'No dotenv file permitted');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'recording-race-proof-')),p=await port();let child,boot,logs='';
 try{
  child=spawn(BINARY,['--dbpath',dir,'--bind_ip','127.0.0.1','--port',String(p),'--nounixsocket','--replSet','recordingRaceProof','--wiredTigerCacheSizeGB','0.25'],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
  for(const s of[child.stdout,child.stderr])s.on('data',x=>logs+=x);
  for(let n=0;n<150&&!logs.includes('Waiting for connections');n++){if(child.exitCode!==null)throw Error(logs);await sleep(100);}
  boot=new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${p}/?directConnection=true`,{serverSelectionTimeoutMS:5000});await boot.connect();
  await boot.db('admin').command({replSetInitiate:{_id:'recordingRaceProof',members:[{_id:0,host:`127.0.0.1:${p}`}]}});
  let ready=false;for(let n=0;n<150;n++){if((await boot.db('admin').command({hello:1})).isWritablePrimary){ready=true;break;}await sleep(100);}assert(ready);await boot.close();boot=null;
  await mongoose.connect(`mongodb://127.0.0.1:${p}/recording_race_fixture?replicaSet=recordingRaceProof`,{serverSelectionTimeoutMS:5000});
  console.log('SOURCE_ROOT',ROOT,'MONGO_VERSION',(await mongoose.connection.db.admin().command({buildInfo:1})).version);
  await Promise.all([Trip,Recommendation,User,TripDeletion,RecommendationDeletion].map(model=>model.init()));
  for(const[model,spec]of[[Trip,uploadIndexes.trip],[Recommendation,uploadIndexes.recommendation]]){const{key,...opts}=spec;await model.collection.createIndex(key,opts);}
  const owner=await User.create({username:'Race Fixture Owner',email:'recording-race@example.com',password:'Fixture-only-password',isEmailVerified:true});
  const makeTrip=(extra={})=>Trip.create({user:owner._id,title:'Synthetic partial parent',format:'json',durationMillis:1000,distanceMeters:1,defaultTripVisibility:'private',uploadComplete:false,...extra});
  const childData=(parent,key='child-1')=>({user:owner._id,associatedTrip:parent._id,clientUploadId:key,name:'Synthetic place',description:'No real data',rating:3,primaryCategory:'OTHER',location:{type:'Point',coordinates:[1,1]},photos:[],source:'TRACKING'});
  const outcome=(record,key='child-1')=>({id:record._id,uploadId:key,name:record.name,status:'created'});
  const invoke=async (body,user=owner)=>{let status,result,error;await controller.createRecordingUpload({body,user},{status(s){status=s;return this;},json(v){result=v;}},e=>{error=e;});if(error)throw error;return{status,result};};
  // A stale OUTER document survives a canonical completion and intentional deletion.
  {
   const body=payload('stale-outer'),parent=await makeTrip({clientUploadId:body.uploadId,uploadFingerprint:fingerprint(body)}),g=gate(),original=Trip.findOne;let paused=false;
   Trip.findOne=function(filter,...args){const q=original.call(this,filter,...args);if(filter.clientUploadId===body.uploadId&&!paused){paused=true;const exec=q.exec;q.exec=async function(...a){const stale=await exec.apply(this,a);assert.equal(stale.uploadComplete,false);await g.pause();return stale;};}return q;};
   let stale;
   try{stale=invoke(body);stale.catch(()=>{});await bounded(g.reached,'outer snapshot');const canonical=await invoke(body);assert.equal(canonical.result.uploadComplete,true);const id=canonical.result.recommendationsOutcome[0].id;assert(await Recommendation.exists({_id:id}));await places.deleteRecommendation(id,owner._id);assert.equal(await Recommendation.countDocuments({_id:id}),0);g.release();const resumed=await bounded(stale,'outer resume');assert.equal(resumed.result.uploadComplete,true);assert.equal(String(resumed.result.recommendationsOutcome[0].id),String(id));assert.equal(await Recommendation.countDocuments({associatedTrip:parent._id}),0);assert.equal((await Trip.findById(parent._id)).uploadReceipt.length,1);}
   finally{g.release();Trip.findOne=original;}
   ok('actual recording controller stale outer false snapshot replays canonical completed receipt after actual owner child deletion; no resurrection');
  }
  // A stale TRANSACTION snapshot must conflict on a real parent write, retry, and see completion.
  {
   const parent=await makeTrip(),data=childData(parent),g=gate(),original=Trip.updateOne;let paused=false,conflicts=0;
   Trip.updateOne=async function(filter,update,options){if(String(filter._id)===parent.id&&update.$inc?.uploadWriteVersion&&options?.session&&!paused){paused=true;await g.pause();}try{return await original.call(this,filter,update,options);}catch(e){if(e.code===112||e.hasErrorLabel?.('TransientTransactionError'))conflicts++;throw e;}};
   let stale;
   try{stale=upload.createChild(data);stale.catch(()=>{});await bounded(g.reached,'transaction stale parent');const canonical=await upload.createChild(data);await upload.finish(parent._id,owner._id,[outcome(canonical.record)],1);await places.deleteRecommendation(canonical.record._id,owner._id);g.release();const resumed=await bounded(stale,'transaction retry');assert(conflicts>=1,'must observe real Mongo transaction write conflict');assert.equal(String(resumed.outcome.id),canonical.record.id);assert.equal(await Recommendation.countDocuments({associatedTrip:parent._id}),0);assert.equal(String((await Trip.findById(parent._id)).uploadReceipt[0].id),canonical.record.id);}
   finally{g.release();Trip.updateOne=original;}
   ok(`real stale parent transaction observes Mongo write conflict and retries to completed old receipt (${conflicts} conflict); deleted child remains absent`);
  }
  // Failure after real child insertion must roll back child + parent fence, not fake the write.
  {
   const parent=await makeTrip(),before=await Trip.findById(parent._id).lean(),data=childData(parent,'rollback-child'),original=Recommendation.create;
   Recommendation.create=async function(rows,options){const saved=await original.call(this,rows,options);if(Array.isArray(rows)&&rows[0]?.clientUploadId==='rollback-child')throw Error('Injected after actual child insertion');return saved;};
   try{await assert.rejects(upload.createChild(data),/Injected after actual child insertion/);}finally{Recommendation.create=original;}
   assert.equal(await Recommendation.countDocuments({associatedTrip:parent._id}),0);assert.equal((await Trip.findById(parent._id)).uploadWriteVersion,before.uploadWriteVersion);assert((await upload.createChild(data)).record);ok('injected failure after real transactional child insert rolls back both child and parent version; clean retry succeeds');
  }
  // Partial upload tombstone before retry, then finish sibling upload without reviving deleted child.
  {
   const parent=await makeTrip(),data=childData(parent),first=await upload.createChild(data);await places.deleteRecommendation(first.record._id,owner._id);
   const retry=await upload.createChild(data);assert.equal(String(retry.outcome.id),first.record.id);assert.equal(await Recommendation.countDocuments({associatedTrip:parent._id}),0);assert.equal((await upload.finish(parent._id,owner._id,[retry.outcome],2)).uploadComplete,false);
   const sibling=await upload.createChild(childData(parent,'child-2'));assert.equal((await upload.finish(parent._id,owner._id,[retry.outcome,outcome(sibling.record,'child-2')],2)).uploadComplete,true);assert.equal(await Recommendation.countDocuments({associatedTrip:parent._id}),1);assert.equal(await Recommendation.countDocuments({_id:first.record._id}),0);ok('partial-upload child deletion remains intentional across retry; sibling completion stores original deleted-child identity without resurrection');
  }
  // Retry reads a partial parent first; intentional deletion commits before its fence.
  {
   const parent=await makeTrip(),data=childData(parent),first=await upload.createChild(data),g=gate(),original=Trip.updateOne;let paused=false,conflicts=0;
   Trip.updateOne=async function(filter,update,options){if(String(filter._id)===parent.id&&filter.uploadComplete&&options?.session&&!paused){paused=true;await g.pause();}try{return await original.call(this,filter,update,options);}catch(e){if(e.code===112||e.hasErrorLabel?.('TransientTransactionError'))conflicts++;throw e;}};
   try{const retry=upload.createChild(data);retry.catch(()=>{});await bounded(g.reached,'partial stale retry');await places.deleteRecommendation(first.record._id,owner._id);g.release();const result=await bounded(retry,'partial deletion retry');assert(conflicts>=1);assert.equal(String(result.outcome.id),first.record.id);assert.equal(await Recommendation.countDocuments({associatedTrip:parent._id}),0);assert(await RecommendationDeletion.exists({_id:first.record._id}));}finally{g.release();Trip.updateOne=original;}
   ok(`partial retry vs actual child deletion is fenced across real Mongo write conflict (${conflicts}); durable child deletion receipt wins`);
  }
  // Opposite ordering: retry holds its real parent write; delete starts with old snapshot.
  {
   const parent=await makeTrip(),data=childData(parent),first=await upload.createChild(data),g=gate(),deleteStarted=gate(),find=Recommendation.findOne,update=Trip.updateOne;let paused=false,deleteSeen=false,conflicts=0;
   Recommendation.findOne=function(filter,...args){const q=find.call(this,filter,...args);if(String(filter.associatedTrip)===parent.id&&!paused){const exec=q.exec;q.exec=async function(...a){const result=await exec.apply(this,a);if(this.getOptions().session&&!paused){paused=true;await g.pause();}return result;};}return q;};
   Trip.updateOne=async function(filter,changes,options){if(String(filter._id)===parent.id&&!filter.uploadComplete&&options?.session&&!deleteSeen){deleteSeen=true;deleteStarted.release();}try{return await update.call(this,filter,changes,options);}catch(e){if(e.code===112||e.hasErrorLabel?.('TransientTransactionError'))conflicts++;throw e;}};
   try{const retry=upload.createChild(data);retry.catch(()=>{});await bounded(g.reached,'retry holds parent fence');const deletion=places.deleteRecommendation(first.record._id,owner._id);deletion.catch(()=>{}); // deletion waits/retries while parent transaction owns its write
    for(let n=0;n<150&&!deleteSeen;n++)await sleep(10);assert(deleteSeen,'delete reached actual parent fence');g.release();assert.equal((await bounded(retry,'first partial retry')).record.id,first.record.id);await bounded(deletion,'delete after retry');const after=await upload.createChild(data);assert.equal(String(after.outcome.id),first.record.id);assert.equal(await Recommendation.countDocuments({associatedTrip:parent._id}),0);
   }finally{g.release();Recommendation.findOne=find;Trip.updateOne=update;}
   ok(`opposite partial ordering: retry commits before waiting/retried owner delete; all later retries honor deletion (${conflicts} observed conflicts)`);
  }
  // Full app controller contract: partial upload -> actual child-delete controller -> upload retry.
  {
   const body=payload('controller-partial-delete');body.recommendations.push({...body.recommendations[0],uploadId:'child-2'});
   const original=Recommendation.create;let fail=true;
   Recommendation.create=async function(rows,...args){if((Array.isArray(rows)?rows[0]:rows).clientUploadId==='child-2'&&fail){fail=false;throw Error('Synthetic second child transient failure');}return original.call(this,rows,...args);};
   let first;try{first=await invoke(body);}finally{Recommendation.create=original;}
   assert.equal(first.status,201);assert.equal(first.result.uploadComplete,false);const parentId=first.result.trip._id,old=first.result.recommendationsOutcome.find(x=>x.uploadId==='child-1').id;
   assert.equal(await Recommendation.countDocuments({associatedTrip:parentId}),1);let status,result,error;
   await req('./controllers/recommendationJsonController').deleteRecommendationJson({params:{recommendationId:String(old)},user:owner},{status(s){status=s;return this;},json(v){result=v;},send(){}},e=>{error=e;});if(error)throw error;
   assert.equal(status,200);assert.equal(result.deletedPhotosCount,0);assert.equal(await Recommendation.countDocuments({associatedTrip:parentId}),0);
   const retry=await invoke(body);assert.equal(retry.result.uploadComplete,true);assert.equal(String(retry.result.recommendationsOutcome.find(x=>x.uploadId==='child-1').id),String(old));
   const remaining=await Recommendation.find({associatedTrip:parentId});assert.equal(remaining.length,1);assert.equal(remaining[0].clientUploadId,'child-2');assert.equal(await Recommendation.countDocuments({_id:old}),0);assert.equal((await Trip.findById(parentId)).uploadReceipt.length,2);
   ok('full controllers: partial two-child upload, intentional successful child deletion, then retry creates only missing child and returns original deleted identity');
   // Same owner/different parent must not reuse another trip's child tombstone.
   const differentTrip=await invoke({...body,uploadId:'controller-isolated-trip'});assert.equal(differentTrip.result.uploadComplete,true);assert.notEqual(String(differentTrip.result.trip._id),String(parentId));assert.equal(await Recommendation.countDocuments({associatedTrip:differentTrip.result.trip._id}),2);assert.notEqual(String(differentTrip.result.recommendationsOutcome[0].id),String(old));
   // Same upload + child identities under a different owner remain independent.
   const other=await User.create({username:'Other Race Owner',email:'other-recording-race@example.com',password:'Fixture-only-password',isEmailVerified:true});
   const differentOwner=await invoke(body,other);assert.equal(differentOwner.result.uploadComplete,true);assert.notEqual(String(differentOwner.result.trip._id),String(parentId));assert.equal(await Recommendation.countDocuments({associatedTrip:differentOwner.result.trip._id,user:other._id}),2);assert.notEqual(String(differentOwner.result.recommendationsOutcome[0].id),String(old));
   await assert.rejects(upload.createChild({...childData({_id:parentId}),user:other._id}),{statusCode:404});assert.equal(await Recommendation.countDocuments({_id:old}),0);
   ok('actual full-controller retries isolate deletion identities by both parent and owner; foreign-owner access to original parent rejects without resurrection');
  }
  // Trip deletion between completion and finish read must return app's 410 tombstone.
  {
   const body=payload('finish-deletion-race'),canonical=await invoke(body),id=canonical.result.trip._id,originalFinish=upload.finish,originalFind=Trip.findOne;let inFinish=false,injected=false;
   upload.finish=async function(...args){inFinish=true;try{return await originalFinish(...args);}finally{inFinish=false;}};
   Trip.findOne=function(filter,...args){const q=originalFind.call(this,filter,...args);if(inFinish&&String(filter._id)===String(id)&&!injected){const exec=q.exec;q.exec=async function(...a){if(!this.getOptions().session&&!injected){injected=true;await trips.deleteTrip(id,owner._id);}return exec.apply(this,a);};}return q;};
   try{const result=await invoke(body);assert(injected);assert.equal(result.status,410);assert.equal(result.result.code,'TRIP_DELETED');assert.equal(result.result.tripId,String(id));assert.equal(await Trip.countDocuments({_id:id}),0);assert.equal(await Recommendation.countDocuments({associatedTrip:id}),0);}finally{upload.finish=originalFinish;Trip.findOne=originalFind;}
   ok('actual controller returns 410 TRIP_DELETED when whole-trip delete commits between finish write and parent lookup, not ambiguous 404');
  }
  console.log(`RECORDING_RACES_PASS ${passed} deterministic actual-Mongo checks`);
 }finally{
  if(boot)await boot.close();await mongoose.disconnect();
  if(child?.pid&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await Promise.race([exit,sleep(5000)]);if(child.exitCode===null){child.kill('SIGKILL');await exit;}}
  await fs.rm(dir,{recursive:true,force:true});console.log('DISPOSABLE_RECORDING_RACE_DATABASE_REMOVED',dir);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

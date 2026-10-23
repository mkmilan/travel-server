// Disposable loopback Mongo only. No production URI or dotenv support.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const os=require('node:os'),path=require('node:path'),net=require('node:net');
const mongoose=require('mongoose');
const {uploadIndexes}=require('../services/uploadIdempotency');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 assert(process.env.MONGOD_BINARY,'Set MONGOD_BINARY to an official MongoDB binary');
 const dir=await mkdtemp(path.join(os.tmpdir(),'recording-upload-mongo-')),port=await freePort();
 const mongo=spawn(process.env.MONGOD_BINARY,['--dbpath',dir,'--bind_ip','127.0.0.1','--port',String(port),'--nounixsocket','--wiredTigerCacheSizeGB','0.25'],{stdio:['ignore','pipe','pipe']});let logs='';mongo.stdout.on('data',b=>logs+=b);mongo.stderr.on('data',b=>logs+=b);
 try{
  for(let i=0;i<100&&!logs.includes('Waiting for connections');i++){if(mongo.exitCode!==null)throw Error(logs.slice(-1200));await sleep(100);}
  await mongoose.connect(`mongodb://127.0.0.1:${port}/disposable_upload_fixture`,{autoIndex:false,serverSelectionTimeoutMS:5000});
  const Trip=require('../models/Trip'),Recommendation=require('../models/Recommendation'),User=require('../models/User');
  await Promise.all([Trip.createCollection(),Recommendation.createCollection(),User.createCollection()]);
  const {createRecordingUpload}=require('../controllers/tripJsonController');
  const owner=new mongoose.Types.ObjectId(),other=new mongoose.Types.ObjectId();
  const make=(uploadId='fixture-trip')=>({uploadProtocol:1,uploadId,title:'Synthetic route',startTime:'2026-01-01T00:00:00Z',defaultTripVisibility:'private',defaultTravelMode:'walking',segments:[{track:[{lat:1,lon:1,t:'2026-01-01T00:00:00Z'},{lat:1,lon:1.01,t:'2026-01-01T00:01:00Z'}]}],recommendations:[{uploadId:'1',name:'Synthetic',description:'Fixture only',latitude:1,longitude:1,primaryCategory:'OTHER'}]});
  const run=async(body=make(),user=owner)=>{let status,result,failure;await createRecordingUpload({user:{_id:user},body},{status(s){status=s;return this},json(v){result=v}},e=>failure=e);if(failure)throw failure;return{status,result};};
  await assert.rejects(run(),{statusCode:503});assert.equal(await Trip.countDocuments(),0);
  for(const[model,definition]of[[Trip,uploadIndexes.trip],[Recommendation,uploadIndexes.recommendation]]){const{key,...options}=definition;await model.collection.createIndex(key,options);}
  const results=await Promise.all(Array.from({length:12},()=>run()));assert.equal(await Trip.countDocuments(),1);assert.equal(await Recommendation.countDocuments(),1);assert.ok(results.every(r=>r.result.uploadComplete));
  await run();assert.equal(await Trip.countDocuments(),1);assert.equal(await Recommendation.countDocuments(),1);
  await run(make(),other);assert.equal(await Trip.countDocuments(),2);assert.equal(await Recommendation.countDocuments(),2);
  await assert.rejects(run({...make(),title:'Changed'}),{statusCode:409});
  const partial=make('partial-trip');partial.recommendations.push({...partial.recommendations[0],uploadId:'2'});const original=Recommendation.create;let fail=true;Recommendation.create=async function(data){if(data.clientUploadId==='2'&&fail){fail=false;throw Error('Synthetic transient failure');}return original.call(this,data);};
  try{const first=await run(partial);assert.equal(first.result.uploadComplete,false);assert.equal(await Recommendation.countDocuments({associatedTrip:first.result.trip._id}),1);const retry=await run(partial);assert.equal(retry.result.uploadComplete,true);assert.equal(await Recommendation.countDocuments({associatedTrip:first.result.trip._id}),2);}finally{Recommendation.create=original;}
  const invalid=make('invalid-trip');invalid.recommendations[0].attributeTags=['INVALID'];const rejected=await run(invalid);assert.equal(rejected.status,400);assert.equal(rejected.result.uploadRejected,true);assert.equal(await Trip.countDocuments({clientUploadId:'invalid-trip'}),0);
  console.log('PASS real Mongo: missing-index fail-closed, 12 concurrent uploads, response-loss replay, owner isolation, changed-key conflict, partial-child retry, deterministic rejection.');
 }finally{await mongoose.disconnect();if(mongo.exitCode===null){mongo.kill('SIGTERM');await new Promise(r=>mongo.once('exit',r));}await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});

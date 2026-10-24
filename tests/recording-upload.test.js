const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { uploadIndexes } = require('../services/uploadIdempotency');
const { createTripWriteGuard } = require('../services/mobileTripWriteGuard');
function load(file, stubs) {
 const filename = path.resolve(__dirname, '..', file), realRequire = createRequire(filename), module = { exports: {} };
 vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: id => Object.hasOwn(stubs,id) ? stubs[id] : realRequire(id), console: {log(){},warn(){},error(){}}, process, Buffer }, {filename});
 return module.exports;
}
const owner = 'a'.repeat(24), other = 'b'.repeat(24);
const payload = () => ({uploadProtocol:1,uploadId:'recording-1',title:'Synthetic',startTime:'2026-01-01T00:00:00Z',defaultTripVisibility:'private',defaultTravelMode:'walking',segments:[{track:[{lat:1,lon:1,t:'2026-01-01T00:00:00Z'},{lat:1,lon:1.01,t:'2026-01-01T00:01:00Z'}]}],recommendations:[{uploadId:'1',name:'Fixture',description:'Synthetic fixture',latitude:1,longitude:1,primaryCategory:'OTHER'}]});
function fixture() {
 const trips=[],recs=[],receipts=[];let sequence=0,failChild=0,indexesPresent=true,deleteOnLookup=false;
 const markDeleted=()=>{const trip=trips[0];receipts.push({_id:trip._id,user:trip.user,uploadId:trip.clientUploadId,pendingFiles:[]});trips.splice(0);recs.splice(0);};
 const matches=(row,query)=>Object.entries(query).every(([key,value])=>value?.$in ? value.$in.map(String).includes(String(row[key])) : String(row[key])===String(value));
 const model=(rows,definition)=>Object.assign(function(data){return new (rows===trips ? require('../models/Trip') : require('../models/Recommendation'))(data)}, {
  collection:{listIndexes:()=>({toArray:async()=>indexesPresent?[definition]:[]})},
  schema:{path:()=>({enumValues:['OTHER'],defaultValue:'private'})},
  validate: data => (rows===trips ? require('../models/Trip') : require('../models/Recommendation')).validate(data),
  findOne:async query=>{if(rows===trips && query.clientUploadId && deleteOnLookup){deleteOnLookup=false;markDeleted();}return rows.find(row=>matches(row,query));},
  find:async query=>rows.filter(row=>matches(row,query)),
  exists:async query=>rows.some(row=>matches(row,query)),
  deleteMany:async query=>{let n=0;for(let i=rows.length-1;i>=0;i--)if(matches(rows[i],query)){rows.splice(i,1);n++;}return {deletedCount:n};},
  deleteOne:async query=>{const i=rows.findIndex(row=>matches(row,query));if(i<0)return {deletedCount:0};rows.splice(i,1);return {deletedCount:1};},
  create:async data=>{
   if(rows===recs && failChild-- > 0) throw Error('Synthetic recommendation failure');
   if(data.clientUploadId && rows.some(row=>row.clientUploadId===data.clientUploadId && row.user===data.user && (rows===trips || row.associatedTrip===data.associatedTrip))) throw Object.assign(Error('duplicate'),{code:11000});
   const row={...data,_id:(++sequence).toString(16).padStart(24,'0')};rows.push(row);return row;
  },
  updateOne:async(query,update)=>Object.assign(rows.find(row=>matches(row,query)),update.$set),
  findById:id=>({populate(){return this},lean:async()=>rows.find(row=>row._id===id)}),
 });
 const Trip=model(trips,uploadIndexes.trip),Recommendation=model(recs,uploadIndexes.recommendation);
 const guards=createTripWriteGuard({Trip,Recommendation,Deletion:{exists:async query=>receipts.some(row=>matches(row,query)),findOne:async query=>receipts.find(row=>matches(row,query))},isValidId:()=>true,deleteFile:async()=>{},addPendingFiles:async(id,user,ids)=>{const receipt=receipts.find(row=>String(row._id)===String(id)&&row.user===user);if(!receipt)throw Error('Missing receipt');receipt.pendingFiles.push(...ids);}});
 const recommendation=load('controllers/recommendationJsonController.js',{'../services/mobileTripWriteGuard':guards,'../models/Recommendation':Recommendation,'../models/User':{},'../models/Trip':Trip,'../services/storageService':{},sharp:{},'../services/fileOwnership':{assertOwnedPhotos:async()=>{}}});
 const controller=load('controllers/tripJsonController.js',{'../services/mobileTripWriteGuard':guards,'../models/Trip':Trip,'../models/Recommendation':Recommendation,'../models/User':{},'./recommendationJsonController':recommendation});
 const run=async(body=payload(),user=owner,reliable=true)=>{let status,result,failure;const res={status(value){status=value;return this},json(value){result=value}};await (reliable?controller.createRecordingUpload:controller.createTripJson)({user:{_id:user},body},res,error=>{failure=error});if(failure)throw failure;return{status,result};};
 return{run,trips,recs,receipts,markDeleted,deleteDuringLookup:()=>{deleteOnLookup=true},failChildren:n=>{failChild=n},removeIndexes:()=>{indexesPresent=false}};
}
test('actual controllers: simultaneous same-owner uploads create one trip and child',async()=>{
 const f=fixture();const results=await Promise.all([f.run(),f.run()]);assert.equal(f.trips.length,1);assert.equal(f.recs.length,1);assert.equal(results[0].result.trip._id,results[1].result.trip._id);assert.ok(results.every(r=>r.result.uploadComplete));
});
test('lost response retry and complete receipt do not recreate deleted children',async()=>{
 const f=fixture();const first=await f.run();f.recs.splice(0);const retry=await f.run();assert.equal(f.trips.length,1);assert.equal(f.recs.length,0);assert.equal(retry.result.recommendationsOutcome[0].id,first.result.recommendationsOutcome[0].id);
});
test('partial child failure preserves trip and retries only missing child',async()=>{
 const f=fixture();f.failChildren(1);const body=payload();body.recommendations.push({...body.recommendations[0],uploadId:'2'});const first=await f.run(body);assert.equal(first.result.uploadComplete,false);assert.deepEqual(Array.from(first.result.recommendationsOutcome,x=>x.status),['failed','created']);const kept=f.recs[0]._id;const retry=await f.run(body);assert.equal(retry.result.uploadComplete,true);assert.equal(f.trips.length,1);assert.equal(f.recs.length,2);assert.ok(f.recs.some(r=>r._id===kept));
});
test('same local identity belongs separately to each authenticated owner',async()=>{
 const f=fixture();await f.run();await f.run(payload(),other);assert.equal(f.trips.length,2);assert.equal(f.recs.length,2);
});
test('changed snapshot is rejected without modifying original trip',async()=>{
 const f=fixture();await f.run();const changed=payload();changed.title='Changed';await assert.rejects(f.run(changed),{statusCode:409});assert.equal(f.trips.length,1);assert.equal(f.trips[0].title,'Synthetic');
});
test('missing indexes and invalid identities fail before any insert',async()=>{
 const f=fixture();f.removeIndexes();await assert.rejects(f.run(),{statusCode:503});assert.equal(f.trips.length,0);const g=fixture();const body=payload();body.recommendations.push({...body.recommendations[0]});await assert.rejects(g.run(body),{statusCode:400});assert.equal(g.trips.length,0);
});
test('legacy JSON clients retain their existing contract without idempotency assumptions',async()=>{
 const f=fixture();f.removeIndexes();const body=payload();delete body.uploadProtocol;delete body.uploadId;const result=await f.run(body,owner,false);assert.equal(result.status,201);assert.equal(result.result.uploadProtocol,undefined);assert.equal(f.trips[0].clientUploadId,undefined);
});
test('actual Mongoose validation rejects malformed child before creating any trip',async()=>{const f=fixture();const body=payload();body.recommendations[0].attributeTags=['NOT_A_REAL_TAG'];const response=await f.run(body);assert.equal(response.status,400);assert.equal(response.result.uploadRejected,true);assert.equal(f.trips.length,0);assert.equal(f.recs.length,0);});
test('preinsert validation applies schema setters and rejects missing coordinates',async()=>{for(const patch of [{name:' '},{description:' '},{latitude:null},{longitude:''}]){const f=fixture();const body=payload();Object.assign(body.recommendations[0],patch);const response=await f.run(body);assert.equal(response.status,400);assert.equal(response.result.uploadRejected,true);assert.equal(f.trips.length,0);}});

test('recording tombstone returns explicit 410 without creating records',async()=>{
 const f=fixture();const first=await f.run();f.markDeleted();const result=await f.run();
 assert.equal(result.status,410);assert.equal(result.result.code,'TRIP_DELETED');assert.equal(result.result.tripId,first.result.trip._id);assert.equal(result.result.uploadId,'recording-1');assert.equal(f.trips.length,0);assert.equal(f.recs.length,0);
});
test('recording deletion between precheck and identity lookup compensates exact recreated records',async()=>{
 const f=fixture();const first=await f.run();f.deleteDuringLookup();const result=await f.run();
 assert.equal(result.status,410);assert.equal(result.result.tripId,first.result.trip._id);assert.equal(f.trips.length,0);assert.equal(f.recs.length,0);assert.equal(f.receipts.length,1);
});

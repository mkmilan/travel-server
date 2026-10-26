const {test}=require('node:test');const assert=require('node:assert/strict');
const {createRecommendationVisibility}=require('../services/recommendationVisibility');
const owner='a'.repeat(24), follower='b'.repeat(24), stranger='c'.repeat(24),recId='d'.repeat(24);
const query=value=>({select(){return this;},populate(){return this;},sort(){return this;},skip(){return this;},limit(){return this;},lean(){return this;},then(resolve,reject){return Promise.resolve(value).then(resolve,reject);}});
test('associated recommendations inherit visibility and failclosed for orphan/foreign trips',async()=>{
 for(const visibility of ['private','public','followers_only']) {
  const read=createRecommendationVisibility({Trip:{findById:()=>query({user:{_id:owner,followers:[follower]},defaultTripVisibility:visibility})}});
  const rec={user:owner,associatedTrip:recId};
  assert.equal(await read(rec,{_id:owner}),true);
  assert.equal(await read(rec,{_id:follower}),visibility!=='private');
  assert.equal(await read(rec,null),visibility==='public');
  assert.equal(await read({...rec,user:stranger},{_id:stranger}),false);
 }
 const read=createRecommendationVisibility({Trip:{findById:()=>query(null)}});
 assert.equal(await read({user:owner,associatedTrip:recId},{_id:owner}),false);
 assert.equal(await read({user:owner},null),true);
});
test('actual recommendation detail denies private association to anonymous caller',async t=>{
 const Rec=require('../models/Recommendation'),Trip=require('../models/Trip');const controller=require('../controllers/recommendationController');
 t.mock.method(Rec,'findById',()=>query({user:{_id:owner},associatedTrip:recId}));
 t.mock.method(Trip,'findById',()=>query({user:{_id:owner,followers:[]},defaultTripVisibility:'private'}));
 let status,error,body;await controller.getRecommendationById({params:{recommendationId:recId}}, {status(s){status=s;return this;},json(b){body=b;}},e=>{error=e;});
 assert.equal(status,404);assert(error);assert.equal(body,undefined);
});
test('actual global list removes hidden and forged associations',async t=>{
 const Rec=require('../models/Recommendation'),Trip=require('../models/Trip');const controller=require('../controllers/recommendationController');
 t.mock.method(Rec,'find',()=>query([{_id:'standalone',user:owner},{_id:'private',user:owner,associatedTrip:recId},{_id:'foreign',user:stranger,associatedTrip:recId}]));
 t.mock.method(Trip,'findById',()=>query({user:{_id:owner,followers:[]},defaultTripVisibility:'private'}));
 let body;await controller.getRecommendations({}, {status(){return this;},json(b){body=b;}},e=>{throw e;});assert.deepEqual(body.map(r=>r._id),['standalone']);
});
test('V2 user listing trip lookup enforces matching creator and retains standalone owner-only policy',async t=>{
 const mongoose=require('mongoose');const Rec=require('../models/Recommendation'),User=require('../models/User');const controller=require('../controllers/recommendationJsonController');let pipelines=[];
 t.mock.method(User,'findById',()=>query({followers:[]}));t.mock.method(Rec,'aggregate',async p=>{pipelines.push(p);return [];});
 await controller.getUserRecommendationsJson({params:{userId:owner},query:{}},{status(){return this;},json(){}},e=>{throw e;});
 for(const pipeline of pipelines){const lookup=pipeline.find(s=>s.$lookup?.from==='trips').$lookup;assert.equal(String(lookup.pipeline[0].$match.user),owner);}
});
// V2 search now uses privacy-before-pagination aggregation; covered by search-json.test.js
// and the disposable Mongo/HTTP search integration suite. Legacy/global policy stays unchanged.
for(const variant of ['legacy']){
 test(`${variant} search filters private and orphan recommendations without public fallback`,async t=>{
  const Rec=require('../models/Recommendation'),Trip=require('../models/Trip');
  const handler=variant==='legacy'?require('../controllers/searchController').performSearch:require('../controllers/searchJsonController').performSearchJson;
  let queryFilter;
  t.mock.method(Rec,'find',filter=>{queryFilter=filter;return query([{_id:'standalone',user:{_id:owner}},{_id:'private',user:{_id:owner},associatedTrip:recId},{_id:'orphan',user:{_id:owner},associatedTrip:'e'.repeat(24)}]);});
  t.mock.method(Trip,'findById',id=>query(String(id)===recId?{user:{_id:owner,followers:[follower]},defaultTripVisibility:'private'}:null));
  let body;await handler({query:{q:'((',type:'recommendations'}},{status(){return this;},json(b){body=b;}},e=>{throw e;});
  assert.deepEqual(body.map(r=>r._id),['standalone']);
  const rx=variant==='legacy'?queryFilter.primaryCategory:queryFilter.$or[0].primaryCategory;
  assert.equal(rx.test('(('),true);assert.equal(rx.test('ANYTHING'),false);
 });
 test(`${variant} trip search enforces visibility for stranger, follower, owner`,async t=>{
  const Trip=require('../models/Trip');
  const handler=variant==='legacy'?require('../controllers/searchController').performSearch:require('../controllers/searchJsonController').performSearchJson;
  t.mock.method(Trip,'find',()=>query(['public','private','followers_only',undefined].map((v,i)=>({_id:String(i),user:{_id:owner,followers:[follower]},defaultTripVisibility:v,distanceMeters:0,durationMillis:0}))));
  for(const [viewer,expected]of [[null,['0']],[{_id:follower},['0','2']],[{_id:owner},['0','1','2','3']]]){
   let body;await handler({query:{q:'fixture',type:'trips'},user:viewer},{status(){return this;},json(b){body=b;}},e=>{throw e;});assert.deepEqual(body.map(r=>r._id),expected);
   assert(body.every(r=>!Object.hasOwn(r.user,'followers')));
  }
 });
}
test('V2 search extracts optional identity for owner/follower filtering',()=>{
 const fs=require('node:fs');assert.match(fs.readFileSync('routes/searchJsonRoutes.js','utf8'),/router\.get\("\/", protectOptional, performSearchJson\)/);
});

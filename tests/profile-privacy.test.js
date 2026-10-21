const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProfileVisibility } = require('../services/profileVisibility');
const fs = require('node:fs');
const owner = 'a'.repeat(24), follower = 'b'.repeat(24), stranger = 'c'.repeat(24);

for (const [label, viewer, follows, vis] of [
  ['anonymous', null, false, ['public']],
  ['stranger', {_id:stranger}, false, ['public']],
  ['follower', {_id:follower}, true, ['public','followers_only']],
  ['owner', {_id:owner}, false, null],
]) {
  test(`profile visibility filter: ${label}`, async () => {
    let existsCalls=0, seen;
    const get = createProfileVisibility({
      User:{exists:async filter=>{existsCalls++; assert.equal(filter._id,owner); assert.equal(filter.followers,viewer._id); return follows;}},
      Trip:{distinct:async (key,filter)=>{assert.equal(key,'_id');seen=filter;return ['visible-trip'];}},
      toObjectId:id=>id,
    });
    const result = await get(owner,viewer);
    assert.deepEqual(seen,{user:owner,...(vis?{defaultTripVisibility:{$in:vis}}:{})});
    assert.deepEqual(result.recommendationMatch,{user:owner,$or:[{associatedTrip:null},{associatedTrip:{$in:['visible-trip']}}]});
    assert.equal(result.isOwner,label==='owner');
    assert.equal(existsCalls,['owner','anonymous'].includes(label)?0:1);
  });
}

test('empty visible trip set fails closed for associated recommendations',async()=>{
  const get=createProfileVisibility({User:{exists:async()=>false},Trip:{distinct:async()=>[]},toObjectId:id=>id});
  const result=await get(owner,null);
  assert.deepEqual(result.recommendationMatch.$or,[{associatedTrip:null},{associatedTrip:{$in:[]}}]);
});

test('profile metadata routes apply optional authentication',()=>{
  const routes=fs.readFileSync('routes/userRoutes.js','utf8');
  for(const handler of ['getUserProfileById','getUserRecommendations','getUserPois','getUserPhotos'])
    assert.match(routes,new RegExp('protectOptional, '+handler+'\\)'));
});

test('actual POI handler scopes its aggregation before projecting private coordinates',async t=>{
  const Trip=require('../models/Trip');
  const controller=require('../controllers/userController');
  let pipeline;
  t.mock.method(Trip,'distinct',async()=>[]);
  t.mock.method(Trip,'aggregate',async p=>{pipeline=p;return [{data:[],metadata:[]}];});
  const req={params:{userId:owner},query:{}};
  let body; const res={status(){return this;},json(v){body=v;return this;}};
  await controller.getUserPois(req,res,e=>{throw e;});
  assert.deepEqual(pipeline[0].$match.defaultTripVisibility,{$in:['public']});
  assert.equal(String(pipeline[0].$match.user),owner);
  assert.equal(body.totalCount,0);
});

test('JSON gallery lookup cannot disclose another owners private trip via forged recommendation',async t=>{
  const Trip=require('../models/Trip');const controller=require('../controllers/userController');let pipeline;
  t.mock.method(Trip,'distinct',async()=>[]);
  t.mock.method(Trip,'aggregate',async p=>{pipeline=p;return [];});
  await controller.getUserPhotosJson({params:{userId:owner},query:{},user:{_id:owner}},{json(){}},e=>{throw e;});
  const union=pipeline.find(stage=>stage.$unionWith).$unionWith.pipeline;
  const joined=union.find(stage=>stage.$match?.['trip.user']);
  assert.equal(String(joined.$match['trip.user']),owner);
});

test('profile counts use visibility filters and nonowners never receive settings',async t=>{
  const Trip=require('../models/Trip'),User=require('../models/User'),Recommendation=require('../models/Recommendation');
  const controller=require('../controllers/userController');const seen=[];
  t.mock.method(Trip,'distinct',async()=>[]);
  t.mock.method(Trip,'aggregate',async pipeline=>{seen.push(pipeline[0].$match);return [];});
  t.mock.method(Recommendation,'countDocuments',async filter=>{assert.deepEqual(filter.$or[1],{associatedTrip:{$in:[]}});return 0;});
  t.mock.method(User,'findById',()=>({select:async()=>({_id:owner,username:'Fixture',followers:[],following:[],settings:{defaultTripVisibility:'private'}})}));
  let body;
  await controller.getUserProfileById({params:{userId:owner},query:{}},{status(){return this;},json(v){body=v;}},e=>{throw e;});
  assert.equal(seen.length,2);
  for(const filter of seen)assert.deepEqual(filter.defaultTripVisibility,{$in:['public']});
  assert.equal(Object.hasOwn(body,'settings'),false);
});

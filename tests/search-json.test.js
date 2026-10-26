const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const Trip = require('../models/Trip');
const Recommendation = require('../models/Recommendation');
const { performSearchJson, searchUsers } = require('../controllers/searchJsonController');
const viewerId = new mongoose.Types.ObjectId('a'.repeat(24));
const defaults = { q: 'fixture', type: 'trips', envelope: 'true' };
async function call(query = {}, user = { _id: viewerId }, handler = performSearchJson) {
  let status = 200, body, error;
  const headers = {};
  const res = {
    status(value) { status = value; return this; }, json(value) { body = value; return this; },
    set(name, value) { headers[name] = value; return this; },
  };
  await handler({ query: { ...defaults, ...query }, user }, res, value => { error = value; });
  return { status, body, error, headers };
}
function noDatabase(t) {
  for (const model of [User, Trip, Recommendation]) {
    t.mock.method(model, 'aggregate', () => { throw Error('Unexpected aggregate'); });
    t.mock.method(model, 'find', () => { throw Error('Unexpected find'); });
  }
}

for (const value of ['', '0', '-1', '1.5', '1abc', '1e2', 'Infinity', 'NaN', ' 1', '01', '9007199254740992', ['1', '2'], { $gt: 1 }, null, 1]) {
  test(`search rejects malformed pagination before DB: ${JSON.stringify(value)}`, async t => {
    noDatabase(t);
    for (const key of ['page', 'limit']) {
      const result = await call({ [key]: value });
      assert.equal(result.status, 400); assert.equal(result.error, undefined);
    }
  });
}
for (const [field, values] of [
  ['q', [undefined, '', ' ', ' x ', 'x'.repeat(121), ['valid', 'valid'], { $regex: '.' }, 22]],
  ['type', [undefined, '', 'trip', 'people', ['trips'], { $ne: 'trips' }]],
  ['category', ['', 'Wild spot', 'WILD SPOT', ['WILD_SPOT'], { $ne: 'OTHER' }]],
  ['envelope', ['', true, '1', ['true'], { $ne: 'false' }]],
]) {
  test(`search validates ${field} shape and supported values`, async t => {
    noDatabase(t);
    for (const value of values) {
      const result = await call({ type: 'recommendations', [field]: value });
      assert.equal(result.status, 400, JSON.stringify(value)); assert.equal(result.error, undefined);
    }
  });
}
test('search rejects excessive limits, unsafe skip and category on non-recommendation tab', async t => {
  noDatabase(t);
  for (const query of [{ limit: '51' }, { page: String(Number.MAX_SAFE_INTEGER), limit: '50' }, { category: 'OTHER' }, { type: 'users', category: 'OTHER' }]) {
    assert.equal((await call(query)).status, 400);
  }
});
test('mobile envelope requires authenticated viewer before any database work', async t => {
  noDatabase(t);
  for (const user of [null, undefined, {}]) assert.equal((await call({}, user === undefined ? {} : user)).status, 401);
});

for (const [type, model] of [['users', User], ['trips', Trip], ['recommendations', Recommendation]]) {
  test(`${type} search uses one aggregate, stable sort and visible-count facet with opt-in envelope`, async t => {
    let calls = 0;
    t.mock.method(model, 'aggregate', async pipeline => {
      calls++;
      const facet = pipeline.at(-1).$facet;
      assert.deepEqual(facet.metadata, [{ $count: 'total' }]);
      assert.deepEqual(facet.results.slice(0, 3), [{ $sort: type === 'trips' ? { startDate: -1, _id: -1 } : { createdAt: -1, _id: -1 } }, { $skip: 20 }, { $limit: 20 }]);
      assert(!pipeline.slice(0, -1).some(stage => stage.$skip || stage.$limit));
      if (type !== 'users') {
        assert(pipeline.find(stage => stage.$lookup?.from === 'users'));
        assert(pipeline.at(-2).$match.$expr, 'visibility match precedes both pagination and count');
        const author = facet.results.at(-1).$project.user;
        assert.deepEqual(Object.keys(author).sort(), ['_id', 'username', 'profilePictureUrl', 'city', 'country'].sort());
      }
      return [{ results: [{ _id: 'visible' }], metadata: [{ total: 21 }] }];
    });
    const result = await call({ type, page: '2' });
    assert.equal(result.error, undefined); assert.equal(calls, 1);
    assert.deepEqual(result.body, { results: [{ _id: 'visible' }], page: 2, limit: 20, total: 21, hasMore: false });
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
  });
  test(`${type} preserves bare-array callers without count; anonymous reads do not claim viewer state`, async t => {
    const expected = [{ _id: 'public' }];
    t.mock.method(model, 'aggregate', async pipeline => {
      assert(!pipeline.some(stage => stage.$facet));
      assert(pipeline.find(stage => stage.$limit === 50));
      if (type === 'trips') assert.deepEqual(pipeline.at(-1).$project.isLikedByCurrentUser, { $literal: false });
      return expected;
    });
    const result = await call({ type, envelope: undefined, limit: '50' }, null);
    assert.equal(result.error, undefined); assert.deepEqual(result.body, expected);
  });
}
test('trips include complete card/social/map fields and only same-owner recommendation counts', async t => {
  t.mock.method(Trip, 'aggregate', async pipeline => {
    const results = pipeline.at(-1).$facet.results, projection = results.at(-1).$project;
    for (const key of ['defaultTravelMode', 'defaultTripVisibility', 'photos', 'simplifiedRoute', 'mapCenter', 'distanceMeters', 'durationMillis', 'startDate', 'endDate', 'startLocationName', 'endLocationName']) assert.equal(projection[key], 1);
    for (const key of ['recommendationCount', 'likesCount', 'commentsCount', 'isLikedByCurrentUser']) assert(projection[key]);
    assert.deepEqual(projection.isLikedByCurrentUser, { $in: [viewerId, { $ifNull: ['$likes', []] }] });
    const lookup = results.find(stage => stage.$lookup).$lookup;
    assert.deepEqual(lookup.pipeline[0].$match.$expr.$and, [{ $eq: ['$associatedTrip', '$$tripId'] }, { $eq: ['$user', '$$ownerId'] }]);
    assert.equal(projection.likes, undefined); assert.equal(projection.comments, undefined);
    return [{ results: [], metadata: [] }];
  });
  assert.deepEqual((await call()).body, { results: [], page: 1, limit: 20, total: 0, hasMore: false });
});
test('recommendations retain photos and linked-trip navigation, while filtering valid ownership before pagination', async t => {
  t.mock.method(Recommendation, 'aggregate', async pipeline => {
    const choices = pipeline.at(-2).$match.$expr.$or;
    assert.deepEqual(choices[0].$and, [{ $eq: [{ $ifNull: ['$associatedTrip', null] }, null] }, { $eq: ['$user', viewerId] }]);
    assert.deepEqual(choices[1].$and[1], { $eq: ['$linkedTrip.user', '$user'] });
    assert(pipeline.find(stage => stage.$lookup?.from === 'trips'));
    const projection = pipeline.at(-1).$facet.results.at(-1).$project;
    for (const key of ['photos', 'associatedTrip', 'description', 'location', 'attributeTags', 'primaryCategory']) assert.equal(projection[key], 1);
    return [{ results: [], metadata: [] }];
  });
  assert.equal((await call({ type: 'recommendations' })).error, undefined);
});
test('each supported category is an exact enum filter AND literal name/description match', async t => {
  for (const category of Recommendation.schema.path('primaryCategory').enumValues) {
    t.mock.method(Recommendation, 'aggregate', async pipeline => {
      const match = pipeline[0].$match;
      assert.equal(match.primaryCategory, category);
      assert.deepEqual(match.$or.map(clause => Object.keys(clause)[0]), ['name', 'description']);
      for (const clause of match.$or) assert(Object.values(clause)[0].test('fixture'));
      return [{ results: [], metadata: [] }];
    });
    assert.equal((await call({ type: 'recommendations', category })).error, undefined);
  }
});
for (const q of ['.*', '((', '[x]', '\\d', 'a b', '東京', 'café', 'x'.repeat(120)]) {
  test(`query remains an escaped literal: ${JSON.stringify(q)}`, async t => {
    t.mock.method(User, 'aggregate', async pipeline => {
      const rx = pipeline[0].$match.username;
      assert(rx.test(q)); assert.equal(rx.test('UNRELATED'), false);
      assert.deepEqual(pipeline[0].$match._id, { $ne: viewerId });
      return [{ results: [], metadata: [] }];
    });
    assert.equal((await call({ q: ` ${q} `, type: 'users' })).error, undefined);
  });
}
test('hasMore reports extra visible results, and errors never produce false success', async t => {
  t.mock.method(Trip, 'aggregate', async () => [{ results: [{ _id: 1 }], metadata: [{ total: 2 }] }]);
  assert.equal((await call({ limit: '1' })).body.hasMore, true);
  const failure = Error('Synthetic offline database');
  t.mock.method(Trip, 'aggregate', async () => { throw failure; });
  const result = await call(); assert.equal(result.error, failure); assert.equal(result.body, undefined);
});
test('legacy /users rejects all-disappearing tokens rather than querying every username', async t => {
  noDatabase(t);
  for (const q of ['a b', 'x y z', ' a ']) assert.equal((await call({ q }, undefined, searchUsers)).status, 400);
});
test('legacy /users keeps token word-start behavior, deterministic pagination and no user logging', async t => {
  let filter, sort, skip, limit;
  t.mock.method(User, 'find', value => {
    filter = value;
    return { sort(value) { sort = value; return this; }, skip(value) { skip = value; return this; }, limit(value) { limit = value; return this; }, select() { return this; }, lean: async () => [{ username: 'Test Person' }] };
  });
  const result = await call({ q: 'Test Person', page: '2', limit: '10' }, undefined, searchUsers);
  assert.equal(result.error, undefined); assert.deepEqual(result.body, [{ username: 'Test Person' }]);
  assert.equal(filter.$and.length, 2); assert(filter.$and[0].username.test('Test Person'));
  assert.deepEqual(sort, { createdAt: -1, _id: -1 }); assert.equal(skip, 10); assert.equal(limit, 10);
});
test('bare-array recommendation callers retain exact category-as-text matching; mobile uses explicit category', async t => {
  t.mock.method(Recommendation, 'aggregate', async pipeline => {
    const category = pipeline[0].$match.$or[2].primaryCategory;
    assert(category.test('WILD_SPOT')); assert(!category.test('WILD_SPOT_EXTRA'));
    return [];
  });
  assert.deepEqual((await call({ type: 'recommendations', q: 'wild_spot', envelope: undefined })).body, []);
});

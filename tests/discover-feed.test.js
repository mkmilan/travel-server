const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Trip = require('../models/Trip');
const User = require('../models/User');
const controller = require('../controllers/tripJsonController');
const router = require('../routes/tripJsonRoutes');
const { protect } = require('../middleware/authMiddleware');
const viewerId = new mongoose.Types.ObjectId('a'.repeat(24));

// Synthetic model responses only; real aggregation is tested by discover-feed-integration.cjs.
async function call(handler, query = {}) {
  let status = 200, body, error;
  const headers = {};
  const res = {
    status(value) { status = value; return this; },
    set(name, value) { headers[name] = value; return this; },
    json(value) { body = value; return this; },
  };
  await handler({ query, user: { _id: viewerId } }, res, value => { error = value; });
  return { status, body, error, headers };
}

test('Discover uses protected static route before trip-id route; Following route unchanged', () => {
  const routes = router.stack.map(layer => layer.route).filter(Boolean);
  const discover = routes.find(route => route.path === '/json/discover');
  assert(discover.methods.get);
  assert.deepEqual(discover.stack.map(layer => layer.handle), [protect, controller.getDiscoverTripsJson]);
  assert(routes.indexOf(discover) < routes.findIndex(route => route.path === '/json/:tripId'));
  assert.deepEqual(routes.find(route => route.path === '/json/feed').stack.map(layer => layer.handle), [protect, controller.getTripsFeedJson]);
});

test('Discover filters public JSON before stable sort/pagination/count and does not query follows', async t => {
  const trips = [{ _id: 'fixture', title: 'Synthetic public trip' }];
  t.mock.method(User, 'findById', () => { throw Error('Discover must not depend on follows'); });
  t.mock.method(Trip, 'aggregate', async pipeline => {
    assert.deepEqual(pipeline.slice(0, 4), [
      { $match: { format: 'json', defaultTripVisibility: 'public' } },
      { $sort: { createdAt: -1, _id: -1 } }, { $skip: 20 }, { $limit: 10 },
    ]);
    const project = pipeline.at(-1).$project;
    assert.deepEqual(Object.keys(project).sort(), ['_id', 'title', 'startDate', 'description', 'defaultTravelMode', 'defaultTripVisibility', 'simplifiedRoute', 'distanceMeters', 'durationMillis', 'likesCount', 'commentsCount', 'recommendationCount', 'isLikedByCurrentUser', 'createdAt', 'user', 'startLocationName', 'endLocationName'].sort());
    assert.deepEqual(project.isLikedByCurrentUser, { $in: [viewerId, { $ifNull: ['$likes', []] }] });
    assert.deepEqual(project.description, { $substrCP: ['$description', 0, 150] });
    assert.deepEqual(Object.keys(project.user).sort(), ['_id', 'username', 'profilePictureUrl', 'city', 'country'].sort());
    return trips;
  });
  t.mock.method(Trip, 'countDocuments', async query => {
    assert.deepEqual(query, { format: 'json', defaultTripVisibility: 'public' });
    return 21;
  });
  const result = await call(controller.getDiscoverTripsJson, { page: '3', limit: '10' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { items: trips, page: 3, limit: 10, totalPages: 3, totalCount: 21 });
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
});

test('Discover defaults to page one / ten and empty results keep exact feed envelope', async t => {
  t.mock.method(Trip, 'aggregate', async pipeline => {
    assert.deepEqual(pipeline[2], { $skip: 0 });
    assert.deepEqual(pipeline[3], { $limit: 10 });
    return [];
  });
  t.mock.method(Trip, 'countDocuments', async () => 0);
  assert.deepEqual((await call(controller.getDiscoverTripsJson)).body, { items: [], page: 1, limit: 10, totalPages: 0, totalCount: 0 });
});

for (const value of ['', '0', '-1', '1.5', '1abc', '1e2', 'Infinity', 'NaN', ' 1', '01', '9007199254740992', ['1', '2'], { $gt: 1 }, null, 1]) {
  test(`Discover rejects malformed page/limit before database access: ${JSON.stringify(value)}`, async t => {
    t.mock.method(Trip, 'aggregate', () => { throw Error('Unexpected database access'); });
    t.mock.method(Trip, 'countDocuments', () => { throw Error('Unexpected database access'); });
    for (const field of ['page', 'limit']) {
      const result = await call(controller.getDiscoverTripsJson, { [field]: value });
      assert.equal(result.status, 400);
      assert.equal(result.error, undefined);
      assert.match(result.body.message, /positive integer/);
    }
  });
}

test('Discover rejects excessive limit and unsafe calculated skip', async t => {
  t.mock.method(Trip, 'aggregate', () => { throw Error('Unexpected database access'); });
  for (const query of [{ limit: '101' }, { page: String(Number.MAX_SAFE_INTEGER), limit: '100' }]) {
    assert.equal((await call(controller.getDiscoverTripsJson, query)).status, 400);
  }
});

test('Discover accepts maximum limit and forwards database errors without success', async t => {
  const failure = Error('Synthetic database unavailable');
  t.mock.method(Trip, 'aggregate', async pipeline => {
    assert.deepEqual(pipeline[3], { $limit: 100 });
    throw failure;
  });
  const result = await call(controller.getDiscoverTripsJson, { limit: '100' });
  assert.equal(result.error, failure);
  assert.equal(result.body, undefined);
});

test('Discover schema index matches equality filters and stable upload sort; no new fields', () => {
  assert(Trip.schema.indexes().some(([key]) => JSON.stringify(key) === JSON.stringify({ format: 1, defaultTripVisibility: 1, createdAt: -1, _id: -1 })));
  assert.equal(Trip.schema.options.timestamps, true);
});

test('Following still returns empty for no follows without querying trips', async t => {
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({ following: [] }) }) }));
  t.mock.method(Trip, 'aggregate', () => { throw Error('Unexpected aggregate'); });
  const result = await call(controller.getTripsFeedJson);
  assert.deepEqual(result.body, { items: [], page: 1, limit: 10, totalPages: 0, totalCount: 0 });
});

test('Following retains followed-author + public/followers-only match and startDate sort', async t => {
  const followed = new mongoose.Types.ObjectId('b'.repeat(24));
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({ following: [followed] }) }) }));
  const match = { user: { $in: [followed] }, format: 'json', $or: [{ defaultTripVisibility: 'public' }, { defaultTripVisibility: 'followers_only' }] };
  t.mock.method(Trip, 'aggregate', async pipeline => {
    assert.deepEqual(pipeline[0], { $match: match });
    assert.deepEqual(pipeline[1], { $sort: { startDate: -1 } });
    return [];
  });
  t.mock.method(Trip, 'countDocuments', async filter => { assert.deepEqual(filter, match); return 0; });
  assert.equal((await call(controller.getTripsFeedJson)).error, undefined);
});

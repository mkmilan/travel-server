const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const Trip = require('../models/Trip');
const Recommendation = require('../models/Recommendation');
const controller = require('../controllers/userController');

// Actual controller functions, synthetic model responses only. These fixtures
// never connect to MongoDB and do not validate MongoDB aggregation execution.
const ownerId = new mongoose.Types.ObjectId('a'.repeat(24));
const viewerId = new mongoose.Types.ObjectId('b'.repeat(24));
const visibleTripId = new mongoose.Types.ObjectId('c'.repeat(24));
const hiddenTripId = new mongoose.Types.ObjectId('d'.repeat(24));
const strangerId = new mongoose.Types.ObjectId('e'.repeat(24));

async function call(handler, request) {
  let status = 200, body, error;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
  await handler({ params: {}, query: {}, ...request }, res, value => { error = value; });
  return { status, body, error };
}

for (const handlerName of ['getUserProfileById', 'getPublicProfileByUserId']) {
  for (const role of ['owner', 'follower', 'stranger', 'anonymous']) {
    test(`${handlerName}: nonzero mobile counters and ${role} visibility contract`, async t => {
      const user = {
        _id: ownerId, username: 'Synthetic owner', city: 'Fixture city', country: 'Fixture country',
        bio: 'Fixture bio', profilePictureUrl: 'fixture-photo',
        followers: [viewerId], following: [visibleTripId, hiddenTripId],
        settings: { defaultTripVisibility: 'private' }, createdAt: new Date('2026-01-01T00:00:00Z'),
        password: 'synthetic-private-value', email: 'private@example.com',
        passwordResetToken: 'synthetic-reset', passwordResetExpires: new Date(),
        emailVerificationToken: 'synthetic-verification', emailVerificationExpires: new Date(),
        futurePrivateField: 'not-part-of-any-public-contract',
      };
      const viewer = role === 'anonymous' ? null : { _id: role === 'owner' ? ownerId : role === 'stranger' ? strangerId : viewerId };
      let expectedFilter;
      const aggregates = [];
      t.mock.method(User, 'findById', id => {
        assert.equal(String(id), String(ownerId));
        return { select: async () => user };
      });
      t.mock.method(User, 'exists', async filter => {
        assert.equal(String(filter._id), String(ownerId));
        assert.equal(String(filter.followers), String(viewer._id));
        return role === 'follower';
      });
      t.mock.method(Trip, 'distinct', async (field, filter) => {
        assert.equal(field, '_id');
        assert.equal(String(filter.user), String(ownerId));
        assert.ok(filter.user instanceof mongoose.Types.ObjectId);
        if (role === 'owner') assert.equal(Object.hasOwn(filter, 'defaultTripVisibility'), false);
        else assert.deepEqual(filter.defaultTripVisibility, { $in: role === 'follower' ? ['public', 'followers_only'] : ['public'] });
        expectedFilter = filter;
        return [visibleTripId];
      });
      t.mock.method(Trip, 'aggregate', async pipeline => {
        assert.deepEqual(pipeline[0], { $match: expectedFilter });
        aggregates.push(pipeline);
        if (pipeline[1].$group) {
          assert.deepEqual(pipeline[1].$group, { _id: null, totalDistance: { $sum: '$distanceMeters' }, totalTrips: { $sum: 1 } });
          return [{ totalDistance: 1234.6, totalTrips: 4 }];
        }
        assert.deepEqual(pipeline[1].$project, { poiCount: { $size: { $ifNull: ['$pointsOfInterest', []] } } });
        assert.deepEqual(pipeline[2].$group, { _id: null, totalPois: { $sum: '$poiCount' } });
        return [{ totalPois: 7 }];
      });
      t.mock.method(Recommendation, 'countDocuments', async filter => {
        assert.equal(String(filter.user), String(ownerId));
        assert.deepEqual(filter.$or, [{ associatedTrip: null }, { associatedTrip: { $in: [visibleTripId] } }]);
        return 3;
      });
      const result = await call(controller[handlerName], { params: { userId: String(ownerId) }, user: viewer });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 200);
      assert.equal(aggregates.length, 2);
      for (const [key, value] of Object.entries({ totalTrips: 4, totalDistance: 1235, totalRecommendations: 3, totalPois: 7, followersCount: 1, followingCount: 2 })) {
        assert.equal(result.body[key], value, `${key} preserves the mobile response contract`);
      }
      assert.equal(Object.hasOwn(result.body, 'settings'), handlerName === 'getUserProfileById' && role === 'owner');
      const publicFields = ['_id', 'username', 'bio', 'city', 'country', 'profilePictureUrl', 'createdAt',
        'totalTrips', 'totalDistance', 'followersCount', 'followingCount', 'totalRecommendations', 'totalPois'];
      const extraFields = handlerName === 'getPublicProfileByUserId' ? ['isFollowing', 'isOwnProfile'] : role === 'owner' ? ['settings'] : [];
      assert.deepEqual(Object.keys(result.body).sort(), [...publicFields, ...extraFields].sort());
      for (const key of ['_id', 'username', 'bio', 'city', 'country', 'profilePictureUrl', 'createdAt']) {
        assert.equal(result.body[key], user[key], `${key} preserves the rich profile header`);
      }
      if (handlerName === 'getPublicProfileByUserId') {
        // Relationship state is derived from the same array as its count.
        assert.equal(result.body.isFollowing, role === 'follower');
        assert.equal(result.body.isOwnProfile, role === 'owner');
      }
    });
  }
}

test('active follow/unfollow controllers update the same arrays consumed by profiles and lists', async t => {
  let writes = 0;
  const current = { _id: viewerId, username: 'Synthetic viewer', following: [], followers: [] };
  const target = { _id: ownerId, username: 'Synthetic owner', following: [], followers: [] };
  t.mock.method(User, 'findById', async id => String(id) === String(viewerId) ? current : String(id) === String(ownerId) ? target : null);
  t.mock.method(User, 'updateOne', async (filter, update) => {
    writes++;
    const user = String(filter._id) === String(viewerId) ? current : target;
    const operator = Object.keys(update)[0];
    assert.ok(['$addToSet', '$pull'].includes(operator));
    const [[field, value]] = Object.entries(update[operator]);
    if (operator === '$addToSet') {
      if (!user[field].some(id => String(id) === String(value))) user[field].push(value);
    } else user[field] = user[field].filter(id => String(id) !== String(value));
    return { acknowledged: true, matchedCount: 1 };
  });
  const req = { params: { userId: String(ownerId) }, user: { _id: viewerId } };
  let result = await call(controller.followUser, req);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 200);
  assert.deepEqual(current.following.map(String), [String(ownerId)]);
  assert.deepEqual(target.followers.map(String), [String(viewerId)]);
  assert.equal(writes, 2);

  result = await call(controller.followUser, req);
  assert.equal(result.status, 400);
  assert.match(result.error.message, /already following/);
  assert.equal(writes, 2);
  assert.equal(current.following.length, 1);

  result = await call(controller.unfollowUser, req);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 200);
  assert.deepEqual(current.following, []);
  assert.deepEqual(target.followers, []);
  assert.equal(writes, 4);

  result = await call(controller.unfollowUser, req);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 200);
  assert.deepEqual(current.following, []);
  assert.deepEqual(target.followers, []);
});

for (const handlerName of ['followUser', 'unfollowUser']) {
  test(`${handlerName}: invalid/self targets fail before model access`, async t => {
    t.mock.method(User, 'findById', () => { throw new Error('Unexpected model access'); });
    for (const id of ['not-an-object-id', String(viewerId)]) {
      const result = await call(controller[handlerName], { params: { userId: id }, user: { _id: viewerId } });
      assert.equal(result.status, 400);
      assert.match(result.error.message, /Invalid user ID|yourself/);
    }
  });
}

for (const [handlerName, field] of [['getUserFollowers', 'followers'], ['getUserFollowing', 'following']]) {
  test(`${handlerName}: page/limit, user button data and metadata contract`, async t => {
    const page = [{ _id: viewerId, username: 'Synthetic viewer', followers: [ownerId] }];
    let populateCalls = 0;
    t.mock.method(User, 'findById', id => {
      assert.equal(String(id), String(ownerId));
      return { select(selected) {
        assert.equal(selected, field);
        return {
          then(resolve, reject) { return Promise.resolve({ [field]: Array(31).fill(viewerId) }).then(resolve, reject); },
          async populate(options) {
            populateCalls++;
            assert.equal(options.path, field);
            assert.equal(options.select, '_id username profilePictureUrl followers');
            assert.deepEqual(options.options, { sort: { username: 1 }, skip: 15, limit: 15 });
            return { [field]: page };
          },
        };
      } };
    });
    t.mock.method(User, 'countDocuments', async () => page.length);
    const result = await call(controller[handlerName], { params: { userId: String(ownerId) }, query: { page: '2', limit: '15' } });
    assert.equal(result.error, undefined);
    assert.equal(populateCalls, 1);
    assert.deepEqual(result.body, { data: page, page: 2, limit: 15, totalPages: 3, totalCount: 31 });
  });
}

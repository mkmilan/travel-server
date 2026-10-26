const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mongoose = require('mongoose');
const Follow = require('../models/Follow');
const controller = require('../controllers/userController');

// Validate the actual aggregation construction. Real projection execution,
// including unknown future fields, is covered by public-user-responses-integration.cjs.
for (const [handlerName, matchField, lookupField] of [
  ['getUserFollowersV2', 'followee', 'follower'],
  ['getUserFollowingV2', 'follower', 'followee'],
]) {
  for (const authenticated of [false, true]) {
    test(`${handlerName}: positive public projection and unchanged pagination (${authenticated ? 'authenticated' : 'anonymous'})`, async t => {
      const userId = new mongoose.Types.ObjectId();
      const items = [{ _id: new mongoose.Types.ObjectId(), username: 'Synthetic user', profilePictureUrl: 'fixture', followers: [] }];
      t.mock.method(Follow, 'aggregate', async pipeline => {
        assert.deepEqual(pipeline, [
          { $match: { [matchField]: userId } },
          { $lookup: { from: 'users', localField: lookupField, foreignField: '_id', as: 'user' } },
          { $unwind: '$user' },
          { $replaceRoot: { newRoot: '$user' } },
          { $project: { _id: 1, username: 1, profilePictureUrl: 1, followers: 1 } },
          { $sort: { username: 1 } },
          { $skip: 2 },
          { $limit: 2 },
        ]);
        return items;
      });
      t.mock.method(Follow, 'countDocuments', async filter => {
        assert.deepEqual(filter, { [matchField]: String(userId) });
        return 5;
      });
      let body;
      await controller[handlerName]({
        params: { userId: String(userId) }, query: { page: '2', limit: '2' },
        ...(authenticated ? { user: { _id: new mongoose.Types.ObjectId() } } : {}),
      }, { json(value) { body = value; } }, error => { throw error; });
      assert.deepEqual(body, { data: items, total: 5 });
    });
  }
}

test('V2 following remains unmounted; follower route retains optional authentication', () => {
  const routes = fs.readFileSync(require.resolve('../routes/userRoutes'), 'utf8');
  assert.doesNotMatch(routes, /getUserFollowingV2/);
  assert.match(routes, /router\.get\("\/v2\/users\/:userId\/followers", protectOptional, getUserFollowersV2\)/);
});

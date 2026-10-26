const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const { followUser, unfollowUser } = require('../controllers/userController');

const alice = new mongoose.Types.ObjectId('a'.repeat(24));
const bob = new mongoose.Types.ObjectId('b'.repeat(24));
const carol = new mongoose.Types.ObjectId('c'.repeat(24));
const david = new mongoose.Types.ObjectId('d'.repeat(24));
const key = value => String(value);
const ids = values => values.map(key).sort();

async function call(handler, actor = alice, target = bob) {
  let status = 200, body, error;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
  await handler({ params: { userId: key(target) }, user: { _id: actor } }, res, value => { error = value; });
  return { status, body, error };
}

// This in-memory fixture checks controller update intent, not Mongo semantics.
// The companion disposable HTTP/Mongo script verifies real concurrent writes.
function fixture(t) {
  const rows = new Map([alice, bob, carol, david].map(id => [key(id), {
    _id: id, username: `Synthetic ${key(id)[0]}`, following: [], followers: [],
  }]));
  const snapshots = [], writes = [];
  t.mock.method(User, 'findById', async id => {
    const row = rows.get(key(id));
    if (!row) return null;
    const copy = { ...row, following: [...row.following], followers: [...row.followers] };
    snapshots.push(copy);
    return copy;
  });
  t.mock.method(User, 'updateOne', async (filter, update) => {
    assert.deepEqual(Object.keys(filter), ['_id']);
    const operator = Object.keys(update)[0];
    assert.ok(['$addToSet', '$pull'].includes(operator), 'membership changes must be atomic operators');
    assert.equal(Object.keys(update).length, 1);
    const entries = Object.entries(update[operator]);
    assert.equal(entries.length, 1);
    const [field, value] = entries[0];
    assert.ok(['following', 'followers'].includes(field));
    const row = rows.get(key(filter._id));
    writes.push({ id: key(filter._id), operator, field, value: key(value) });
    if (operator === '$addToSet') {
      if (!row[field].some(id => key(id) === key(value))) row[field].push(value);
    } else row[field] = row[field].filter(id => key(id) !== key(value));
    return { acknowledged: true, matchedCount: 1 };
  });
  return { rows, snapshots, writes };
}

test('simultaneous follow controllers use atomic membership additions despite equal stale snapshots', async t => {
  const { rows, snapshots, writes } = fixture(t);
  const results = await Promise.all([call(followUser), call(followUser)]);
  assert(results.every(result => result.status === 200 && !result.error));
  assert.equal(snapshots.length, 4);
  assert(snapshots.every(row => row.following.length === 0 && row.followers.length === 0), 'read documents are never mutated or saved');
  assert.deepEqual(ids(rows.get(key(alice)).following), [key(bob)]);
  assert.deepEqual(ids(rows.get(key(bob)).followers), [key(alice)]);
  assert.equal(writes.length, 4);
  assert(writes.every(write => write.operator === '$addToSet'));
  const duplicate = await call(followUser);
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.error.message, /already following/);
  assert.equal(writes.length, 4, 'sequential duplicate still fails without writes');
});

test('concurrent unfollows remove only selected memberships rather than replacing stale arrays', async t => {
  const { rows, snapshots, writes } = fixture(t);
  rows.get(key(alice)).following = [bob, carol, david];
  for (const target of [bob, carol, david]) rows.get(key(target)).followers = [alice];
  const results = await Promise.all([call(unfollowUser, alice, bob), call(unfollowUser, alice, carol)]);
  assert(results.every(result => result.status === 200 && !result.error));
  assert.deepEqual(ids(rows.get(key(alice)).following), [key(david)]);
  assert.deepEqual(rows.get(key(bob)).followers, []);
  assert.deepEqual(rows.get(key(carol)).followers, []);
  assert.deepEqual(rows.get(key(david)).followers, [alice]);
  assert(snapshots.filter(row => key(row._id) === key(alice)).every(row => row.following.length === 3));
  assert.equal(writes.length, 4);
  assert(writes.every(write => write.operator === '$pull'));
});

for (const [name, handler, operator] of [['follow', followUser, '$addToSet'], ['unfollow', unfollowUser, '$pull']]) {
  test(`${name}: missing actor or target rejects before relationship writes`, async t => {
    const { rows, writes } = fixture(t);
    rows.delete(key(bob));
    const missingTarget = await call(handler);
    assert.equal(missingTarget.status, 404);
    assert.match(missingTarget.error.message, /User to .* not found/);
    rows.delete(key(alice));
    const missingActor = await call(handler);
    assert.equal(missingActor.status, 404);
    assert.match(missingActor.error.message, /Current user not found/);
    assert.deepEqual(writes, []);
  });

  test(`${name}: a database write failure is forwarded without falsely reporting success`, async t => {
    const failure = new Error('Synthetic unavailable write');
    t.mock.method(User, 'findById', async id => ({ _id: id, username: 'Synthetic user', following: [], followers: [] }));
    const writes = [];
    t.mock.method(User, 'updateOne', async (filter, update) => {
      writes.push({ filter, update });
      if (key(filter._id) === key(bob)) throw failure;
      return { acknowledged: true, matchedCount: 1 };
    });
    t.mock.method(console, 'error', () => {});
    const result = await call(handler);
    assert.equal(result.error, failure);
    assert.equal(result.body, undefined);
    assert.equal(writes.length, 2);
    assert(writes.every(write => Object.keys(write.update)[0] === operator));
    // Like the prior two-save implementation, one document can have succeeded.
    // No unsafe compensation should undo a concurrent legitimate membership.
  });
}

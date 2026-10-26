// Follow/unfollow concurrency through actual auth, CSRF, HTTP and disposable MongoDB.
// Never accepts a database URI, loads .env, or connects to an existing database.
// Usage: MONGOD_BINARY=/path/to/verified/official/mongod node scripts/follow-concurrency-integration.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const mongoose = require('mongoose');
const ROOT = path.resolve(__dirname, '..');
const PASSWORD = 'disposable-follow-fixture-password';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function start(command, args, env) {
  const child = spawn(command, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '', failure;
  child.on('error', error => { failure = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs += chunk; });
  return { child, logs: () => logs, failure: () => failure };
}
async function ready(process, marker) {
  for (let i = 0; i < 150; i++) {
    if (process.failure()) throw process.failure();
    assert.equal(process.child.exitCode, null, 'Disposable process exited during startup');
    if (process.logs().includes(marker)) return;
    await sleep(100);
  }
  throw Error('Disposable process startup timed out');
}
async function stop(process) {
  if (!process || process.failure() || process.child.exitCode !== null) return;
  const closed = once(process.child, 'exit');
  process.child.kill('SIGTERM');
  await Promise.race([closed, sleep(5000)]);
  if (process.child.exitCode === null) { process.child.kill('SIGKILL'); await closed; }
}
async function main() {
  assert.equal(process.argv.length, 2, 'No arguments or external URIs accepted');
  assert(process.env.MONGOD_BINARY, 'Set MONGOD_BINARY to a verified official mongod executable');
  assert(!existsSync(path.join(ROOT, '.env')), 'Run only in a clean checkout without .env');
  const dir = await mkdtemp(path.join(tmpdir(), 'travel-follow-'));
  let mongo, app, passed = 0;
  const check = label => { passed++; console.log(`PASS ${label}`); };
  try {
    const mongoPort = await freePort(), apiPort = await freePort();
    const uri = `mongodb://127.0.0.1:${mongoPort}/follow_fixture`;
    const base = `http://127.0.0.1:${apiPort}/api`;
    mongo = start(process.env.MONGOD_BINARY, ['--dbpath', dir, '--bind_ip', '127.0.0.1', '--port', String(mongoPort), '--nounixsocket', '--wiredTigerCacheSizeGB', '0.25'], { PATH: process.env.PATH });
    await ready(mongo, 'Waiting for connections');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const User = require('../models/User');
    await User.init();
    console.log('Disposable MongoDB:', (await mongoose.connection.db.admin().command({ buildInfo: 1 })).version);
    const accounts = await Promise.all(['alice', 'bob', 'carol', 'david'].map(name => User.create({
      username: `Synthetic ${name}`, email: `${name}@example.com`, password: PASSWORD,
      isEmailVerified: true, bio: 'Must survive relationship writes', city: 'Fixture city',
    })));
    const [alice, bob, carol, david] = accounts;
    const passwordBefore = (await User.findById(alice.id).select('+password')).password;
    app = start(process.execPath, ['-e', "const http=require('node:http');const original=http.Server.prototype.listen;http.Server.prototype.listen=function(port,...args){return original.call(this,port,'127.0.0.1',...args)};require('./server.js')"], {
      PATH: process.env.PATH, NODE_ENV: 'development', EMAIL_MODE: 'disabled', PORT: String(apiPort), MONGO_URI: uri,
      JWT_SECRET: 'public-disposable-follow-fixture-not-for-deployment', JWT_COOKIE_EXPIRE: '1', FRONTEND_URL: 'http://localhost:3000',
    });
    await ready(app, 'MongoDB Connected');
    const request = (url, options = {}) => fetch(base + url, { ...options, signal: AbortSignal.timeout(10000) });
    const sessions = new Map();
    for (const user of accounts) {
      const csrfResponse = await request('/csrf-token');
      const csrf = (await csrfResponse.json()).csrfToken;
      const cookie = csrfResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: cookie };
      const response = await request('/auth/login', { method: 'POST', headers, body: JSON.stringify({ email: user.email, password: PASSWORD }) });
      assert.equal(response.status, 200);
      sessions.set(user.id, { ...headers, Authorization: `Bearer ${(await response.json()).token}` });
    }
    const write = async (user, target, method = 'POST') => {
      const response = await request(`/users/${target.id || target}/follow`, { method, headers: sessions.get(user.id) });
      return { status: response.status, body: await response.json() };
    };
    const get = async (url, user = alice) => {
      const response = await request(url, { headers: sessions.get(user.id) });
      assert.equal(response.status, 200, url);
      return response.json();
    };
    const row = user => User.findById(user.id).lean();
    const ids = values => values.map(String).sort();
    const expectRelationships = async (user, following, followers) => {
      const saved = await row(user);
      assert.deepEqual(ids(saved.following), ids(following), `${user.username}: following membership`);
      assert.deepEqual(ids(saved.followers), ids(followers), `${user.username}: follower membership`);
      const profile = await get(`/users/user/${user.id}`);
      assert.equal(profile.followingCount, following.length);
      assert.equal(profile.followersCount, followers.length);
      const followingList = await get(`/users/${user.id}/following`);
      const followerList = await get(`/users/${user.id}/followers`);
      assert.equal(followingList.totalCount, following.length);
      assert.equal(followerList.totalCount, followers.length);
      assert.deepEqual(ids(followingList.data.map(user => user._id)), ids(following));
      assert.deepEqual(ids(followerList.data.map(user => user._id)), ids(followers));
    };

    const { Authorization, ...csrfOnly } = sessions.get(alice.id);
    assert.equal((await request(`/users/${bob.id}/follow`, { method: 'POST', headers: csrfOnly })).status, 401);
    assert.equal((await request(`/users/${bob.id}/follow`, { method: 'POST', headers: { Authorization } })).status, 403);
    for (const method of ['POST', 'DELETE']) {
      assert.equal((await write(alice, alice, method)).status, 400);
      assert.equal((await write(alice, 'not-an-id', method)).status, 400);
      assert.equal((await write(alice, new mongoose.Types.ObjectId().toString(), method)).status, 404);
    }
    check('bearer authentication, CSRF, self/invalid/missing-user contracts remain enforced');

    let result = await write(alice, bob);
    assert.deepEqual(result, { status: 200, body: { message: `Successfully followed ${bob.username}` } });
    result = await write(alice, bob);
    assert.equal(result.status, 400); assert.match(result.body.message, /already following/);
    await expectRelationships(alice, [bob.id], []);
    await expectRelationships(bob, [], [alice.id]);
    assert.equal((await get(`/users/user/${bob.id}`)).isFollowing, true);
    check('sequential follow and duplicate-400 preserve messages, membership, lists and profile counts');
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(await write(alice, bob, 'DELETE'), { status: 200, body: { message: `Successfully unfollowed ${bob.username}` } });
    }
    await expectRelationships(alice, [], []);
    await expectRelationships(bob, [], []);
    check('unfollow and repeated unfollow retain idempotent success contract');

    for (let round = 0; round < 5; round++) {
      const follows = await Promise.all(Array.from({ length: 8 }, () => write(alice, bob)));
      assert(follows.some(result => result.status === 200));
      assert(follows.every(result => [200, 400].includes(result.status)), JSON.stringify(follows));
      await expectRelationships(alice, [bob.id], []);
      await expectRelationships(bob, [], [alice.id]);
      const unfollows = await Promise.all(Array.from({ length: 8 }, () => write(alice, bob, 'DELETE')));
      assert(unfollows.every(result => result.status === 200), JSON.stringify(unfollows));
      await expectRelationships(alice, [], []);
      await expectRelationships(bob, [], []);
    }
    check('five rounds of eight simultaneous follows/unfollows never duplicate IDs or counts');

    assert((await Promise.all([bob, carol, david].map(user => write(user, alice)))).every(result => result.status === 200));
    await expectRelationships(alice, [], [bob.id, carol.id, david.id]);
    for (const user of [bob, carol, david]) await expectRelationships(user, [alice.id], []);
    assert((await Promise.all([bob, carol, david].map(user => write(user, alice, 'DELETE')))).every(result => result.status === 200));
    await expectRelationships(alice, [], []);
    check('different simultaneous followers/unfollowers preserve all independent target-array updates');

    assert((await Promise.all([bob, carol, david].map(user => write(alice, user)))).every(result => result.status === 200));
    await expectRelationships(alice, [bob.id, carol.id, david.id], []);
    assert((await Promise.all([bob, carol].map(user => write(alice, user, 'DELETE')))).every(result => result.status === 200));
    await expectRelationships(alice, [david.id], []);
    await expectRelationships(bob, [], []);
    await expectRelationships(carol, [], []);
    await expectRelationships(david, [], [alice.id]);
    assert.equal((await write(alice, david, 'DELETE')).status, 200);
    check('different simultaneous targets and removals preserve unrelated following membership');

    assert((await Promise.all([write(alice, bob), write(bob, alice)])).every(result => result.status === 200));
    await expectRelationships(alice, [bob.id], [bob.id]);
    await expectRelationships(bob, [alice.id], [alice.id]);
    assert.equal((await write(alice, bob, 'DELETE')).status, 200);
    await expectRelationships(alice, [], [bob.id]);
    await expectRelationships(bob, [alice.id], []);
    assert.equal((await write(bob, alice, 'DELETE')).status, 200);
    check('mutual follows coexist and unfollow removes only the requested direction');

    // Only synthetic fixture rows: verify legacy duplicates are not silently
    // migrated by follow, while explicit unfollow still removes all matches.
    await User.updateOne({ _id: alice.id }, { $set: { following: [bob._id, bob._id, david._id] } });
    await User.updateOne({ _id: bob.id }, { $set: { followers: [alice._id, alice._id] } });
    await User.updateOne({ _id: david.id }, { $set: { followers: [alice._id] } });
    assert.equal((await write(alice, bob)).status, 400);
    assert.equal((await row(alice)).following.length, 3);
    assert.equal((await write(alice, bob, 'DELETE')).status, 200);
    await expectRelationships(alice, [david.id], []);
    await expectRelationships(bob, [], []);
    await expectRelationships(david, [], [alice.id]);
    check('no implicit legacy dedup migration; explicit unfollow removes every matching duplicate only');

    const saved = await User.findById(alice.id).select('+password');
    assert.equal(saved.password, passwordBefore);
    assert.equal(saved.bio, 'Must survive relationship writes');
    assert.equal(saved.city, 'Fixture city');
    check('relationship writes do not rehash passwords or overwrite unrelated profile fields');
    console.log(`Follow concurrency integration result: ${passed} checks passed; synthetic disposable data only.`);
  } finally {
    await stop(app);
    if (mongoose.connection.readyState) await mongoose.disconnect();
    await stop(mongo);
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

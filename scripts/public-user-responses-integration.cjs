// Public user response contracts through actual auth, CSRF, HTTP and disposable MongoDB.
// Never accepts a database URI, loads .env, or connects to an existing database.
// Usage: MONGOD_BINARY=/path/to/verified/official/mongod node scripts/public-user-responses-integration.cjs
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
const PASSWORD = 'disposable-public-profile-fixture-password';
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

const LIST_FIELDS = ['_id', 'username', 'profilePictureUrl', 'followers'].sort();
const PROFILE_FIELDS = ['_id', 'username', 'bio', 'city', 'country', 'profilePictureUrl', 'createdAt',
  'totalTrips', 'totalDistance', 'followersCount', 'followingCount', 'totalRecommendations', 'totalPois'].sort();
function exactKeys(object, fields) {
  // On failure, print field names only, never account/credential values.
  assert.deepEqual(Object.keys(object).sort(), [...fields].sort());
}
function assertList(items, expected) {
  assert.equal(items.length, expected.length);
  items.forEach((item, i) => {
    exactKeys(item, LIST_FIELDS);
    assert.equal(String(item._id), expected[i].id);
    assert.equal(item.username, expected[i].username);
    assert.equal(item.profilePictureUrl, expected[i].profilePictureUrl);
    assert.deepEqual(item.followers.map(String), expected[i].followers.map(String));
  });
}
async function main() {
  assert.equal(process.argv.length, 2, 'No arguments or external URIs accepted');
  assert(process.env.MONGOD_BINARY, 'Set MONGOD_BINARY to a verified official mongod executable');
  assert(!existsSync(path.join(ROOT, '.env')), 'Run only in a clean checkout without .env');
  const dir = await mkdtemp(path.join(tmpdir(), 'travel-public-profile-'));
  let mongo, app, passed = 0;
  const check = label => { passed++; console.log(`PASS ${label}`); };
  try {
    const mongoPort = await freePort(), apiPort = await freePort();
    const uri = `mongodb://127.0.0.1:${mongoPort}/public_profile_fixture`;
    const base = `http://127.0.0.1:${apiPort}/api`;
    mongo = start(process.env.MONGOD_BINARY, ['--dbpath', dir, '--bind_ip', '127.0.0.1', '--port', String(mongoPort), '--nounixsocket', '--wiredTigerCacheSizeGB', '0.25'], { PATH: process.env.PATH });
    await ready(mongo, 'Waiting for connections');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const User = require('../models/User'), Follow = require('../models/Follow');
    const Trip = require('../models/Trip'), Recommendation = require('../models/Recommendation');
    await Promise.all([User.init(), Follow.init(), Trip.init(), Recommendation.init()]);
    console.log('Disposable MongoDB:', (await mongoose.connection.db.admin().command({ buildInfo: 1 })).version);
    const accounts = await Promise.all(['owner', 'alpha-follower', 'stranger', 'followed', 'zeta-follower'].map(name => User.create({
      username: `Synthetic ${name}`, email: `${name}@example.com`, password: PASSWORD, isEmailVerified: true,
      bio: 'Synthetic public bio', city: 'Fixture city', country: 'Fixture country', profilePictureUrl: 'fixture-avatar',
      settings: { defaultTripVisibility: 'private', preferredUnits: 'imperial' },
      passwordResetToken: 'synthetic-reset-value', passwordResetExpires: new Date('2030-01-01'),
      emailVerificationToken: 'synthetic-verification-value', emailVerificationExpires: new Date('2030-01-01'),
    })));
    const [owner, follower, stranger, followed, zeta] = accounts;
    owner.followers = [follower._id, zeta._id]; owner.following = [followed._id];
    follower.followers = [stranger._id]; follower.following = [owner._id];
    followed.followers = [owner._id, stranger._id];
    zeta.following = [owner._id];
    await Promise.all(accounts.map(user => user.save()));
    // Bypass schema stripping only for this future-field fixture. Positive
    // projections must protect unknown fields too, not just today's schema.
    await User.collection.updateMany({}, { $set: { futurePrivateField: 'synthetic-future-private-value' } });
    const rawFixture = await User.collection.findOne({ _id: follower._id });
    for (const field of ['password', 'email', 'passwordResetToken', 'passwordResetExpires', 'emailVerificationToken', 'emailVerificationExpires', 'settings', 'futurePrivateField']) {
      assert(Object.hasOwn(rawFixture, field), `Synthetic fixture must contain ${field}`);
    }
    await Follow.create([
      { follower: follower._id, followee: owner._id }, { follower: zeta._id, followee: owner._id },
      { follower: owner._id, followee: followed._id },
    ]);
    const trips = ['public', 'followers_only', 'private'].map((visibility, i) => ({
      _id: new mongoose.Types.ObjectId(), user: owner._id, title: `Synthetic ${visibility} trip`,
      defaultTripVisibility: visibility, distanceMeters: [100.4, 200.2, 400.1][i],
      pointsOfInterest: Array.from({ length: i + 1 }, () => ({ title: 'Synthetic POI' })),
    }));
    await Trip.collection.insertMany(trips);
    await Recommendation.collection.insertMany([null, ...trips.map(trip => trip._id)].map(associatedTrip => ({
      user: owner._id, name: 'Synthetic recommendation', associatedTrip,
    })));
    app = start(process.execPath, ['-e', "const http=require('node:http');const original=http.Server.prototype.listen;http.Server.prototype.listen=function(port,...args){return original.call(this,port,'127.0.0.1',...args)};require('./server.js')"], {
      PATH: process.env.PATH, NODE_ENV: 'development', EMAIL_MODE: 'disabled', PORT: String(apiPort), MONGO_URI: uri,
      JWT_SECRET: 'public-disposable-profile-fixture-not-for-deployment', JWT_COOKIE_EXPIRE: '1', FRONTEND_URL: 'http://localhost:3000',
    });
    await ready(app, `Server running in development mode on port ${apiPort}`);
    const request = (url, options = {}) => fetch(base + url, { ...options, signal: AbortSignal.timeout(10000) });
    const sessions = new Map();
    for (const user of [owner, follower, stranger]) {
      const csrfResponse = await request('/csrf-token');
      const csrf = (await csrfResponse.json()).csrfToken;
      const cookie = csrfResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: cookie };
      const response = await request('/auth/login', { method: 'POST', headers, body: JSON.stringify({ email: user.email, password: PASSWORD }) });
      assert.equal(response.status, 200);
      sessions.set(user.id, { ...headers, Authorization: `Bearer ${(await response.json()).token}` });
    }
    const get = async (url, user) => {
      const response = await request(url, { headers: user ? sessions.get(user.id) : {} });
      assert.equal(response.status, 200, `${url}: HTTP status`);
      return response.json();
    };

    for (const viewer of [null, stranger]) {
      const body = await get(`/users/v2/users/${owner.id}/followers`, viewer);
      exactKeys(body, ['data', 'total']); assert.equal(body.total, 2);
      assertList(body.data, [follower, zeta]);
      assert.equal(body.data[0].followers.includes(stranger.id), true, 'Mobile follow-button fallback survives');
      check(`V2 followers exact allowlist with every secret and unknown field excluded (${viewer ? 'authenticated other' : 'anonymous'})`);
    }
    const paged = await get(`/users/v2/users/${owner.id}/followers?page=2&limit=1`);
    assert.equal(paged.total, 2); assertList(paged.data, [zeta]);
    assert.deepEqual(await get(`/users/v2/users/${owner.id}/followers?page=3&limit=1`), { data: [], total: 2 });
    assert.deepEqual(await get(`/users/v2/users/${stranger.id}/followers`), { data: [], total: 0 });
    check('V2 follower sort, pagination, total and empty-list contracts preserved');

    // This handler is intentionally not exposed by a new HTTP route. Exercise
    // its actual Mongo aggregation directly, with the same anonymous/other users.
    const { getUserFollowingV2 } = require('../controllers/userController');
    for (const viewer of [null, stranger]) {
      let body;
      await getUserFollowingV2({ params: { userId: owner.id }, query: {}, user: viewer }, { json(value) { body = value; } }, error => { throw error; });
      exactKeys(body, ['data', 'total']); assert.equal(body.total, 1);
      assertList(body.data, [followed]);
      check(`Dormant V2 following actual Mongo projection excludes current/future secrets (${viewer ? 'authenticated other' : 'anonymous'})`);
    }
    assert.equal((await request(`/users/v2/users/${owner.id}/following`)).status, 404);
    check('V2 following remains unmounted');

    for (const [suffix, expected] of [['followers', [follower, zeta]], ['following', [followed]]]) {
      for (const viewer of [null, stranger]) {
        const body = await get(`/users/${owner.id}/${suffix}`, viewer);
        exactKeys(body, ['data', 'page', 'limit', 'totalPages', 'totalCount']);
        assert.equal(body.page, 1); assert.equal(body.limit, 15); assert.equal(body.totalPages, 1);
        assert.equal(body.totalCount, expected.length); assertList(body.data, expected);
        assert.equal(body.data[0].followers.includes(stranger.id), true, 'Legacy follow-button fallback survives');
      }
      const body = await get(`/users/${owner.id}/${suffix}?page=2&limit=1`);
      assert.equal(body.totalCount, expected.length); assert.equal(body.totalPages, expected.length);
      assertList(body.data, expected.slice(1, 2));
      check(`Legacy ${suffix} exact row fields, follow-button data and pagination unchanged`);
    }

    for (const [role, viewer, count, distance, pois, recs] of [
      ['anonymous', null, 1, 100, 1, 2], ['stranger', stranger, 1, 100, 1, 2],
      ['follower', follower, 2, 301, 3, 3], ['owner', owner, 3, 701, 6, 4],
    ]) {
      for (const publicRoute of [true, false]) {
        const body = await get(`/users/${publicRoute ? 'user/' : ''}${owner.id}`, viewer);
        const extras = publicRoute ? ['isFollowing', 'isOwnProfile'] : role === 'owner' ? ['settings'] : [];
        exactKeys(body, [...PROFILE_FIELDS, ...extras]);
        assert.equal(body._id, owner.id);
        for (const field of ['username', 'bio', 'city', 'country', 'profilePictureUrl']) assert.equal(body[field], owner[field]);
        assert.equal(body.createdAt, owner.createdAt.toISOString());
        for (const [field, expected] of Object.entries({ totalTrips: count, totalDistance: distance, totalPois: pois, totalRecommendations: recs, followersCount: 2, followingCount: 1 })) {
          assert.equal(body[field], expected, `${role} ${field}`);
        }
        if (publicRoute) {
          assert.equal(body.isFollowing, role === 'follower'); assert.equal(body.isOwnProfile, role === 'owner');
        } else if (role === 'owner') assert.equal(body.settings.defaultTripVisibility, 'private');
      }
      check(`${role}: rich profile/header/location, all six stats and follow-state preserved with correct privacy`);
    }

    await User.updateOne({ _id: zeta._id }, { $set: { city: null, country: null } });
    const noLocation = await get(`/users/user/${zeta.id}`);
    assert.equal(noLocation.city, null); assert.equal(noLocation.country, null);
    check('Public profile preserves unset city/country as null');

    const anonymousCsrf = await request('/csrf-token');
    const anonymousHeaders = { 'Content-Type': 'application/json', 'X-CSRF-Token': (await anonymousCsrf.json()).csrfToken,
      Cookie: anonymousCsrf.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
    assert.equal((await request('/users/me', { method: 'PUT', headers: anonymousHeaders, body: '{}' })).status, 401);
    assert.equal((await request('/users/settings')).status, 401);
    assert.equal((await get('/users/settings', owner)).defaultTripVisibility, 'private');
    const ownerBefore = await User.collection.findOne({ _id: owner._id });
    const response = await request('/users/me', { method: 'PUT', headers: sessions.get(stranger.id), body: JSON.stringify({
      userId: owner.id, _id: owner.id, username: 'Synthetic edited stranger', bio: 'Updated public bio', city: 'Updated city', country: 'Updated country',
    }) });
    assert.equal(response.status, 200);
    const edited = await response.json();
    assert.equal(edited._id, stranger.id); assert.equal(edited.email, stranger.email);
    assert.equal(edited.token === sessions.get(stranger.id).Authorization.slice(7), true, 'Editor preserves the caller session token');
    assert.equal(edited.city, 'Updated city'); assert.equal(edited.country, 'Updated country');
    assert.equal(edited.profilePictureUrl, stranger.profilePictureUrl);
    assert.equal(JSON.stringify(await User.collection.findOne({ _id: owner._id })) === JSON.stringify(ownerBefore), true, 'Editor must not mutate supplied target ID');
    const updatedPublic = await get(`/users/user/${stranger.id}`);
    exactKeys(updatedPublic, [...PROFILE_FIELDS, 'isFollowing', 'isOwnProfile']);
    assert.equal(updatedPublic.city, edited.city); assert.equal(updatedPublic.country, edited.country);
    check('Owner settings and authenticated self-editor contract preserved; supplied target ID ignored');
    console.log(`Public user responses integration result: ${passed} checks passed; synthetic disposable data only.`);
  } finally {
    await stop(app);
    if (mongoose.connection.readyState) await mongoose.disconnect();
    await stop(mongo);
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

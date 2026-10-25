// Real Discover + unchanged Following HTTP routes against disposable local MongoDB.
// Never accepts a database URI, loads .env, or connects to an existing database.
// Usage: MONGOD_BINARY=/path/to/verified/official/mongod node scripts/discover-feed-integration.cjs
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
const PASSWORD = 'disposable-discover-fixture-password';
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
  const dir = await mkdtemp(path.join(tmpdir(), 'travel-discover-'));
  let mongo, app, passed = 0;
  const check = label => { passed++; console.log(`PASS ${label}`); };
  try {
    const mongoPort = await freePort(), apiPort = await freePort();
    const uri = `mongodb://127.0.0.1:${mongoPort}/discover_fixture`;
    const base = `http://127.0.0.1:${apiPort}/api`;
    mongo = start(process.env.MONGOD_BINARY, ['--dbpath', dir, '--bind_ip', '127.0.0.1', '--port', String(mongoPort), '--nounixsocket', '--wiredTigerCacheSizeGB', '0.25'], { PATH: process.env.PATH });
    await ready(mongo, 'Waiting for connections');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const User = require('../models/User'), Trip = require('../models/Trip'), Recommendation = require('../models/Recommendation');
    await Promise.all([User.init(), Trip.init(), Recommendation.init()]);
    console.log('Disposable MongoDB:', (await mongoose.connection.db.admin().command({ buildInfo: 1 })).version);
    const createUser = (name, extra = {}) => User.create({ username: `Synthetic ${name}`, email: `${name}@example.com`, password: PASSWORD, isEmailVerified: true, ...extra });
    const viewer = await createUser('viewer');
    const followed = await createUser('followed', { city: 'Fixture city', country: 'Fixture country', profilePictureUrl: 'fixture-avatar' });
    const stranger = await createUser('stranger');
    const noFollows = await createUser('no-follows');
    await User.updateOne({ _id: viewer._id }, { $set: { following: [followed._id] } });
    await User.updateOne({ _id: followed._id }, { $set: { followers: [viewer._id] } });
    app = start(process.execPath, ['-e', "const http=require('node:http');const original=http.Server.prototype.listen;http.Server.prototype.listen=function(port,...args){return original.call(this,port,'127.0.0.1',...args)};require('./server.js')"], {
      PATH: process.env.PATH, NODE_ENV: 'development', EMAIL_MODE: 'disabled', PORT: String(apiPort), MONGO_URI: uri,
      JWT_SECRET: 'public-disposable-discover-fixture-not-for-deployment', JWT_COOKIE_EXPIRE: '1', FRONTEND_URL: 'http://localhost:3000',
    });
    await ready(app, 'MongoDB Connected');
    const request = (url, options = {}) => fetch(base + url, { ...options, signal: AbortSignal.timeout(10000) });
    const login = async user => {
      const csrfResponse = await request('/csrf-token');
      const csrf = (await csrfResponse.json()).csrfToken;
      const cookie = csrfResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const response = await request('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: cookie }, body: JSON.stringify({ email: user.email, password: PASSWORD }) });
      assert.equal(response.status, 200);
      return (await response.json()).token;
    };
    const viewerToken = await login(viewer), noFollowsToken = await login(noFollows);
    const get = async (url, token = viewerToken) => {
      const response = await request(url, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200, `${url}: unexpected HTTP status`);
      return response.json();
    };
    const discover = '/v2/trips/json/discover';
    assert.equal((await request(discover)).status, 401);
    assert.equal((await request(discover, { headers: { Authorization: 'Bearer invalid-synthetic-token' } })).status, 401);
    check('Discover requires actual bearer authentication; anonymous/invalid token fail 401');
    assert.deepEqual(await get(discover), { items: [], page: 1, limit: 10, totalPages: 0, totalCount: 0 });
    check('empty database returns exact empty feed envelope');

    const O = mongoose.Types.ObjectId;
    const createTrip = (id, user, day, extra = {}) => Trip.create({
      _id: new O(id.toString(16).padStart(24, '0')), user: user._id, title: `Synthetic trip ${id}`,
      format: 'json', defaultTripVisibility: 'public', defaultTravelMode: 'motorhome',
      description: 'Synthetic public route', durationMillis: 60000, distanceMeters: 1234,
      startDate: new Date('2026-01-01T00:00:00Z'), createdAt: new Date(`2026-10-${day}T12:00:00Z`),
      simplifiedRoute: { type: 'LineString', coordinates: [[4, 50], [4.01, 50.01]] },
      startLocationName: 'Fixture start', endLocationName: 'Fixture end', ...extra,
    });
    const old = await createTrip(1, stranger, '01', { startDate: new Date('2027-01-01T00:00:00Z') });
    const followedPublic = await createTrip(2, followed, '03', {
      description: '🚐'.repeat(160), likes: [viewer._id, stranger._id],
      comments: [{ user: viewer._id, text: 'Synthetic one' }, { user: stranger._id, text: 'Synthetic two' }],
      startDate: new Date('2026-02-01T00:00:00Z'),
    });
    const tied = await createTrip(3, stranger, '03');
    const own = await createTrip(4, viewer, '02');
    const newest = await createTrip(5, stranger, '04', { startDate: new Date('2020-01-01T00:00:00Z') });
    const followedOnly = await createTrip(6, followed, '09', { defaultTripVisibility: 'followers_only', startDate: new Date('2026-03-01T00:00:00Z') });
    await createTrip(7, followed, '10', { defaultTripVisibility: 'private' });
    await createTrip(8, stranger, '10', { defaultTripVisibility: 'followers_only' });
    await createTrip(9, stranger, '11', { defaultTripVisibility: 'private' });
    await createTrip(10, viewer, '11', { defaultTripVisibility: 'private' });
    await createTrip(11, stranger, '12', { format: 'gpx', gpxFileRef: 'synthetic-unread-file', endDate: new Date('2026-01-01T00:01:00Z') });
    await Recommendation.create([1, 2].map(i => ({ user: followed._id, name: `Synthetic recommendation ${i}`, description: 'Fixture only', rating: 3, primaryCategory: 'OTHER', location: { type: 'Point', coordinates: [4, 50] }, associatedTrip: followedPublic._id })));
    const expected = [newest, tied, followedPublic, own, old].map(trip => trip.id);
    const full = await get(discover);
    assert.deepEqual(full.items.map(trip => trip._id), expected);
    assert.equal(full.totalCount, 5); assert.equal(full.totalPages, 1);
    check('Discover includes followed, stranger and own PUBLIC JSON trips only, sorted by upload not recording date');
    const pages = [];
    for (let page = 1; page <= 3; page++) {
      const result = await get(`${discover}?page=${page}&limit=2`);
      assert.equal(result.page, page); assert.equal(result.limit, 2); assert.equal(result.totalPages, 3); assert.equal(result.totalCount, 5);
      pages.push(...result.items.map(trip => trip._id));
    }
    assert.deepEqual(pages, expected); assert.equal(new Set(pages).size, 5);
    assert.deepEqual((await get(`${discover}?page=2&limit=2`)).items.map(trip => trip._id), expected.slice(2, 4));
    const beyond = await get(`${discover}?page=4&limit=2`);
    assert.deepEqual(beyond.items, []); assert.equal(beyond.totalCount, 5); assert.equal(beyond.totalPages, 3);
    check('equal-createdAt _id tie break is stable across page boundaries/repeats, with exact totals and end page');
    const card = full.items.find(trip => trip._id === followedPublic.id);
    assert.deepEqual(card.user, { _id: followed.id, username: followed.username, profilePictureUrl: 'fixture-avatar', city: 'Fixture city', country: 'Fixture country' });
    assert.equal(card.likesCount, 2); assert.equal(card.commentsCount, 2); assert.equal(card.recommendationCount, 2); assert.equal(card.isLikedByCurrentUser, true);
    assert.equal(card.description, '🚐'.repeat(150));
    assert.deepEqual(card.simplifiedRoute, { type: 'LineString', coordinates: [[4, 50], [4.01, 50.01]] });
    assert.equal(card.distanceMeters, 1234); assert.equal(card.durationMillis, 60000);
    assert.equal(card.defaultTravelMode, 'motorhome'); assert.equal(card.defaultTripVisibility, 'public');
    assert.equal(card.startLocationName, 'Fixture start'); assert.equal(card.endLocationName, 'Fixture end');
    assert.equal(card.createdAt, followedPublic.createdAt.toISOString());
    assert.equal((await get(`/v2/trips/json/${card._id}`))._id, card._id);
    check('actual card shape includes author, map, Unicode snippet, counts, viewer-like state and existing detail navigation');
    const other = await get(discover, noFollowsToken);
    assert.deepEqual(other.items.map(trip => trip._id), expected);
    assert.equal(other.items.find(trip => trip._id === followedPublic.id).isLikedByCurrentUser, false);
    assert.deepEqual((await get('/v2/trips/json/feed', noFollowsToken)).items, []);
    check('no-follow account still discovers all public trips; Following remains empty and likes are account-specific');
    const following = await get('/v2/trips/json/feed');
    assert.deepEqual(following.items.map(trip => trip._id), [followedOnly.id, followedPublic.id]);
    assert.equal(following.totalCount, 2);
    assert.deepEqual(Object.keys(following.items[1]).sort(), Object.keys(card).sort());
    assert.deepEqual(following.items[1], card);
    check('Following retains followed public/followers-only filter and startDate ordering; shared card data exactly matches');
    for (const visibility of ['private', 'followers_only']) {
      await Trip.updateOne({ _id: newest._id }, { $set: { defaultTripVisibility: visibility } });
      const result = await get(discover);
      assert.equal(result.totalCount, 4); assert(!result.items.some(trip => trip._id === newest.id));
    }
    await Trip.updateOne({ _id: newest._id }, { $set: { defaultTripVisibility: 'public' } });
    assert.equal((await get(discover)).totalCount, 5);
    assert.equal((await request(discover, { headers: { Authorization: `Bearer ${viewerToken}` } })).headers.get('cache-control'), 'private, no-store');
    check('visibility changes are reflected on fresh reads/counts; HTTP response forbids shared/stale caching');
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1abc', 'page=', 'page=1&page=2', 'limit=0', 'limit=-1', 'limit=101', 'limit=1.5', 'limit=1&limit=2', 'page=9007199254740992', 'page=9007199254740991&limit=100']) {
      assert.equal((await request(`${discover}?${query}`, { headers: { Authorization: `Bearer ${viewerToken}` } })).status, 400, query);
    }
    assert.equal((await get(`${discover}?limit=100`)).limit, 100);
    check('HTTP pagination rejects malformed, duplicate, excessive and unsafe values; maximum supported limit works');
    const key = { format: 1, defaultTripVisibility: 1, createdAt: -1, _id: -1 };
    const index = (await Trip.collection.indexes()).find(index => JSON.stringify(index.key) === JSON.stringify(key));
    assert(index, 'Discover compound index must exist');
    const plan = await Trip.find({ format: 'json', defaultTripVisibility: 'public' }).sort({ createdAt: -1, _id: -1 }).limit(2).explain('executionStats');
    const stages = [];
    const visit = node => { if (!node || typeof node !== 'object') return; if (node.stage) stages.push(node.stage); for (const value of Object.values(node)) visit(value); };
    visit(plan.queryPlanner.winningPlan);
    assert(stages.includes('IXSCAN')); assert(!stages.includes('SORT')); assert.equal(plan.executionStats.nReturned, 2);
    check('real compound index serves public JSON newest-upload query without blocking SORT');
    console.log(`Discover integration result: ${passed} checks passed; synthetic disposable data only.`);
  } finally {
    await stop(app);
    if (mongoose.connection.readyState) await mongoose.disconnect();
    await stop(mongo);
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

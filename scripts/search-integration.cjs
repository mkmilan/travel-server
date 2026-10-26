// Real Search privacy, pagination, card payloads and protected media HTTP routes against disposable local MongoDB.
// Never accepts a database URI, loads .env, or connects to an existing database.
// Usage: MONGOD_BINARY=/path/to/verified/official/mongod node scripts/search-integration.cjs
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
const PASSWORD = 'disposable-search-fixture-password';
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
  const dir = await mkdtemp(path.join(tmpdir(), 'travel-search-'));
  let mongo, app, passed = 0;
  const check = label => { passed++; console.log(`PASS ${label}`); };
  try {
    const mongoPort = await freePort(), apiPort = await freePort();
    const uri = `mongodb://127.0.0.1:${mongoPort}/search_fixture`;
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
      JWT_SECRET: 'public-disposable-search-fixture-not-for-deployment', JWT_COOKIE_EXPIRE: '1', FRONTEND_URL: 'http://localhost:3000',
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
    const viewerToken = await login(viewer), noFollowsToken = await login(noFollows), followedToken = await login(followed);
    const get = async (url, token = viewerToken) => {
      const response = await request(url, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200, `${url}: unexpected HTTP status`);
      return response.json();
    };
    const search = (type, extra = {}, token = viewerToken) => get('/v2/search?' + new URLSearchParams({ q: 'Searchfixture', type, envelope: 'true', ...extra }), token);
    for (const token of ['', 'invalid-synthetic-token']) {
      assert.equal((await request('/v2/search?q=Searchfixture&type=trips&envelope=true', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
    }
    assert.deepEqual(await search('trips'), { results: [], page: 1, limit: 20, total: 0, hasMore: false });
    check('mobile envelope requires real bearer identity, empty results have reliable metadata');
    const O = mongoose.Types.ObjectId;
    const oid = n => new O(n.toString(16).padStart(24, '0'));
    const date = new Date('2026-01-01T12:00:00Z');
    const later = new Date('2026-10-01T12:00:00Z');
    const createTrip = (id, user, extra = {}) => Trip.create({
      _id: oid(id), user: user._id, title: `Searchfixture trip ${id}`,
      format: 'json', defaultTripVisibility: 'public', defaultTravelMode: 'campervan',
      description: 'Fixture description coastal journey', durationMillis: 60000, distanceMeters: 1234,
      startDate: date, createdAt: date, simplifiedRoute: { type: 'LineString', coordinates: [[4, 50], [4.01, 50.01]] },
      startLocationName: 'Fromtown', endLocationName: 'Totown', ...extra,
    });
    const publicTrip = await createTrip(1, followed, { likes: [viewer._id, stranger._id], comments: [{ user: viewer._id, text: 'Synthetic comment' }] });
    const followerTrip = await createTrip(2, followed, { defaultTripVisibility: 'followers_only' });
    const strangerPublic = await createTrip(3, stranger);
    const undated = await createTrip(4, stranger, { startDate: undefined });
    const ownPrivate = await createTrip(7, viewer, { defaultTripVisibility: 'private' });
    const ownFollower = await createTrip(8, viewer, { defaultTripVisibility: 'followers_only' });
    const hidden = [];
    for (let id = 101; id <= 105; id++) hidden.push(await createTrip(id, followed, { defaultTripVisibility: 'private', startDate: later }));
    const strangerFollower = await createTrip(106, stranger, { defaultTripVisibility: 'followers_only', startDate: later });
    const gpx = await createTrip(107, stranger, { format: 'gpx', gpxFileRef: 'synthetic-gpx', endDate: later, startDate: later });
    await createTrip(108, { _id: oid(9999) }, { startDate: later });
    const expectedTrips = [ownFollower, ownPrivate, strangerPublic, followerTrip, publicTrip, undated].map(trip => trip.id);
    const full = await search('trips');
    assert.deepEqual(full.results.map(trip => trip._id), expectedTrips); assert.equal(full.total, 6); assert.equal(full.hasMore, false);
    check('trip privacy, existing author and JSON format filter BEFORE pagination: newest hidden matches cannot erase a visible page');
    const collected = [];
    for (let page = 1; page <= 4; page++) {
      const result = await search('trips', { page, limit: 2 });
      assert.equal(result.total, 6); assert.equal(result.hasMore, page < 3);
      assert.equal(result.page, page); assert.equal(result.limit, 2);
      collected.push(...result.results.map(trip => trip._id));
    }
    assert.deepEqual(collected, expectedTrips); assert.equal(new Set(collected).size, 6);
    assert.deepEqual((await search('trips', { page: 2, limit: 2 })).results.map(trip => trip._id), expectedTrips.slice(2, 4));
    check('trip equal-date _id ties and missing dates paginate deterministically, with visible-only totals/hasMore/end pages');
    assert.deepEqual((await search('trips', {}, noFollowsToken)).results.map(trip => trip._id), [strangerPublic.id, publicTrip.id, undated.id]);
    const ownerResults = await search('trips', {}, followedToken);
    assert(hidden.every(trip => ownerResults.results.some(item => item._id === trip.id)));
    assert(ownerResults.results.some(item => item._id === followerTrip.id));
    assert(!ownerResults.results.some(item => item._id === ownPrivate.id));
    const bare = await request('/v2/search?q=Searchfixture&type=trips');
    assert.equal(bare.status, 200);
    assert.deepEqual((await bare.json()).map(trip => trip._id), [strangerPublic.id, publicTrip.id, undated.id]);
    check('owner/follower/stranger/anonymous visibility matrix and existing bare-array optional-auth contract are preserved');

    const createRec = (id, user, associatedTrip, extra = {}) => Recommendation.create({
      _id: oid(id), user: user._id, name: `Searchfixture place ${id}`, description: 'Quiet riverside overnight stop',
      rating: 4, primaryCategory: 'WILD_SPOT', location: { type: 'Point', coordinates: [4, 50] },
      attributeTags: ['QUIET', 'SCENIC'], associatedTrip: associatedTrip?._id, createdAt: date, ...extra,
    });
    const recPublic = await createRec(201, followed, publicTrip);
    const recFollower = await createRec(202, followed, followerTrip);
    await createRec(203, followed, hidden[0], { createdAt: later });
    const recStranger = await createRec(204, stranger, strangerPublic, { primaryCategory: 'CAFE' });
    const ownStandalone = await createRec(205, viewer, null);
    const otherStandalone = await createRec(206, followed, null, { createdAt: later });
    await createRec(207, viewer, { _id: oid(9998) }, { createdAt: later });
    await createRec(208, viewer, publicTrip, { createdAt: later });
    await createRec(209, followed, ownPrivate, { createdAt: later });
    const recOwnPrivate = await createRec(210, viewer, ownPrivate);
    await createRec(211, { _id: oid(9999) }, { _id: oid(108) }, { createdAt: later });
    await createRec(212, stranger, strangerFollower, { createdAt: later });
    const recGpx = await createRec(213, stranger, gpx);
    const expectedRecs = [recGpx, recOwnPrivate, ownStandalone, recStranger, recFollower, recPublic].map(rec => rec.id);
    const allRecs = await search('recommendations');
    assert.deepEqual(allRecs.results.map(rec => rec._id), expectedRecs); assert.equal(allRecs.total, 6);
    const recPages = [];
    for (let page = 1; page <= 4; page++) {
      const result = await search('recommendations', { page, limit: 2 });
      assert.equal(result.total, 6); assert.equal(result.hasMore, page < 3);
      recPages.push(...result.results.map(rec => rec._id));
    }
    assert.deepEqual(recPages, expectedRecs);
    check('recommendation search filters standalone-other/private/orphan/foreign/missing-author matches BEFORE pages and visible counts');
    const ownerRecs = await search('recommendations', {}, followedToken);
    assert(ownerRecs.results.some(rec => rec._id === otherStandalone.id));
    assert(ownerRecs.results.some(rec => rec._id === oid(203).toString()));
    assert(!ownerRecs.results.some(rec => rec._id === oid(209).toString()));
    assert.deepEqual((await search('recommendations', {}, noFollowsToken)).results.map(rec => rec._id), [recGpx.id, recStranger.id, recPublic.id]);
    assert.deepEqual((await get('/v2/search?q=Searchfixture&type=recommendations', '')).map(rec => rec._id), [recGpx.id, recStranger.id, recPublic.id]);
    check('only own standalone recommendations surface; valid associated GPX recommendations still inherit visibility without changing GPX code');
    // The global legacy detail policy remains deliberately unchanged.
    assert.equal((await request(`/recommendations/${otherStandalone.id}`)).status, 200);
    check('legacy standalone recommendation detail stays public; search does not change global visibility policy');
    const categoryResults = await search('recommendations', { category: 'WILD_SPOT', q: 'riverside' });
    assert.deepEqual(categoryResults.results.map(rec => rec._id), expectedRecs.filter(id => id !== recStranger.id));
    assert.equal(categoryResults.total, 5);
    assert.deepEqual((await search('recommendations', { category: 'CAFE', q: 'riverside' })).results.map(rec => rec._id), [recStranger.id]);
    assert.deepEqual((await search('recommendations', { category: 'CAMPSITE', q: 'riverside' })).results, []);
    check('recommendation text includes description; category enum is an exact additional filter, never a category-only catalog request');

    const card = (await search('trips')).results.find(trip => trip._id === publicTrip.id);
    assert.deepEqual(card.user, { _id: followed.id, username: followed.username, profilePictureUrl: 'fixture-avatar', city: 'Fixture city', country: 'Fixture country' });
    assert.equal(card.likesCount, 2); assert.equal(card.commentsCount, 1); assert.equal(card.recommendationCount, 1); assert.equal(card.isLikedByCurrentUser, true);
    assert.equal(card.defaultTravelMode, 'campervan'); assert.equal(card.distanceMeters, 1234); assert.equal(card.durationMillis, 60000);
    assert.equal(card.startLocationName, 'Fromtown'); assert.equal(card.endLocationName, 'Totown');
    assert.deepEqual(card.simplifiedRoute.coordinates, [[4, 50], [4.01, 50.01]]);
    assert.equal((await search('trips', {}, noFollowsToken)).results.find(trip => trip._id === publicTrip.id).isLikedByCurrentUser, false);
    assert.equal((await get(`/v2/trips/json/${card._id}`))._id, card._id);
    for (const row of [...full.results, ...allRecs.results]) {
      assert.equal(row.user.followers, undefined); assert.equal(row.user.email, undefined); assert.equal(row.user.password, undefined);
      assert.equal(row.likes, undefined); assert.equal(row.comments, undefined);
    }
    check('trip cards have authoritative viewer-specific social/travel/map/author fields, same-owner recommendation count and existing detail route');
    const recCard = allRecs.results.find(rec => rec._id === recPublic.id);
    assert.equal(recCard.associatedTrip, publicTrip.id); assert.deepEqual(recCard.attributeTags, ['QUIET', 'SCENIC']);
    assert.deepEqual(recCard.location.coordinates, [4, 50]); assert.equal(recCard.rating, 4);
    assert.equal((await get(`/recommendations/${recCard._id}`))._id, recCard._id);
    check('recommendation search payload opens existing detail with author, category, location, attributes and associated trip intact');

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'gpxUploads' });
    const photo = bucket.openUploadStream('synthetic-search.png', { contentType: 'image/png', metadata: { userId: followed.id, tripId: publicTrip.id } });
    const finished = once(photo, 'finish'); photo.end(Buffer.from('synthetic fixture image bytes')); await finished;
    await Trip.updateOne({ _id: publicTrip._id }, { $push: { photos: photo.id.toString() } });
    await Recommendation.updateOne({ _id: recPublic._id }, { $push: { photos: photo.id.toString() } });
    const withPhoto = (await search('recommendations')).results.find(rec => rec._id === recPublic.id);
    assert.deepEqual(withPhoto.photos, [photo.id.toString()]); assert.equal(withPhoto.coverPhotoUrl, photo.id.toString());
    const photoResponse = await request(`/photos/${withPhoto.photos[0]}`, { headers: { Authorization: `Bearer ${viewerToken}` } });
    assert.equal(photoResponse.status, 200); assert.equal(await photoResponse.text(), 'synthetic fixture image bytes');
    check('real GridFS recommendation thumbnail uses returned photo IDs through existing authorized media route (no photo upload/gallery changes)');

    // Match each intended text field, literal punctuation and Unicode, not geographic routing.
    for (const q of ['coastal journey', 'Fromtown', 'Totown']) assert.equal((await search('trips', { q })).total, 6);
    const unicodeTrip = await createTrip(300, stranger, { title: '東京 café .* (( [x] \\d', description: 'Literal text only' });
    for (const q of ['東京', 'CAFÉ', '.*', '((', '[x]', '\\d']) assert.deepEqual((await search('trips', { q })).results.map(trip => trip._id), [unicodeTrip.id]);
    assert.equal((await search('trips', { q: 'cafe' })).total, 0);
    const literalRec = await createRec(301, stranger, unicodeTrip, { name: 'A literal .* stop', description: '東京 café (( [x] \\d' });
    for (const q of ['東京', 'CAFÉ', '.*', '((', '[x]', '\\d']) assert.deepEqual((await search('recommendations', { q })).results.map(rec => rec._id), [literalRec.id]);
    check('trip title/description/from/to and recommendation name/description match escaped case-insensitive Unicode literals; no regex expansion or accent folding');

    await User.collection.insertMany([
      { _id: oid(400), username: 'Peoplefixture 東京 café .*', createdAt: date, email: 'never-return-one@example.com', password: 'never-return-secret', city: 'One', country: 'Two' },
      { _id: oid(401), username: 'Peoplefixture second', createdAt: date, email: 'never-return-two@example.com', password: 'never-return-secret' },
      { _id: oid(402), username: 'Peoplefixture third', createdAt: date },
    ]);
    const people = [];
    for (let page = 1; page <= 4; page++) {
      const result = await search('users', { q: 'Peoplefixture', page, limit: 1 });
      assert.equal(result.total, 3); assert.equal(result.hasMore, page < 3); people.push(...result.results);
    }
    assert.deepEqual(people.map(user => user._id), [402, 401, 400].map(id => oid(id).toString()));
    assert(people.every(user => !user.password && !user.email && !user.followers));
    assert.deepEqual((await search('users', { q: '東京' })).results.map(user => user._id), [oid(400).toString()]);
    assert.deepEqual((await search('users', { q: '.*' })).results.map(user => user._id), [oid(400).toString()]);
    assert.equal((await search('users', { q: 'Synthetic viewer' })).total, 0);
    assert.equal((await search('users', { q: 'a b' })).total, 0);
    check('People username literal matching, Unicode, self exclusion, minimal public fields, tie-stable paging and no dropped-token all-users query');

    const badQueries = [
      'q=', 'q=a', 'q=%20%20', `q=${'x'.repeat(121)}`, 'q=a&q=b', 'type=trip', 'type=users&type=trips',
      'page=0', 'page=-1', 'page=1.5', 'page=1abc', 'page=', 'page=1&page=2',
      'limit=0', 'limit=51', 'limit=1.5', 'limit=1&limit=2', 'page=9007199254740992', 'page=9007199254740991&limit=50',
      'envelope=1', 'envelope=true&envelope=false', 'category=WILD_SPOT',
    ];
    for (const query of badQueries) {
      const [field] = query.split('=');
      const baseParams = { q: 'Searchfixture', type: 'trips', envelope: 'true' }; delete baseParams[field];
      const response = await request(`/v2/search?${new URLSearchParams(baseParams)}&${query}`, { headers: { Authorization: `Bearer ${viewerToken}` } });
      assert.equal(response.status, 400, query);
    }
    for (const category of ['', 'Wild spot', 'WILD SPOT', 'BOGUS']) {
      const response = await request('/v2/search?' + new URLSearchParams({ q: 'Searchfixture', type: 'recommendations', envelope: 'true', category }), { headers: { Authorization: `Bearer ${viewerToken}` } });
      assert.equal(response.status, 400, category);
    }
    assert.equal((await search('trips', { limit: 50 })).limit, 50);
    assert.equal((await request('/v2/search/users?q=a%20b')).status, 400);
    const header = await request('/v2/search?q=Searchfixture&type=trips&envelope=true', { headers: { Authorization: `Bearer ${viewerToken}` } });
    assert.equal(header.headers.get('cache-control'), 'private, no-store');
    check('real HTTP rejects malformed/duplicate/unsafe pagination, query, category and envelope params; caps are explicit and shared/stale caching is forbidden');

    await Trip.updateOne({ _id: publicTrip._id }, { $set: { defaultTripVisibility: 'private' } });
    assert(!(await search('trips')).results.some(trip => trip._id === publicTrip.id));
    assert(!(await search('recommendations')).results.some(rec => rec._id === recPublic.id));
    assert.equal((await request(`/photos/${photo.id}`, { headers: { Authorization: `Bearer ${viewerToken}` } })).status, 404);
    await User.updateOne({ _id: followed._id }, { $set: { followers: [] } });
    // viewer.following deliberately still contains followed: author.followers is authoritative.
    assert(!(await search('trips')).results.some(trip => trip._id === followerTrip.id));
    assert(!(await search('recommendations')).results.some(rec => rec._id === recFollower.id));
    assert.equal((await search('trips')).total, 4); assert.equal((await search('recommendations')).total, 4);
    check('fresh searches/counts/media respect changed trip privacy and unfollow state even when viewer.following is stale');
    await User.updateOne({ _id: followed._id }, { $set: { followers: [viewer._id] } });
    await Trip.updateOne({ _id: publicTrip._id }, { $set: { defaultTripVisibility: 'public' } });
    assert.equal((await search('trips')).total, 6); assert.equal((await search('recommendations')).total, 6);
    check('visibility restoration is reflected without stale cached search metadata');
    console.log(`Search integration result: ${passed} checks passed; synthetic disposable data only.`);
  } finally {
    await stop(app);
    if (mongoose.connection.readyState) await mongoose.disconnect();
    await stop(mongo);
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

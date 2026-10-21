const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canReadTrip, createMediaAccess } = require('../middleware/mediaAccess');
const { createCorsOptions } = require('../config/corsOptions');
const fs = require('node:fs');

const owner = 'a'.repeat(24), follower = 'b'.repeat(24), stranger = 'c'.repeat(24);
const file = 'd'.repeat(24);
const trip = (visibility = 'private') => ({ _id: file, user: { _id: owner, followers: [follower] }, defaultTripVisibility: visibility, gpxFileRef: file });
const query = value => ({ select() { return this; }, populate() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
function harness({ trips = [], associated = null, recommendations = [], avatar = false, metadata = { userId: owner } } = {}) {
	return createMediaAccess({
		Trip: { find: () => query(trips), findById: () => query(associated) },
		Recommendation: { find: () => query(recommendations) },
		User: { exists: async () => avatar },
		getFileMetadata: async () => metadata,
		isValidId: value => /^[a-f0-9]{24}$/.test(value),
	});
}
async function invoke(handler, user, params = { photoId: file, tripId: file }) {
	const result = { status: 200, headers: {}, next: false };
	const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; }, setHeader(key, value) { result.headers[key] = value; } };
	const req = { params, user: user && { _id: user } };
	await handler(req, res, error => { if (error) throw error; result.next = true; });
	return { ...result, req };
}

test('trip privacy matrix: owner, follower, stranger and anonymous', () => {
	for (const visibility of ['public', 'private', 'followers_only', undefined]) {
		const t = trip(visibility); if (visibility === undefined) delete t.defaultTripVisibility;
		assert.equal(canReadTrip(t, { _id: owner }), true);
		assert.equal(canReadTrip(t, { _id: follower }), ['public', 'followers_only'].includes(visibility));
		assert.equal(canReadTrip(t, { _id: stranger }), visibility === 'public');
		assert.equal(canReadTrip(t, null), visibility === 'public');
	}
	assert.equal(canReadTrip(null, { _id: owner }), false);
});
test('private GPX is blocked before streaming; owner gets authorized trip and no-store', async () => {
	const access = harness({ associated: trip() });
	for (const user of [null, stranger, follower]) assert.equal((await invoke(access.tripGpx, user)).status, 404);
	const allowed = await invoke(access.tripGpx, owner);
	assert.equal(allowed.next, true); assert.equal(allowed.req.mediaTrip.gpxFileRef, file);
	assert.equal(allowed.headers['Cache-Control'], 'private, no-store');
});
test('public GPX stays public, followers-only requires follower, missing/invalid deny', async () => {
	assert.equal((await invoke(harness({ associated: trip('public') }).tripGpx, null)).next, true);
	assert.equal((await invoke(harness({ associated: trip('followers_only') }).tripGpx, follower)).next, true);
	assert.equal((await invoke(harness().tripGpx, owner)).status, 404);
	assert.equal((await invoke(harness().tripGpx, owner, { tripId: 'bad' })).status, 400);
});
test('photos enforce trip visibility including followers and reject orphan IDs', async () => {
	assert.equal((await invoke(harness({ trips: [trip()] }).photo, stranger)).status, 404);
	assert.equal((await invoke(harness({ trips: [trip()] }).photo, owner)).next, true);
	assert.equal((await invoke(harness({ trips: [trip('public')] }).photo, null)).next, true);
	assert.equal((await invoke(harness({ trips: [trip('followers_only')] }).photo, follower)).next, true);
	assert.equal((await invoke(harness().photo, owner)).status, 404);
});
test('recommendation media inherits associated trip privacy; standalone photos and avatars remain public', async () => {
	const restricted = harness({ associated: trip(), recommendations: [{ associatedTrip: file }] });
	assert.equal((await invoke(restricted.photo, stranger)).status, 404);
	assert.equal((await invoke(restricted.photo, owner)).next, true);
	assert.equal((await invoke(harness({ recommendations: [{}] }).photo, null)).next, true);
	assert.equal((await invoke(harness({ avatar: true }).photo, null)).next, true);
	assert.equal((await invoke(harness({ recommendations: [{ associatedTrip: file }] }).photo, null)).status, 404);
});
test('CORS uses exact origin: reject lookalike hosts, ports, paths and null', () => {
	const options = createCorsOptions({ NODE_ENV: 'production', FRONTEND_URL: 'https://travel.example/' });
	for (const origin of ['https://travel.example.evil.test', 'https://travel.example:443', 'https://travel.example/path', 'null', 'http://localhost:3000']) {
		options.origin(origin, error => assert.ok(error));
	}
	for (const origin of ['https://travel.example', undefined]) options.origin(origin, (error, allowed) => { assert.equal(error, null); assert.equal(allowed, true); });
});
test('development CORS localhost defaults do not leak into production', () => {
	createCorsOptions({ NODE_ENV: 'development' }).origin('http://localhost:3000', (err, allowed) => assert.equal(allowed, true));
	createCorsOptions({ NODE_ENV: 'production' }).origin('http://localhost:3000', err => assert.ok(err));
});
test('file routes apply optional auth and media authorization before controller', () => {
	assert.match(fs.readFileSync('routes/tripRoutes.js', 'utf8'), /protectOptional, mediaAccess\.tripGpx, getTripGpx/);
	assert.match(fs.readFileSync('routes/photoRoutes.js', 'utf8'), /protectOptional, mediaAccess\.photo, getPhotoById/);
	const server = fs.readFileSync('server.js', 'utf8');
	assert.doesNotMatch(server, /cookiesSent:|csrfTokenInHeader:|bodyCsrfToken:/);
});

test('private source-trip metadata overrides forged public recommendation reference', async () => {
 const access = harness({ trips: [trip()], recommendations: [{}], avatar: true, metadata: { userId: owner, tripId: file } });
 assert.equal((await invoke(access.photo, stranger)).status, 404);
 assert.equal((await invoke(access.photo, owner)).next, true);
 assert.equal((await invoke(harness({ recommendations: [{}], metadata: { userId: owner, tripId: file } }).photo, stranger)).status, 404);
 assert.equal((await invoke(harness({ recommendations: [{}], metadata: null }).photo, stranger)).status, 404);
});
test('recommendation and avatar queries constrain stored owner, not attacker supplied links', async () => {
 const seen = [];
 const access = createMediaAccess({
  Trip: { find: filter => { seen.push(filter); return query([]); } },
  Recommendation: { find: filter => { seen.push(filter); return query([]); } },
  User: { exists: async filter => { seen.push(filter); return false; } },
  isValidId: () => true,
  getFileMetadata: async () => ({ userId: owner }),
 });
 assert.equal((await invoke(access.photo, stranger)).status, 404);
 assert.deepEqual(seen, [{ photos: file, user: owner }, { photos: file, user: owner }, { _id: owner, profilePictureUrl: file }]);
});

test('file ownership blocks stolen, orphan and legacy files regardless of reference', async () => {
 const { assertFileOwner, createPhotoOwnership } = require('../services/fileOwnership');
 const owned = { metadata: { userId: owner }, contentType: 'image/webp' };
 assert.doesNotThrow(() => assertFileOwner(owned, owner));
 for (const [candidate, user] of [[owned, stranger], [owned, null], [{}, owner], [null, owner]]) {
  assert.throws(() => assertFileOwner(candidate, user), { statusCode: 403 });
 }
 const check = createPhotoOwnership({ isValidId: () => true, findFile: async () => owned });
 await check([file], owner);
 await assert.rejects(check([file], stranger), { statusCode: 403 });
 await assert.rejects(createPhotoOwnership({ isValidId: () => true, findFile: async () => ({ ...owned, contentType: 'application/gpx+xml' }) })([file], owner), { statusCode: 400 });
});
test('every storage deletion supplies requester, and recommendation writes validate file ownership', () => {
 for (const path of ['controllers/tripController.js', 'controllers/userController.js', 'controllers/recommendationController.js', 'controllers/recommendationJsonController.js']) {
  const code = fs.readFileSync(path, 'utf8');
  const calls = code.match(/storageService\.deleteFile\([^;]+;/g) || [];
  for (const call of calls) assert.match(call, /, userId\);$/);
 }
 const storage = fs.readFileSync('services/storageService.js', 'utf8');
 assert.ok(storage.indexOf('assertFileOwner(files[0], userId)') < storage.indexOf('await gfs.delete'));
 const controller = fs.readFileSync('controllers/recommendationJsonController.js', 'utf8');
 assert.match(controller, /await assertOwnedPhotos\(finalPhotoIds, userId\)/);
 assert.match(controller, /await assertOwnedPhotos\(recommendation.photos \|\| \[\], userId\)/);
});

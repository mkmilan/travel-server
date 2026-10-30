const test = require('node:test');
const assert = require('node:assert/strict');
const Trip = require('../models/Trip');
const Recommendation = require('../models/Recommendation');
const { tripForDisplay } = require('../services/tripResponse');
const jsonController = require('../controllers/tripJsonController');
const legacyController = require('../controllers/tripController');
const owner = 'a'.repeat(24), follower = 'b'.repeat(24), stranger = 'c'.repeat(24), tripId = 'd'.repeat(24);
const internal = ['clientUploadId', 'uploadFingerprint', 'uploadComplete', 'uploadWriteVersion', 'uploadReceipt'];
function fixture(visibility = 'public') {
  return {
    _id: tripId, format: 'json', user: { _id: owner, username: 'Fixture', followers: [follower] },
    title: 'Current trip', defaultTripVisibility: visibility, photos: ['current-photo'],
    distanceMeters: 123, durationMillis: 456, segments: [],
    clientUploadId: 'recording-original', uploadFingerprint: 'canonical-fingerprint',
    uploadComplete: true, uploadWriteVersion: 3,
    uploadReceipt: [{ id: 'deleted-place', uploadId: 'place-original', name: 'Deleted private name', status: 'created' }],
  };
}
function query(value) { return { select() { return this; }, populate() { return this; }, lean: async () => value }; }
async function call(handler, user) {
  let status = 200, body, error;
  await handler({ params: { tripId }, user: user ? { _id: user } : undefined }, {
    status(code) { status = code; return this; }, json(value) { body = value; return this; },
  }, value => { error = value; });
  return { status, body, error };
}
function assertDisplay(body, source) {
  for (const key of internal) assert.equal(Object.hasOwn(body, key), false, key);
  assert.equal(body.title, source.title);
  assert.equal(body.distanceMeters, source.distanceMeters);
  assert.deepEqual(body.photos, source.photos);
  assert.equal(JSON.stringify(body).includes('Deleted private name'), false);
  assert.equal(source.uploadReceipt[0].name, 'Deleted private name');
  assert.equal(source.uploadComplete, true);
}
test('display serializer leaves canonical upload receipt and normal trip data unchanged', () => {
  const trip = fixture();
  const before = JSON.stringify(trip);
  assertDisplay(tripForDisplay(trip), trip);
  assert.equal(JSON.stringify(trip), before);
  assert.equal(tripForDisplay(null), null);
});
for (const [label, viewer, visibility] of [
  ['anonymous public', null, 'public'], ['stranger public', stranger, 'public'],
  ['follower', follower, 'followers_only'], ['owner private', owner, 'private'],
]) {
  test(`actual JSON detail hides historical receipt for ${label}`, async t => {
    const trip = fixture(visibility);
    t.mock.method(Trip, 'findById', () => query(trip));
    t.mock.method(Recommendation, 'find', () => query([]));
    const response = await call(jsonController.getTripJsonById, viewer);
    assert.equal(response.status, 200); assert.equal(response.error, undefined);
    assertDisplay(response.body, trip);
    assert.deepEqual(response.body.recommendations, []);
  });
}
for (const [label, viewer, visibility] of [
  ['stranger public', stranger, 'public'], ['follower', follower, 'followers_only'], ['owner private', owner, 'private'],
]) {
  test(`actual legacy detail also hides historical receipt for ${label}`, async t => {
    const trip = fixture(visibility);
    t.mock.method(Trip, 'findById', () => query(trip));
    const response = await call(legacyController.getTripById, viewer);
    assert.equal(response.status, 200); assert.equal(response.error, undefined);
    assertDisplay(response.body, trip);
  });
}
test('JSON denied and missing details still return no trip or historical receipt', async t => {
  let trip = fixture('private');
  t.mock.method(Trip, 'findById', () => query(trip));
  assert.equal((await call(jsonController.getTripJsonById, stranger)).status, 403);
  assert.equal((await call(jsonController.getTripJsonById, null)).status, 401);
  trip = null;
  assert.equal((await call(jsonController.getTripJsonById, stranger)).status, 404);
});

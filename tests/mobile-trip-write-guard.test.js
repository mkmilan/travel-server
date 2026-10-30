const test = require('node:test');
const assert = require('node:assert/strict');
const { createTripWriteGuard } = require('../services/mobileTripWriteGuard');
const owner = 'a'.repeat(24), foreign = 'b'.repeat(24), tripId = 'c'.repeat(24), recId = 'd'.repeat(24);
function fixture() {
  let trip = { _id: tripId, user: owner, photos: [] }, receipt = null, updateFailure = null;
  const pending = [], removed = [], writes = [], children = [];
  const match = (row, query) => row && Object.entries(query).every(([key, value]) => key === '$or' ? value.some(condition => match(row, condition)) : value?.$in ? value.$in.map(String).includes(String(row[key])) : key === 'photos' ? row.photos?.includes(value) : String(row[key]) === String(value));
  const Trip = {
    findOne: async query => match(trip, query) ? trip : null,
    exists: async query => !!match(trip, query),
    updateOne: async (query, update) => { writes.push({ query, update }); if (updateFailure) throw updateFailure; if (!match(trip, query)) return { matchedCount: 0 }; trip.photos.push(...update.$push.photos.$each); return { matchedCount: 1 }; },
    deleteOne: async query => { if (match(trip, query)) trip = null; },
  };
  const Recommendation = {
    exists: async query => children.some(row => match(row, query)),
    find: async query => children.filter(row => match(row, query)),
    deleteOne: async query => { const i = children.findIndex(row => match(row, query)); if (i >= 0) children.splice(i, 1); },
    deleteMany: async query => { for (let i = children.length - 1; i >= 0; --i) if (match(children[i], query)) children.splice(i, 1); },
  };
  const deps = { Trip, Recommendation, Deletion: { exists: async query => !!match(receipt, query), findOne: async query => match(receipt, query) ? receipt : null }, isValidId: id => /^[a-f0-9]{24}$/.test(String(id)), deleteFile: async id => removed.push(id), addPendingFiles: async (id, user, ids) => { if (!match(receipt, { _id: id, user })) throw Error('No receipt'); pending.push(...ids); } };
  return { guards: createTripWriteGuard(deps), deps, Trip, children, pending, removed, writes, setTrip: value => { trip = value; }, tombstone: value => { receipt = value || { _id: tripId, user: owner, uploadId: 'recording-1' }; trip = null; }, failUpdate: error => { updateFailure = error; } };
}
test('association guard requires existing owned parent and rejects malformed IDs', async () => {
  const f = fixture(); await f.guards.assertWritableTrip(tripId, owner);
  await assert.rejects(f.guards.assertWritableTrip(tripId, foreign), { statusCode: 404 });
  await assert.rejects(f.guards.assertWritableTrip('invalid', owner), { statusCode: 400 });
  f.tombstone(); await assert.rejects(f.guards.assertWritableTrip(tripId, owner), { statusCode: 404 });
});
test('append uses owner-qualified conditional write and never upserts', async () => {
  const f = fixture(); await f.guards.appendUploadedPhotos({ model: f.Trip, targetId: tripId, tripId, userId: owner, ids: ['photo'] });
  assert.deepEqual(f.writes, [{ query: { _id: tripId, user: owner }, update: { $push: { photos: { $each: ['photo'] } } } }]);
  assert.deepEqual(f.removed, []);
});
test('late uploads queue exact new IDs for owner retry instead of recreating target', async () => {
  const f = fixture(); f.tombstone();
  await assert.rejects(f.guards.appendUploadedPhotos({ model: f.Trip, targetId: tripId, tripId, userId: owner, ids: ['late'] }), { statusCode: 404 });
  assert.deepEqual(f.pending, ['late']); assert.deepEqual(f.writes, []); assert.deepEqual(f.removed, []);
});
test('changed recommendation association prevents stale photo append', async () => {
  const f = fixture(); let filter;
  await assert.rejects(f.guards.appendUploadedPhotos({ model: { updateOne: async query => { filter = query; return { matchedCount: 0 }; } }, targetId: recId, tripId, userId: owner, ids: ['late'], recommendation: true }), { statusCode: 410 });
  assert.deepEqual(filter, { _id: recId, user: owner, associatedTrip: tripId }); assert.deepEqual(f.removed, ['late']);
});
test('ambiguous append preserves IDs that are actually referenced', async () => {
  const f = fixture(); f.setTrip({ _id: tripId, user: owner, photos: ['attached'] }); f.failUpdate(Error('response lost'));
  await assert.rejects(f.guards.appendUploadedPhotos({ model: f.Trip, targetId: tripId, tripId, userId: owner, ids: ['attached'] }), /response lost/);
  assert.deepEqual(f.removed, []);
});
test('cleanup recording failure is an error, not claimed successful upload', async () => {
  const f = fixture(); f.tombstone(); f.deps.addPendingFiles = async () => { throw Error('storage offline'); };
  const guards = createTripWriteGuard(f.deps);
  await assert.rejects(guards.appendUploadedPhotos({ model: f.Trip, targetId: tripId, tripId, userId: owner, ids: ['late'] }), { statusCode: 503 });
});
test('post-create check removes only exact owned late child and requeues after removal', async () => {
  const f = fixture(); const child = { _id: recId, user: owner, associatedTrip: tripId, photos: ['shared'] };
  f.children.push(child, { ...child, _id: 'e'.repeat(24), user: foreign }); f.tombstone();
  await assert.rejects(f.guards.checkAssociatedRecommendationAfterWrite(child, owner), { statusCode: 404 });
  assert.equal(f.children.length, 1); assert.equal(f.children[0].user, foreign); assert.deepEqual(f.pending, ['shared', 'shared']); assert.deepEqual(f.removed, []);
});
test('tombstone retry repairs an unfinished replacement before returning explicit 410', async () => {
  const f = fixture(); f.tombstone(); const replacementId = 'f'.repeat(24);
  f.setTrip({ _id: replacementId, user: owner, clientUploadId: 'recording-1', photos: ['trip-photo'] });
  f.children.push({ _id: recId, user: owner, associatedTrip: replacementId, photos: ['rec-photo'] });
  await assert.rejects(f.guards.assertRecordingNotDeleted(owner, 'recording-1'), error => error.code === 'TRIP_DELETED' && error.tripId === tripId && error.uploadId === 'recording-1');
  assert.equal(await f.Trip.findOne({ _id: replacementId }), null); assert.equal(f.children.length, 0); assert.deepEqual(f.pending, ['trip-photo', 'rec-photo', 'trip-photo', 'rec-photo']);
});

// Exercise real controller processing, while every model/storage operation is
// synthetic. In particular, one rejected upload must not abandon a later success.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { createRequire } = require('node:module');
function loadController(file, stubs) {
  const filename = path.resolve(__dirname, '..', file), requireReal = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: id => Object.hasOwn(stubs, id) ? stubs[id] : requireReal(id), console: { log() {}, warn() {}, error() {} }, Buffer, process }, { filename });
  return module.exports;
}
for (const [file, method, params] of [['tripController.js', 'uploadTripPhotos', { tripId }], ['recommendationJsonController.js', 'uploadRecommendationPhotos', { recommendationId: recId }]]) {
  test(`${method} waits for all stream outcomes and cleans successful IDs on partial failure`, async () => {
    let release, nextError; const cleaned = [], appended = [];
    const lateUpload = new Promise(resolve => { release = resolve; });
    const sharp = () => ({ rotate() { return this; }, resize() { return this; }, webp() { return this; }, async toBuffer() { return { data: Buffer.from('synthetic'), info: { size: 9, width: 1, height: 1 } }; } });
    sharp.fit = { inside: 'inside' };
    const model = { findById: () => ({ select: async () => ({ _id: recId, user: owner, associatedTrip: tripId, photos: [] }) }) };
    const controller = loadController(`controllers/${file}`, {
      '../models/Trip': model, '../models/Recommendation': model, '../models/User': {}, sharp,
      '../services/storageService': { uploadFile: async (data, name) => { if (name.includes('fail')) throw Error('synthetic stream failure'); return lateUpload; } },
      '../services/mobileTripWriteGuard': { assertWritableTrip: async () => {}, cleanupUnattachedPhotos: async (id, user, ids) => cleaned.push(...ids), appendUploadedPhotos: async value => appended.push(value) },
    });
    const running = controller[method]({ params, user: { _id: owner }, files: [{ originalname: 'fail.jpg', buffer: Buffer.from('a') }, { originalname: 'late.jpg', buffer: Buffer.from('b') }] }, { status() { return this; }, json() { throw Error('Unexpected successful response'); } }, error => { nextError = error; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(nextError, undefined); assert.deepEqual(cleaned, []);
    release('late-file-id'); await running;
    assert.match(nextError.message, /synthetic stream failure/); assert.deepEqual(cleaned, ['late-file-id']); assert.deepEqual(appended, []);
  });
}

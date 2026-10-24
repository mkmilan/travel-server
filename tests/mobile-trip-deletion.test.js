const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTripDeletionService } = require('../services/mobileTripDeletion');
const owner = 'a'.repeat(24), other = 'b'.repeat(24), id = 'c'.repeat(24);
const photo = 'd'.repeat(24), childPhoto = 'e'.repeat(24);
const query = value => ({ session() { return this; }, lean: async () => structuredClone(value) });
function fixture(options = {}) {
  let trip = { _id: id, user: owner, format: 'json', photos: [photo], clientUploadId: 'upload-1', uploadComplete: true, ...options.trip };
  let children = [{ _id: '1'.repeat(24), user: owner, associatedTrip: id, photos: [childPhoto] },
    { _id: '2'.repeat(24), user: other, associatedTrip: id, photos: [options.foreignPhoto || 'f'.repeat(24)] }];
  let receipt = options.receipt || null;
  const removed = [], calls = [];
  let failed = options.fail;
  const session = { async withTransaction(fn) {
    const snapshot = structuredClone({ trip, children, receipt });
    try { await fn(); } catch (error) { ({ trip, children, receipt } = snapshot); throw error; }
  }, async endSession() { calls.push('end'); } };
  const Receipt = {
    findById: () => query(receipt), findOne: () => query(receipt),
    create: async ([value]) => { receipt = structuredClone(value); return [receipt]; },
    async updateOne(filter, update) {
      if (!receipt || (filter.user && String(filter.user) !== receipt.user)) return { matchedCount: 0 };
      if (filter.pendingFiles && receipt.pendingFiles.length) return { matchedCount: 0 };
      if (update.$pull) receipt.pendingFiles = receipt.pendingFiles.filter(x => x !== update.$pull.pendingFiles);
      if (update.$set) Object.assign(receipt, update.$set);
      if (update.$addToSet) receipt.pendingFiles = [...new Set([...receipt.pendingFiles, ...update.$addToSet.pendingFiles.$each])];
      return { matchedCount: 1 };
    },
  };
  const service = createTripDeletionService({
    Trip: { findOne: f => query(trip && trip.user === f.user ? trip : null),
      exists: async () => !!options.sharedTrip,
      deleteOne: async () => { if (options.metadataFailure) throw new Error('metadata failure'); trip = null; calls.push('trip-delete'); return { deletedCount: 1 }; } },
    Recommendation: { find: f => query(children.filter(c => c.user === f.user && c.associatedTrip === f.associatedTrip)),
      exists: async f => children.some(c => c.photos.includes(f.photos)),
      deleteMany: async f => { assert.equal(f.user, owner); assert.equal(f.associatedTrip, id); children = children.filter(c => !f._id.$in.includes(c._id)); } },
    User: { exists: async f => { assert.ok(Object.hasOwn(f, 'profilePictureUrl')); return !!options.avatar; } },
    Receipt, connection: { startSession: async () => session },
    storage: { deleteFile: async file => { assert.equal(trip, null); if (failed === file) throw new Error('storage unavailable'); removed.push(file); } },
    findFile: async file => options.missing ? null : { metadata: options.unknownOwner ? {} : { userId: options.foreignOwner && file === photo ? other : owner } },
    isValidId: value => /^[a-f0-9]{24}$/.test(value),
  });
  return { service, removed, calls, get trip() { return trip; }, get receipt() { return receipt; }, get children() { return children; }, recover() { failed = null; } };
}
test('owner deletion captures exact IDs, removes own children only, keeps content-free replay identity', async () => {
 const f = fixture(); const result = await f.service.deleteTrip(id, owner);
 assert.deepEqual(result, { tripId: id, deleted: true, cleanupPending: false });
 assert.equal(f.trip, null); assert.equal(f.children.length, 1); assert.equal(f.children[0].user, other);
 assert.deepEqual(f.removed, [photo, childPhoto]);
 assert.deepEqual(f.receipt, { _id: id, user: owner, uploadId: 'upload-1', pendingFiles: [], phase: 'complete' });
});
test('foreign account cannot delete or retry owner receipt', async () => {
 const f = fixture(); await assert.rejects(f.service.deleteTrip(id, other), { statusCode: 404 }); assert.ok(f.trip);
 await f.service.deleteTrip(id, owner); await assert.rejects(f.service.deleteTrip(id, other), { statusCode: 404 });
});
test('storage failure is durable pending, retry resumes missing IDs only', async () => {
 const f = fixture({ fail: photo }); assert.equal((await f.service.deleteTrip(id, owner)).cleanupPending, true);
 assert.deepEqual(f.receipt.pendingFiles, [photo]); assert.deepEqual(f.removed, [childPhoto]);
 f.recover(); assert.equal((await f.service.deleteTrip(id, owner)).cleanupPending, false);
 assert.deepEqual(f.removed, [childPhoto, photo]);
});
test('known late-upload files reopen completed receipt and retry', async () => {
 const f = fixture(); await f.service.deleteTrip(id, owner);
 await f.service.addPendingFiles(id, owner, [childPhoto, childPhoto]);
 assert.deepEqual(f.receipt.pendingFiles, [childPhoto]); assert.equal(f.receipt.phase, 'records-deleted');
 await f.service.deleteTrip(id, owner); assert.equal(f.receipt.phase, 'complete');
 await assert.rejects(f.service.addPendingFiles(id, other, [photo]), { statusCode: 503 });
});
test('actual surviving foreign recommendation reference is preserved', async () => {
 const f = fixture({ foreignPhoto: photo }); await f.service.deleteTrip(id, owner);
 assert.deepEqual(f.removed, [childPhoto]); assert.equal(f.children[0].photos[0], photo);
});
test('shared trip and avatar references are preserved', async () => {
 for (const key of ['sharedTrip', 'avatar']) { const f = fixture({ [key]: true }); await f.service.deleteTrip(id, owner); assert.deepEqual(f.removed, []); }
});
test('foreign, absent and unverifiable file ownership never authorizes delete', async () => {
 for (const option of [{ foreignOwner: true }, { missing: true }, { unknownOwner: true }]) {
  const f = fixture(option); await f.service.deleteTrip(id, owner); assert.ok(!f.removed.includes(photo));
 }
});
test('metadata failure rolls back receipt and records before any files are deleted', async () => {
 const f = fixture({ metadataFailure: true }); await assert.rejects(f.service.deleteTrip(id, owner), /metadata failure/);
 assert.ok(f.trip); assert.equal(f.receipt, null); assert.equal(f.children.length, 2); assert.deepEqual(f.removed, []);
});
test('GPX and incomplete reliable uploads refused, invalid ids rejected', async () => {
 for (const trip of [{ format: 'gpx' }, { uploadComplete: false }]) {
  const f = fixture({ trip }); await assert.rejects(f.service.deleteTrip(id, owner), { statusCode: 409 }); assert.ok(f.trip); assert.equal(f.receipt, null);
 }
 await assert.rejects(fixture().service.deleteTrip('bad', owner), { statusCode: 400 });
});

test('new route is separately gated and legacy DELETE/storage implementation untouched', () => {
 const fs = require('node:fs');
 const routes = fs.readFileSync('routes/mobileRoutes.js', 'utf8');
 assert.match(routes, /MOBILE_TRIP_DELETION_ENABLED !== 'true'/);
 assert.match(routes, /router\.delete\('\/trips\/:tripId\/permanent', protect/);
 assert.match(routes, /router\.get\('\/trip-deletions', protect/);
 assert.match(routes, /user: req\.user\._id, 'pendingFiles\.0': \{ \$exists: true \}/);
 const server = fs.readFileSync('server.js', 'utf8');
 assert.ok(server.indexOf('app.use(csrfProtection)') < server.indexOf('app.use("/api/mobile"'));
 assert.match(fs.readFileSync('routes/tripRoutes.js', 'utf8'), /router\.delete\("\/:tripId", protect, deleteTrip\)/);
 const storage = fs.readFileSync('services/storageService.js', 'utf8');
 assert.match(storage, /gfs\.openUploadStream\(filename/);
 assert.doesNotMatch(storage, /withTransaction|startSession|fileHash/);
});

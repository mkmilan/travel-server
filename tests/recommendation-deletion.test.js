const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecommendationDeletionService } = require('../services/recommendationDeletion');
const { createRecordingUploadService } = require('../services/recordingUpload');
const owner = 'a'.repeat(24), other = 'b'.repeat(24), tripId = 'c'.repeat(24), recId = 'd'.repeat(24), photoId = 'e'.repeat(24);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const matches = (row, filter) => row && Object.entries(filter).every(([key, value]) => {
  if (key === '$or') return value.some(part => matches(row, part));
  if (value?.$in) return value.$in.map(String).includes(String(row[key]));
  if (value?.$size !== undefined) return row[key]?.length === value.$size;
  if (value?.$ne !== undefined) return row[key] !== value.$ne;
  return Array.isArray(row[key]) ? row[key].includes(value) : String(row[key]) === String(value);
});
function fixture(association = tripId) {
  const state = { trips: [{ _id: tripId, user: owner, photos: [], uploadComplete: false }], recs: [{ _id: recId, user: owner, associatedTrip: association, photos: [photoId], clientUploadId: 'child-1' }], receipts: [], tripReceipts: [], users: [] };
  const files = new Map([[photoId, { metadata: { userId: owner } }]]), removed = [], writes = [];
  let failFile = false, failDelete = false, unsupported = false;
  const query = read => ({ session() { return this; }, lean() { return this; }, then(ok, bad) { return Promise.resolve().then(() => clone(read())).then(ok, bad); } });
  const model = key => ({
    findById: id => query(() => state[key].find(row => String(row._id) === String(id))),
    findOne: filter => query(() => state[key].find(row => matches(row, filter))),
    find: filter => query(() => state[key].filter(row => matches(row, filter))),
    exists: async filter => state[key].some(row => matches(row, filter)),
    create: async (docs, options) => { writes.push({ key, op: 'create', options }); state[key].push(...clone(docs)); return clone(docs); },
    updateOne: async (filter, update, options) => {
      writes.push({ key, op: 'update', filter, update, options }); const row = state[key].find(row => matches(row, filter));
      if (!row) return { matchedCount: 0 };
      Object.assign(row, clone(update.$set));
      for (const [key, value] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + value;
      for (const [key, value] of Object.entries(update.$pull || {})) row[key] = row[key].filter(item => item !== value);
      for (const [key, value] of Object.entries(update.$addToSet || {})) row[key] = [...new Set([...(row[key] || []), ...(value.$each || [value])])];
      return { matchedCount: 1 };
    },
    async findOneAndUpdate(filter, update) { await this.updateOne(filter, update); return clone(state[key].find(row => matches(row, filter))); },
    deleteOne: async (filter, options) => {
      writes.push({ key, op: 'delete', filter, options }); const index = state[key].findIndex(row => matches(row, filter));
      if (index === -1) return { deletedCount: 0 }; state[key].splice(index, 1);
      if (failDelete) throw Error('injected after delete');
      return { deletedCount: 1 };
    },
  });
  const Trip = model('trips'), Recommendation = model('recs'), Receipt = model('receipts'), TripDeletion = model('tripReceipts'), User = model('users');
  const session = { async withTransaction(fn) { const before = clone(state); try { if (unsupported) throw Object.assign(Error('standalone'), { code: 20 }); await fn(); } catch (error) { Object.assign(state, before); throw error; } }, async endSession() {} };
  const deps = { Trip, Recommendation, Receipt, TripDeletion, User, connection: { startSession: async () => session },
    storage: { deleteFile: async id => { if (failFile) throw Error('storage offline'); removed.push(id); files.delete(id); } },
    findFile: async id => files.get(id), hasChunks: async id => files.has(id), isValidId: () => true };
  const service = createRecommendationDeletionService(deps);
  return { state, files, removed, writes, deps, service, failFile: value => { failFile = value; }, failDelete: () => { failDelete = true; }, unsupported: () => { unsupported = true; } };
}
for (const association of [null, tripId, 'f'.repeat(24)]) test(`transactional deletion captures photos and accepts owned ${association || 'standalone'} place`, async () => {
  const f = fixture(association); const result = await f.service.deleteRecommendation(recId, owner);
  assert.deepEqual(result, { deletedPhotosCount: 1 }); assert.equal(f.state.recs.length, 0); assert.equal(f.files.size, 0);
  assert.equal(f.state.receipts[0].phase, 'complete');
  const deletion = f.writes.find(write => write.op === 'delete'); assert.deepEqual(deletion.filter, { _id: recId, user: owner }); assert(deletion.options.session);
  assert.equal(f.state.receipts[0].clientUploadId, 'child-1');
});
test('owned place linked to a foreign parent remains deletable without mutating that parent', async () => {
  const f = fixture(); f.state.trips[0].user = other;
  await f.service.deleteRecommendation(recId, owner); assert.equal(f.state.trips[0].uploadWriteVersion, undefined);
});
test('another account cannot delete a place or retry its receipt', async () => {
  const f = fixture(); await assert.rejects(f.service.deleteRecommendation(recId, other), { statusCode: 403 });
  assert.equal(f.state.recs.length, 1); await f.service.deleteRecommendation(recId, owner);
  await assert.rejects(f.service.deleteRecommendation(recId, other), { statusCode: 403 });
});
test('storage outage is a retryable 503 with exact IDs surviving service restart', async () => {
  const f = fixture(); f.failFile(true);
  await assert.rejects(f.service.deleteRecommendation(recId, owner), { statusCode: 503 });
  assert.equal(f.state.recs.length, 0); assert.deepEqual(f.state.receipts[0].pendingFiles, [photoId]);
  f.failFile(false); await createRecommendationDeletionService(f.deps).deleteRecommendation(recId, owner);
  assert.equal(f.files.size, 0); assert.deepEqual(f.state.receipts[0].pendingFiles, []);
});
for (const kind of ['trip', 'recommendation', 'profile', 'foreign']) test(`cleanup preserves ${kind} file authority/reference`, async () => {
  const f = fixture();
  if (kind === 'trip') f.state.trips[0].photos = [photoId];
  if (kind === 'recommendation') f.state.recs.push({ _id: 'survivor', user: other, photos: [photoId] });
  if (kind === 'profile') f.state.users.push({ _id: owner, profilePictureUrl: photoId });
  if (kind === 'foreign') f.files.get(photoId).metadata.userId = other;
  await f.service.deleteRecommendation(recId, owner); assert(f.files.has(photoId)); assert.deepEqual(f.removed, []);
});
test('metadata transaction failure rolls back receipt and exact row before touching files', async () => {
  const f = fixture(); f.failDelete();
  await assert.rejects(f.service.deleteRecommendation(recId, owner), /injected after delete/);
  assert.equal(f.state.recs.length, 1); assert.equal(f.state.receipts.length, 0); assert.equal(f.state.trips[0].uploadWriteVersion, undefined); assert(f.files.has(photoId));
});
test('late upload IDs persist in both place receipt and committed parent cleanup on storage failure', async () => {
  const f = fixture(); await f.service.deleteRecommendation(recId, owner);
  f.state.tripReceipts.push({ _id: tripId, user: owner, pendingFiles: [], phase: 'complete' });
  f.files.set(photoId, { metadata: { userId: owner } }); f.failFile(true);
  await assert.rejects(f.service.addPendingFiles(recId, owner, [photoId]), { statusCode: 503 });
  assert.deepEqual(f.state.receipts[0].pendingFiles, [photoId]); assert.deepEqual(f.state.tripReceipts[0].pendingFiles, [photoId]);
});
test('standalone topology fails closed without metadata or storage mutation', async () => {
  const f = fixture(); f.unsupported(); await assert.rejects(f.service.deleteRecommendation(recId, owner), { statusCode: 503 });
  assert.equal(f.state.recs.length, 1); assert.equal(f.state.receipts.length, 0); assert.deepEqual(f.removed, []);
});
test('partial recording retry acknowledges deleted child original identity instead of inserting it', async () => {
  const f = fixture(); await f.service.deleteRecommendation(recId, owner);
  const uploads = createRecordingUploadService({ ...f.deps, Deletion: f.deps.Receipt });
  const result = await uploads.createChild({ user: owner, associatedTrip: tripId, clientUploadId: 'child-1', name: 'Frozen name' });
  assert.deepEqual(result.outcome, { id: recId, uploadId: 'child-1', name: 'Frozen name', status: 'created' });
  assert.equal(f.state.recs.length, 0);
  const different = await uploads.createChild({ _id: 'new', user: owner, associatedTrip: tripId, clientUploadId: 'child-2', name: 'Other child' });
  assert.equal(different.record._id, 'new'); assert.equal(f.state.recs.length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { removePhoto } = require('../services/photoRemoval');
const { createTripWriteGuard } = require('../services/mobileTripWriteGuard');
const Trip = require('../models/Trip'), Recommendation = require('../models/Recommendation');
const owner = 'a'.repeat(24), target = 'b'.repeat(24), old = 'c'.repeat(24), keep = 'd'.repeat(24), fresh = 'e'.repeat(24);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
for (const Model of [Trip, Recommendation]) {
  test(`${Model.modelName}: actual Mongoose pull preserves a concurrent successful append without __v`, async t => {
    const state = { _id: target, user: owner, photos: [old, keep] }, writes = [];
    t.mock.method(Model, 'exists', async () => true);
    t.mock.method(Model.collection, 'findOneAndUpdate', async (filter, update) => {
      assert.equal(String(filter.user), owner); assert.equal(filter.photos, old);
      writes.push(update); state.photos = state.photos.filter(id => id !== update.$pull.photos);
      return { ...state, photos: [...state.photos] };
    });
    t.mock.method(Model.collection, 'updateOne', async (filter, update) => {
      writes.push(update); state.photos.push(...update.$push.photos.$each);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    });
    const started = deferred(), release = deferred();
    const deleting = removePhoto({ model: Model, targetId: target, userId: owner, photoId: old, cleanup: async () => { started.resolve(); await release.promise; } });
    await started.promise;
    await Model.updateOne({ _id: target, user: owner }, { $push: { photos: { $each: [fresh] } } });
    release.resolve(); assert.equal(await deleting, 2); // count at the atomic removal
    assert.deepEqual(state.photos, [keep, fresh]);
    assert(writes.some(write => write.$pull?.photos === old));
    assert(!writes.some(write => write.$set?.photos));
  });
}
test('storage failure retains the original reference without writing metadata', async () => {
  const model = { exists: async () => true, findOneAndUpdate: async () => assert.fail('must not detach on cleanup failure') };
  await assert.rejects(removePhoto({ model, targetId: target, userId: owner, photoId: old, cleanup: async () => { throw Error('storage unavailable'); } }), /storage unavailable/);
});
test('missing or foreign photo never grants storage deletion authority', async () => {
  await assert.rejects(removePhoto({ model: { exists: async () => null }, targetId: target, userId: owner, photoId: old, cleanup: async () => assert.fail('must not delete storage') }), { statusCode: 404 });
});
for (const reference of ['trip', 'recommendation', 'profile']) test(`cleanup retains surviving ${reference} reference`, async () => {
  const guards = createTripWriteGuard({
    Trip: { exists: async () => reference === 'trip' }, Recommendation: { exists: async () => reference === 'recommendation' }, User: { exists: async () => reference === 'profile' },
    Deletion: { exists: async () => false }, deleteFile: async () => assert.fail('shared file must survive'),
  });
  await guards.cleanupUnattachedPhotos(null, owner, [old]);
});

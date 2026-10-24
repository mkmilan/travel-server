const { test } = require('node:test');
const assert = require('node:assert/strict');
const Recommendation = require('../models/Recommendation');
const Trip = require('../models/Trip');
const Deletion = require('../models/MobileTripDeletion');
const controller = require('../controllers/recommendationJsonController');
const owner = 'a'.repeat(24), other = 'b'.repeat(24), recId = 'c'.repeat(24);
const ownedTrip = 'd'.repeat(24), missingTrip = 'e'.repeat(24), foreignTrip = 'f'.repeat(24), deletedTrip = '1'.repeat(24);
function fixture(t, associatedTrip = null, recOwner = owner) {
  let saves = 0, creates = 0, checks = 0;
  const record = { _id: recId, user: recOwner, name: 'Before', associatedTrip, photos: [], async save() { saves++; return this; } };
  t.mock.method(Recommendation, 'findById', async () => record);
  t.mock.method(Recommendation, 'create', async data => { creates++; Object.assign(record, data); return record; });
  t.mock.method(Trip, 'findOne', async filter => {
    checks++; assert.equal(String(filter.user), owner);
    return [ownedTrip, deletedTrip].includes(String(filter._id)) ? { _id: filter._id, user: owner } : null;
  });
  t.mock.method(Deletion, 'exists', async filter => String(filter._id) === deletedTrip);
  return { record, get saves() { return saves; }, get creates() { return creates; }, get checks() { return checks; } };
}
async function run(handler, body) {
  const response = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ params: { recommendationId: recId }, user: { _id: owner }, body }, response, error => { throw error; });
  return response;
}
for (const oldTrip of [missingTrip, foreignTrip]) for (const target of [null, ownedTrip]) {
  test(`owner can repair legacy association ${oldTrip[0]} to ${target || 'standalone'}`, async t => {
    const f = fixture(t, oldTrip);
    const result = await run(controller.updateRecommendationJson, { associatedTrip: target, name: 'Repaired' });
    assert.equal(result.code, 200); assert.equal(f.saves, 1);
    assert.equal(f.record.associatedTrip, target); assert.equal(f.record.name, 'Repaired');
  });
}
for (const association of [null, ownedTrip]) {
  test(`ordinary recommendation edit preserves ${association || 'standalone'} association`, async t => {
    const f = fixture(t, association);
    assert.equal((await run(controller.updateRecommendationJson, { name: 'Edited' })).code, 200);
    assert.equal(f.record.associatedTrip, association); assert.equal(f.saves, 1);
  });
  test(`ordinary create accepts ${association || 'standalone'} association`, async t => {
    const f = fixture(t);
    const result = await run(controller.createSingleRecommendationJson, { name: 'Created', description: 'Synthetic only', latitude: 0, longitude: 0, primaryCategory: 'OTHER', associatedTrip: association });
    assert.equal(result.code, 201); assert.equal(f.creates, 1); assert.equal(f.record.associatedTrip, association);
  });
}
for (const [association, code] of [['invalid',400], [missingTrip,404], [foreignTrip,404], [deletedTrip,410]]) {
  for (const mode of ['create','update']) test(`${mode} rejects unavailable association with HTTP ${code}`, async t => {
    const f = fixture(t);
    const handler = mode === 'create' ? controller.createSingleRecommendationJson : controller.updateRecommendationJson;
    const result = await run(handler, { name: 'Denied', latitude: 0, longitude: 0, primaryCategory: 'OTHER', associatedTrip: association });
    assert.equal(result.code, code); assert.equal(f.saves, 0); assert.equal(f.creates, 0);
    assert(!result.body.message.includes('Server error'));
  });
}
test('omitting association cannot bypass a dangling association guard', async t => {
  const f = fixture(t, missingTrip);
  assert.equal((await run(controller.updateRecommendationJson, { name: 'Denied' })).code, 404);
  assert.equal(f.saves, 0);
});
test('explicit detach does not bypass recommendation ownership', async t => {
  const f = fixture(t, missingTrip, other);
  assert.equal((await run(controller.updateRecommendationJson, { associatedTrip: null })).code, 403);
  assert.equal(f.saves, 0); assert.equal(f.checks, 0);
});
test('create preserves guard failure status after its initial association check', async t => {
  const f = fixture(t); let checks = 0;
  t.mock.method(Trip, 'findOne', async () => ++checks === 1 ? { _id: ownedTrip, user: owner } : null);
  const result = await run(controller.createSingleRecommendationJson, { name: 'Raced', latitude: 0, longitude: 0, primaryCategory: 'OTHER', associatedTrip: ownedTrip });
  assert.equal(result.code, 404); assert.equal(f.creates, 0);
});

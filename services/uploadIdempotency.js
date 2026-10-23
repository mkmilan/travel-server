const crypto = require('node:crypto');

// Explicit setup only: these definitions are NOT registered as Mongoose indexes.
const uploadIndexes = {
  trip: { name: 'owner_recording_upload_unique', key: { user: 1, clientUploadId: 1 }, unique: true, partialFilterExpression: { clientUploadId: { $type: 'string' } } },
  recommendation: { name: 'trip_recording_child_unique', key: { user: 1, associatedTrip: 1, clientUploadId: 1 }, unique: true, partialFilterExpression: { clientUploadId: { $type: 'string' } } },
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const validKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
async function requireUploadIndexes(Trip, Recommendation) {
  for (const [model, definition] of [[Trip, uploadIndexes.trip], [Recommendation, uploadIndexes.recommendation]]) {
    let indexes;
    try { indexes = await model.collection.listIndexes().toArray(); } catch (_) { indexes = []; }
    if (!indexes.some(index => index.unique === true
      && JSON.stringify(index.key) === JSON.stringify(definition.key)
      && JSON.stringify(canonical(index.partialFilterExpression)) === JSON.stringify(canonical(definition.partialFilterExpression)))) {
      throw httpError(503, 'Reliable recording uploads are not enabled yet. Your recording remains on this phone; try again after the server update.');
    }
  }
}
module.exports = { uploadIndexes, fingerprint, validKey, httpError, requireUploadIndexes };

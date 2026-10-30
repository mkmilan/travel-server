const { httpError } = require('./uploadIdempotency');

// Keep the retryable reference until storage cleanup succeeds. The caller has
// checked owner/attachment and cleanup excludes only this target's own reference,
// preserving other trip/recommendation/profile references and storage ownership.
async function removePhoto({ model, targetId, userId, photoId, cleanup }) {
  const filter = { _id: targetId, user: userId, photos: photoId };
  if (!await model.exists(filter)) throw httpError(404, 'Photo not found in this record');
  await cleanup();
  // Never save a projected/stale photos array: atomically remove only this ID.
  const current = await model.findOneAndUpdate(filter, { $pull: { photos: photoId } },
    { new: true, projection: { photos: 1 } });
  if (!current) throw httpError(404, 'Photo not found in this record');
  return current.photos.length;
}
module.exports = { removePhoto };

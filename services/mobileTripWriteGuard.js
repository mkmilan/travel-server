// Focused guards for actual mobile write flows. These checks are not a global
// write fence: legacy clients and process death can still race a metadata delete.
const { httpError } = require('./uploadIdempotency');

function createTripWriteGuard({ Trip, Recommendation, Deletion, isValidId, deleteFile, addPendingFiles }) {
  async function assertWritableTrip(tripId, userId) {
    if (!tripId) return;
    if (!isValidId(tripId)) throw httpError(400, 'Invalid associated trip ID');
    const trip = await Trip.findOne({ _id: tripId, user: userId });
    if (!trip) throw httpError(404, 'Associated trip is not available to this account');
    if (await Deletion.exists({ _id: tripId })) throw httpError(410, 'This trip has been deleted');
    return trip;
  }
  async function assertRecordingNotDeleted(userId, uploadId, savedTrip) {
    const receipt = uploadId && await Deletion.findOne({ user: userId, uploadId });
    if (!receipt) return;
    // A request may have passed its first check before the original trip was
    // deleted, then inserted a replacement. Compensate that exact replacement
    // before reporting 410. This is bounded repair, not crash-proof atomicity.
    savedTrip = savedTrip || await Trip.findOne({ user: userId, clientUploadId: uploadId });
    if (savedTrip && String(savedTrip._id) !== String(receipt._id)) {
      const children = await Recommendation.find({ user: userId, associatedTrip: savedTrip._id });
      const current = await Trip.findOne({ _id: savedTrip._id, user: userId, clientUploadId: uploadId });
      const ids = [...(current?.photos || []), ...children.flatMap(rec => rec.photos || [])];
      await addPendingFiles(receipt._id, userId, ids);
      await Recommendation.deleteMany({ _id: { $in: children.map(rec => rec._id) }, user: userId, associatedTrip: savedTrip._id });
      await Trip.deleteOne({ _id: savedTrip._id, user: userId, clientUploadId: uploadId });
      // A concurrent cleanup may have retained these while the records existed.
      await addPendingFiles(receipt._id, userId, ids);
    }
    throw Object.assign(httpError(410, 'This recording was permanently deleted and cannot be uploaded again'), {
      code: 'TRIP_DELETED', tripId: String(receipt._id), uploadId,
    });
  }
  async function checkAssociatedRecommendationAfterWrite(record, userId) {
    if (!record.associatedTrip) return;
    try { await assertWritableTrip(record.associatedTrip, userId); }
    catch (error) {
      if (error.statusCode !== 404 && error.statusCode !== 410) throw error;
      // A newly inserted child does not conflict with deletion of its parent.
      // Repair only this exact owned association after a definite missing parent.
      const receipt = await Deletion.exists({ _id: record.associatedTrip, user: userId });
      if (receipt) await addPendingFiles(record.associatedTrip, userId, record.photos || []);
      await Recommendation.deleteOne({ _id: record._id, user: userId, associatedTrip: record.associatedTrip });
      if (receipt) await addPendingFiles(record.associatedTrip, userId, record.photos || []);
      throw error;
    }
  }
  async function cleanupUnattachedPhotos(tripId, userId, ids) {
    if (!ids.length) return;
    // Persist known late IDs before attempting any file deletion. The owner can
    // retry the same permanent-delete endpoint, including after a lost response.
    if (tripId && await Deletion.exists({ _id: tripId, user: userId })) {
      await addPendingFiles(tripId, userId, ids);
      return;
    }
    // No deletion manifest means this was a normal upload failure, not a trip
    // deletion. Preserve any successfully attached IDs after ambiguous writes.
    for (const id of ids) {
      if (await Trip.exists({ photos: id }) || await Recommendation.exists({ photos: id })) continue;
      await deleteFile(id, userId);
    }
  }
  async function appendUploadedPhotos({ model, targetId, userId, tripId, ids, recommendation = false }) {
    try {
      await assertWritableTrip(tripId, userId);
      const filter = { _id: targetId, user: userId };
      if (recommendation) filter.associatedTrip = tripId || null;
      // Never save a stale document or upsert a deleted upload target.
      const result = await model.updateOne(filter, { $push: { photos: { $each: ids } } });
      if (result.matchedCount !== 1) throw httpError(410, 'Photo upload target no longer exists or changed');
      await assertWritableTrip(tripId, userId);
    } catch (error) {
      try { await cleanupUnattachedPhotos(tripId, userId, ids); }
      catch (cleanupError) {
        throw httpError(503, 'Photo upload did not complete; file cleanup could not be confirmed. Retry trip deletion if this trip was deleted.');
      }
      throw error;
    }
  }
  return { assertWritableTrip, assertRecordingNotDeleted, checkAssociatedRecommendationAfterWrite, cleanupUnattachedPhotos, appendUploadedPhotos };
}

let defaults;
function guard() {
  if (!defaults) defaults = createTripWriteGuard({
    Trip: require('../models/Trip'), Recommendation: require('../models/Recommendation'),
    Deletion: require('../models/MobileTripDeletion'), isValidId: require('mongoose').isObjectIdOrHexString,
    deleteFile: require('./storageService').deleteFile,
    addPendingFiles: (...args) => require('./mobileTripDeletion').addPendingFiles(...args),
  });
  return defaults;
}
module.exports = { createTripWriteGuard };
for (const name of ['assertWritableTrip', 'assertRecordingNotDeleted', 'checkAssociatedRecommendationAfterWrite', 'cleanupUnattachedPhotos', 'appendUploadedPhotos']) {
  module.exports[name] = (...args) => guard()[name](...args);
}

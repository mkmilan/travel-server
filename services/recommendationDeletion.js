const { httpError } = require('./uploadIdempotency');
const { createManifestCleanup } = require('./fileCleanup');
const unique = ids => [...new Set(ids.filter(Boolean).map(String))];

function createRecommendationDeletionService({ Trip, Recommendation, User, Receipt, TripDeletion, connection, storage, findFile, hasChunks, isValidId }) {
  const cleanupManifest = createManifestCleanup({ Trip, Recommendation, User, storage, findFile, hasChunks, isValidId });
  async function cleanup(receipt) {
    const current = await cleanupManifest(receipt, Receipt);
    if (current.pendingFiles.length) throw httpError(503, 'Place deleted, but photo cleanup is pending. Retry deleting this same place to finish cleanup.');
    return { deletedPhotosCount: receipt.photoCount };
  }
  async function deleteRecommendation(id, userId) {
    let receipt = await Receipt.findById(id).lean();
    if (receipt) {
      if (String(receipt.user) !== String(userId)) throw httpError(403, 'User not authorized to delete this recommendation');
      return cleanup(receipt);
    }
    const session = await connection.startSession();
    try {
      await session.withTransaction(async () => {
        receipt = await Receipt.findById(id).session(session).lean();
        if (receipt) {
          if (String(receipt.user) !== String(userId)) throw httpError(403, 'User not authorized to delete this recommendation');
          return;
        }
        const record = await Recommendation.findById(id).session(session).lean();
        if (!record) return;
        if (String(record.user) !== String(userId)) throw httpError(403, 'User not authorized to delete this recommendation');
        // Serialize intentional deletion with partial recording retries. Never
        // mutate a foreign parent or require a dangling parent to exist.
        if (record.clientUploadId && record.associatedTrip) await Trip.updateOne(
          { _id: record.associatedTrip, user: userId }, { $inc: { uploadWriteVersion: 1 } }, { session });
        [receipt] = await Receipt.create([{
          _id: record._id, user: userId, associatedTrip: record.associatedTrip, clientUploadId: record.clientUploadId,
          pendingFiles: unique(record.photos || []), photoCount: (record.photos || []).length, phase: 'records-deleted',
        }], { session });
        // This write conflicts with concurrent appends. A retry captures their IDs;
        // after commit an append cannot match/upsert this deleted record.
        const removed = await Recommendation.deleteOne({ _id: id, user: userId }, { session });
        if (removed.deletedCount !== 1) throw httpError(409, 'Place changed; retry deletion');
      });
    } catch (error) {
      if (error.code === 20 || error.codeName === 'IllegalOperation') {
        throw httpError(503, 'Place deletion requires database transaction support. Nothing was deleted; retry after the server update.');
      }
      if (error.code !== 11000) throw error;
      // A simultaneous same-ID delete may have committed the receipt first.
      receipt = await Receipt.findOne({ _id: id, user: userId }).lean();
      if (!receipt) throw error;
    } finally { await session.endSession(); }
    return receipt ? cleanup(receipt) : null;
  }
  async function addPendingFiles(id, userId, ids) {
    const receipt = await Receipt.findOneAndUpdate({ _id: id, user: userId },
      { $addToSet: { pendingFiles: { $each: unique(ids) } }, $set: { phase: 'records-deleted' } }, { new: true });
    if (!receipt) return false;
    // Whole-trip deletion writes this same receipt inside its transaction. If it
    // committed first, forward these late IDs into its owner-visible retry queue.
    if (receipt.associatedTrip) await TripDeletion.updateOne({ _id: receipt.associatedTrip, user: userId },
      { $addToSet: { pendingFiles: { $each: unique(ids) } }, $set: { phase: 'records-deleted' } });
    await cleanup(receipt);
    return true;
  }
  return { deleteRecommendation, addPendingFiles };
}
let service;
function defaults() {
  const mongoose = require('mongoose');
  return service ||= createRecommendationDeletionService({
    Trip: require('../models/Trip'), Recommendation: require('../models/Recommendation'), User: require('../models/User'),
    Receipt: require('../models/RecommendationDeletion'), TripDeletion: require('../models/MobileTripDeletion'), connection: mongoose.connection,
    storage: require('./storageService'), isValidId: mongoose.isObjectIdOrHexString,
    findFile: id => mongoose.connection.db.collection('gpxUploads.files').findOne({ _id: new mongoose.Types.ObjectId(id) }),
    hasChunks: async id => !!await mongoose.connection.db.collection('gpxUploads.chunks').findOne({ files_id: new mongoose.Types.ObjectId(id) }, { projection: { _id: 1 } }),
  });
}
module.exports = { createRecommendationDeletionService };
for (const name of ['deleteRecommendation', 'addPendingFiles']) module.exports[name] = (...args) => defaults()[name](...args);

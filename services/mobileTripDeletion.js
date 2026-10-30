const error = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const same = (a, b) => String(a) === String(b);
const unique = values => [...new Set(values.filter(Boolean).map(String))];

// Dependencies are injectable so failure/retry tests never need a database.
function createTripDeletionService({ Trip, Recommendation, User, Receipt, RecommendationDeletion, connection, storage, findFile, hasChunks, isValidId }) {
  const cleanupManifest = require('./fileCleanup').createManifestCleanup({ Trip, Recommendation, User, storage, findFile, hasChunks, isValidId });
  async function cleanup(receipt) {
    if (RecommendationDeletion) {
      // Repair an interrupted/ambiguous late-ID forward on every owner retry,
      // not only on the initial metadata transaction.
      const places = await RecommendationDeletion.find({ associatedTrip: receipt._id, user: receipt.user }).lean();
      const pending = unique(places.flatMap(row => row.pendingFiles || []));
      if (pending.length) {
        await Receipt.updateOne({ _id: receipt._id, user: receipt.user },
          { $addToSet: { pendingFiles: { $each: pending } }, $set: { phase: 'records-deleted' } });
        receipt = await Receipt.findOne({ _id: receipt._id, user: receipt.user }).lean();
      }
    }
    const current = await cleanupManifest(receipt, Receipt);
    return { tripId: String(receipt._id), deleted: true, cleanupPending: current.pendingFiles.length > 0 };
  }

  async function deleteTrip(tripId, userId) {
    if (!isValidId(tripId)) throw error(400, 'Invalid trip ID');
    let receipt = await Receipt.findById(tripId).lean();
    if (receipt) {
      if (!same(receipt.user, userId)) throw error(404, 'Trip not found');
      return cleanup(receipt);
    }
    // Only record metadata participates in this narrow transaction. GridFS keeps
    // its existing streaming/delete implementation and is retried after commit.
    const session = await connection.startSession();
    try {
      await session.withTransaction(async () => {
        receipt = await Receipt.findById(tripId).session(session).lean();
        if (receipt) {
          if (!same(receipt.user, userId)) throw error(404, 'Trip not found');
          return;
        }
        const trip = await Trip.findOne({ _id: tripId, user: userId }).session(session).lean();
        if (!trip) throw error(404, 'Trip not found');
        if (trip.format !== 'json') throw error(409, 'Permanent mobile deletion currently supports JSON trips only.');
        if (trip.clientUploadId && trip.uploadComplete !== true) throw error(409, 'Finish the recording upload before deleting this trip.');
        const children = await Recommendation.find({ associatedTrip: tripId, user: userId }).session(session).lean();
        const priorDeletions = RecommendationDeletion
          ? await RecommendationDeletion.find({ associatedTrip: tripId, user: userId }).session(session).lean() : [];
        const pendingFiles = unique([...(trip.photos || []), ...children.flatMap(rec => rec.photos || []), ...priorDeletions.flatMap(row => row.pendingFiles || [])]);
        // A late-file writer touches these same receipts before checking the trip
        // receipt, so its IDs either enter this snapshot or are forwarded afterward.
        if (priorDeletions.length) await RecommendationDeletion.updateMany(
          { _id: { $in: priorDeletions.map(row => row._id) }, user: userId, associatedTrip: tripId },
          { $inc: { cleanupVersion: 1 } }, { session });
        [receipt] = await Receipt.create([{
          _id: trip._id, user: userId, ...(trip.clientUploadId ? { uploadId: trip.clientUploadId } : {}),
          pendingFiles, phase: 'records-deleted',
        }], { session });
        // Exact owned associated children, not caller IDs or every user's children.
        await Recommendation.deleteMany({ _id: { $in: children.map(rec => rec._id) }, associatedTrip: tripId, user: userId }, { session });
        const removed = await Trip.deleteOne({ _id: tripId, user: userId }, { session });
        if (removed.deletedCount !== 1) throw error(409, 'Trip changed; retry deletion.');
      });
    } finally { await session.endSession(); }
    return cleanup(receipt);
  }
  async function addPendingFiles(tripId, userId, ids) {
    const files = unique(ids);
    if (!files.length) return;
    const result = await Receipt.updateOne({ _id: tripId, user: userId }, {
      $addToSet: { pendingFiles: { $each: files } }, $set: { phase: 'records-deleted' },
    });
    if (!result.matchedCount) throw error(503, 'Cleanup could not be recorded; retry the upload.');
  }
  return { deleteTrip, addPendingFiles };
}

let service;
function defaultService() {
  if (!service) {
    const mongoose = require('mongoose');
    service = createTripDeletionService({
      Trip: require('../models/Trip'), Recommendation: require('../models/Recommendation'), User: require('../models/User'),
      Receipt: require('../models/MobileTripDeletion'), RecommendationDeletion: require('../models/RecommendationDeletion'), connection: mongoose.connection,
      storage: require('./storageService'), isValidId: mongoose.isObjectIdOrHexString,
      findFile: id => mongoose.connection.db.collection('gpxUploads.files').findOne({ _id: new mongoose.Types.ObjectId(id) }),
      hasChunks: async id => !!await mongoose.connection.db.collection('gpxUploads.chunks').findOne({ files_id: new mongoose.Types.ObjectId(id) }, { projection: { _id: 1 } }),
    });
  }
  return service;
}
module.exports = { createTripDeletionService, deleteTrip: (...args) => defaultService().deleteTrip(...args), addPendingFiles: (...args) => defaultService().addPendingFiles(...args) };

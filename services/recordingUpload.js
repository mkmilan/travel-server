const { httpError } = require('./uploadIdempotency');

// A real parent write serializes child inserts with durable completion and the
// permanent-delete transaction across processes. A read-only recheck is not a fence.
function createRecordingUploadService({ Trip, Recommendation, Deletion, connection }) {
  async function assertSupported() {
    const hello = await connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') {
      throw httpError(503, 'Reliable recording uploads require database transaction support. Keep your recording and retry after the server update.');
    }
  }
  async function createChild(data) {
    const session = await connection.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        result = undefined; // transaction callbacks may be retried by the driver
        const parent = await Trip.findOne({ _id: data.associatedTrip, user: data.user }).session(session);
        if (!parent) throw httpError(404, 'Associated trip is not available to this account');
        if (parent.uploadComplete) {
          const outcome = parent.uploadReceipt?.find(item => item.uploadId === data.clientUploadId);
          if (!outcome) throw httpError(409, 'The completed recording receipt does not contain this place');
          result = { outcome };
          return;
        }
        const fenced = await Trip.updateOne({ _id: parent._id, user: data.user, uploadComplete: { $ne: true } },
          { $inc: { uploadWriteVersion: 1 } }, { session });
        if (fenced.matchedCount !== 1) throw httpError(409, 'Recording changed; retry the same saved upload');
        const identity = { user: data.user, associatedTrip: data.associatedTrip, clientUploadId: data.clientUploadId };
        const deleted = Deletion && await Deletion.findOne(identity).session(session);
        if (deleted) {
          // Creation happened historically; replay that identity without undoing
          // the owner's subsequent deletion, including during a partial upload.
          result = { outcome: { id: deleted._id, uploadId: data.clientUploadId, name: data.name, status: 'created' } };
          return;
        }
        let record = await Recommendation.findOne(identity).session(session);
        if (!record) [record] = await Recommendation.create([data], { session });
        result = { record };
      });
      return result;
    } finally { await session.endSession(); }
  }
  async function finish(tripId, userId, outcomes, expectedCount) {
    if (outcomes.length === expectedCount && outcomes.every(item => item.status === 'created')) {
      // A completed receipt is immutable. This write conflicts with every child
      // creation's parent fence, including a creator holding a stale snapshot.
      await Trip.updateOne({ _id: tripId, user: userId, uploadComplete: { $ne: true } },
        { $set: { uploadComplete: true, uploadReceipt: outcomes } });
    }
    const current = await Trip.findOne({ _id: tripId, user: userId });
    if (!current) throw httpError(404, 'Recording is no longer available');
    return { uploadComplete: current.uploadComplete === true,
      outcomes: current.uploadComplete ? current.uploadReceipt || [] : outcomes };
  }
  return { assertSupported, createChild, finish };
}
let service;
function defaults() {
  return service ||= createRecordingUploadService({ Trip: require('../models/Trip'), Recommendation: require('../models/Recommendation'), Deletion: require('../models/RecommendationDeletion'), connection: require('mongoose').connection });
}
module.exports = { createRecordingUploadService };
for (const name of ['assertSupported', 'createChild', 'finish']) module.exports[name] = (...args) => defaults()[name](...args);

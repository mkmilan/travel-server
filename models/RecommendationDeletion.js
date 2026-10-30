const mongoose = require('mongoose');

// Exact-ID cleanup receipt, retained for owner retry. No place content or bytes.
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId },
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
  associatedTrip: mongoose.Schema.Types.ObjectId,
  clientUploadId: String,
  pendingFiles: { type: [String], default: [] },
  photoCount: { type: Number, required: true },
  phase: { type: String, enum: ['records-deleted', 'complete'], required: true },
  cleanupVersion: { type: Number },
}, { timestamps: true });
module.exports = mongoose.model('RecommendationDeletion', schema);

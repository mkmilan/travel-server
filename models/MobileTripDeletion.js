const mongoose = require('mongoose');

// Minimal durable deletion receipt. No title, track, comments, image bytes or
// recommendation content. _id is the deleted trip ID (also the unique key).
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId },
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
  uploadId: String,
  pendingFiles: { type: [String], default: [] },
  phase: { type: String, enum: ['records-deleted', 'complete'], required: true },
}, { timestamps: true });
module.exports = mongoose.model('MobileTripDeletion', schema);

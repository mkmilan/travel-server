const mongoose = require('mongoose');
// The deterministic _id is the unique owner + target + client-key identity.
// Retain completed/deleted receipts: expiring them could resurrect old retries.
const schema = new mongoose.Schema({
  _id: String,
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
  target: { type: mongoose.Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ['trip', 'recommendation'], required: true },
  fingerprint: { type: String, required: true },
  state: { type: String, enum: ['pending', 'complete', 'deleted'], default: 'pending' },
  photoId: String,
}, { timestamps: true });
module.exports = mongoose.model('PhotoUploadReceipt', schema);

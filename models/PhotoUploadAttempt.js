const mongoose = require('mongoose');
// Separate bounded-size records, not an ever-growing receipt array. A crash may
// leave one of these exact owned file IDs for retry recovery/manual cleanup.
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId },
  receipt: { type: String, required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true });
module.exports = mongoose.model('PhotoUploadAttempt', schema);

const mongoose = require("mongoose");

const followSchema = new mongoose.Schema(
	{
		follower: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		followee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		createdAt: { type: Date, default: Date.now },
	},
	{ versionKey: false }
);

// Prevent duplicates: one user can follow another only once
followSchema.index({ follower: 1, followee: 1 }, { unique: true });
// Speed up look-ups in either direction
followSchema.index({ follower: 1 });
followSchema.index({ followee: 1 });

module.exports = mongoose.model("Follow", followSchema);

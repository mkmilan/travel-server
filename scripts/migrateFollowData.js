/**
 * Run once: `node scripts/migrateFollowData.js`
 * Copies follower / following arrays into Follow collection,
 * then wipes the arrays to reclaim space.
 */
const mongoose = require("mongoose");
const User = require("../models/User");
const Follow = require("../models/Follow");
const dotenv = require("dotenv");
dotenv.config({ path: "../.env" }); // Adjust path as needed

(async () => {
	await mongoose.connect(process.env.MONGO_URI);
	const users = await User.find({}).select("_id followers following");
	const bulk = Follow.collection.initializeUnorderedBulkOp();

	users.forEach((u) => {
		u.following.forEach((followeeId) => {
			bulk
				.find({ follower: u._id, followee: followeeId })
				.upsert()
				.updateOne({
					$setOnInsert: { createdAt: new Date() },
				});
		});
	});

	if (bulk.length) await bulk.execute();

	// Optionally clear the old arrays
	await User.updateMany({}, { $set: { followers: [], following: [] } });
	console.log("Migration done");
	process.exit();
})();

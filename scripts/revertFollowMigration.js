/**
 * Reverse the edge-migration:
 *  1. Scans the Follow collection
 *  2. Re-creates followers[] and following[] arrays on every User doc
 *  3. Re-writes followersCount / followingCount
 *
 *   node scripts/revertFollowMigration.js
 *
 * If you only want the arrays (no counters) just remove the $set lines.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Follow = require("../models/Follow"); // adjust path if needed
const User = require("../models/User");

dotenv.config({ path: "../.env" }); // same as before

(async () => {
	await mongoose.connect(process.env.MONGO_URI);

	/* ----------------------------------------------------------- *
	 * 1. Build look-up maps  (userId → Set<id>)
	 * ----------------------------------------------------------- */
	const followersMap = new Map(); // key = userId,  value = Set<their followers>
	const followingMap = new Map(); // key = userId,  value = Set<people they follow>

	console.log("Scanning Follow edges …");
	const cursor = Follow.find({}, { follower: 1, followee: 1 }).lean().cursor();

	for await (const edge of cursor) {
		const f = edge.follower.toString();
		const t = edge.followee.toString();

		// follower → following
		if (!followingMap.has(f)) followingMap.set(f, new Set());
		followingMap.get(f).add(t);

		// followee → followers
		if (!followersMap.has(t)) followersMap.set(t, new Set());
		followersMap.get(t).add(f);
	}

	/* ----------------------------------------------------------- *
	 * 2. Bulk-update User docs
	 * ----------------------------------------------------------- */
	console.log("Writing arrays back to users …");
	const bulk = User.collection.initializeUnorderedBulkOp();

	const allUserIds = new Set([...followersMap.keys(), ...followingMap.keys()]);

	for (const id of allUserIds) {
		const followersArr = [...(followersMap.get(id) ?? [])];
		const followingArr = [...(followingMap.get(id) ?? [])];

		bulk.find({ _id: new mongoose.Types.ObjectId(id) }).updateOne({
			$set: {
				followers: followersArr,
				following: followingArr,
				followersCount: followersArr.length,
				followingCount: followingArr.length,
			},
		});
	}

	if (bulk.length) await bulk.execute();
	console.log(`Updated ${bulk.length} user documents.`);

	/* ----------------------------------------------------------- */
	console.log("Re-hydration done. You may now drop the Follow collection if you like.");
	process.exit();
})();

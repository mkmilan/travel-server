// // --- searchJsonController.js ---
// // NOTE: identical naming style but with “Json” suffix so old controller keeps working.

// const User = require("../models/User");
// const Trip = require("../models/Trip");
// const Recommendation = require("../models/Recommendation");
// // ─────────────────────────────────────────────────────────────────────────────
// // GET /api/search-json?q=&type=&page=&limit=
// //
// // • Supports type = users | trips | recommendations
// // • Pagination: default page=1, limit=20   (Pass ?page=2 to load more.)
// // • Visibility:    - public   → everyone
// //                   - followers_only → requester must be in author's followers[]
// //                   - private  → only owner
// //   Uses User.followers array  (no Follow model required)
// // ─────────────────────────────────────────────────────────────────────────────

// // GET /api/search-json?q=&type=
// const performSearchJson = async (req, res, next) => {
// 	const { q, type } = req.query;
// 	const loggedInUserId = req.user?._id;

// 	if (!q || typeof q !== "string" || q.trim().length < 2) {
// 		return res.status(400).json({ message: "Query must be ≥ 2 chars." });
// 	}
// 	if (!type || !["users", "trips", "recommendations"].includes(type)) {
// 		return res.status(400).json({ message: "Invalid search type." });
// 	}

// 	const term = q.trim();
// 	const rx = new RegExp(term, "i"); // case-insensitive partial
// 	let results = [];

// 	try {
// 		switch (type) {
// 			case "users":
// 				results = await User.find({
// 					username: rx,
// 					_id: { $ne: loggedInUserId },
// 				}).select("_id username profilePictureUrl");
// 				break;

// 			case "trips": // ← JSON-only
// 				results = await Trip.find({
// 					format: "json", // NEW line
// 					$or: [
// 						{ title: rx },
// 						{ description: rx },
// 						{ startLocationName: rx },
// 						{ endLocationName: rx },
// 						// { "tags.label": rx }, // if you store tags
// 					],
// 				})
// 					.select(
// 						"_id title description likes comments" +
// 							"distanceKm durationMillis elevationGain " +
// 							"startDate endDate startLocationName endLocationName " +
// 							"  defaultTripVisibility" +
// 							"geoPreview lineString defaultTravelMode" +
// 							"distanceMeters simplifiedRoute  "
// 					)
// 					.populate("user", "_id username profilePictureUrl")
// 					.lean();
// 				break;

// 			case "recommendations":
// 				// match category *or* name; fallback: partial
// 				results = await Recommendation.find({
// 					$or: [
// 						{ primaryCategory: new RegExp(`^${term}$`, "i") }, // exact category
// 						{ name: rx },
// 					],
// 				})
// 					.select(
// 						"_id name user primaryCategory rating location coverPhotoUrl images averagePrice likesCount secondaryCategories tags"
// 					)
// 					.populate("user", "_id username profilePictureUrl")
// 					.lean();
// 				break;
// 		}
// 		console.log("Search results:", results);

// 		res.status(200).json(results);
// 	} catch (err) {
// 		console.error("JSON search error:", err);
// 		next(err);
// 	}
// };

// module.exports = { performSearchJson };
// server/controllers/searchJsonController.js
const User = require("../models/User");
const Trip = require("../models/Trip");
const Recommendation = require("../models/Recommendation");

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/search-json?q=&type=&page=&limit=
//
// • Supports type = users | trips | recommendations
// • Pagination: default page=1, limit=20   (Pass ?page=2 to load more.)
// • Visibility:    - public   → everyone
//                   - followers_only → requester must be in author's followers[]
//                   - private  → only owner
//   Uses User.followers array  (no Follow model required)
// ─────────────────────────────────────────────────────────────────────────────
const performSearchJson = async (req, res, next) => {
	try {
		const { q, type, page = 1, limit = 20 } = req.query;
		const meId = req.user?._id; // optional
		const PAGE = Math.max(1, parseInt(page, 10));
		const LIM = Math.min(50, Math.max(1, parseInt(limit, 10))); // safety

		if (!q || typeof q !== "string" || q.trim().length < 2)
			return res.status(400).json({ message: "Query must be ≥ 2 chars." });

		if (!["users", "trips", "recommendations"].includes(type))
			return res.status(400).json({ message: "Invalid search type." });

		const rx = new RegExp(q.trim(), "i");
		let results = [];

		// ───────────────────────────────── USERS
		if (type === "users") {
			results = await User.find({ username: rx, _id: { $ne: meId } })
				.sort({ createdAt: -1 })
				.skip((PAGE - 1) * LIM)
				.limit(LIM)
				.select("_id username profilePictureUrl")
				.lean();
			return res.json(results);
		}

		// helper: decide if meId follows author  (relies on followers[])
		const isFollower = (author) =>
			meId && Array.isArray(author.followers) ? author.followers.some((f) => String(f) === String(meId)) : false;

		// ───────────────────────────────── TRIPS
		if (type === "trips") {
			const raw = await Trip.find({
				format: "json",
				$or: [{ title: rx }, { description: rx }, { startLocationName: rx }, { endLocationName: rx }],
			})
				.sort({ startDate: -1 }) // newest first
				.skip((PAGE - 1) * LIM)
				.limit(LIM)
				.select(
					"_id title description photos distanceMeters durationMillis " +
						"startDate endDate startLocationName endLocationName " +
						"defaultTripVisibility simplifiedRoute mapCenter likes comments user"
				)
				.populate("user", "_id username profilePictureUrl followers") // followers array!
				.lean();

			results = raw.filter((t) => {
				const vis = t.defaultTripVisibility || "public";
				if (vis === "public") return true;
				if (!meId) return false;
				if (String(t.user._id) === String(meId)) return true;
				if (vis === "followers_only") return isFollower(t.user);
				return false; // private
			});

			// map + stats shaping
			results.forEach((t) => {
				t.coverPhotoUrl = t.photos?.[0] || null;
				t.distanceKm = +(t.distanceMeters / 1000).toFixed(2);
				t.durationSec = Math.round(t.durationMillis / 1000);
				t.likesCount = t.likes?.length || 0;
				t.commentsCount = t.comments?.length || 0;
				delete t.photos;
				delete t.likes;
				delete t.comments;
				delete t.user.followers; // strip follower list from payload
			});

			return res.json(results);
		}

		// ───────────────────────────────── RECOMMENDATIONS
		if (type === "recommendations") {
			const raw = await Recommendation.find({
				$or: [{ primaryCategory: new RegExp(`^${q.trim()}$`, "i") }, { name: rx }],
			})
				.sort({ createdAt: -1 })
				.skip((PAGE - 1) * LIM)
				.limit(LIM)
				.select("_id name description primaryCategory rating location photos " + "attributeTags associatedTrip user")
				.populate("user", "_id username profilePictureUrl followers")
				.populate("associatedTrip", "defaultTripVisibility user") // for visibility
				.lean();

			results = raw.filter((r) => {
				const tripVis = r.associatedTrip?.defaultTripVisibility || "public";
				const tripOwner = r.associatedTrip?.user ? String(r.associatedTrip.user) : null;

				if (tripVis === "public") return true;
				if (!meId) return false;
				if (tripOwner && tripOwner === String(meId)) return true;
				if (tripVis === "followers_only" && tripOwner) {
					// Fetch owner's followers array (already populated on r.user if same author)
					return isFollower(r.user);
				}
				return false;
			});

			results.forEach((r) => {
				r.coverPhotoUrl = r.photos?.[0] || null;
				delete r.photos;
				delete r.associatedTrip;
				delete r.user.followers;
			});

			return res.json(results);
		}
	} catch (err) {
		console.error("JSON search error:", err);
		next(err);
	}
};

module.exports = { performSearchJson };

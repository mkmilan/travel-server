const mongoose = require("mongoose");
const User = require("../models/User");
const Trip = require("../models/Trip");
const Recommendation = require("../models/Recommendation");

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const positiveInteger = (value, fallback) => value === undefined ? fallback
	: typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
const authorFields = { _id: 1, username: 1, profilePictureUrl: 1, city: 1, country: 1, followers: 1 };
const authorProjection = {
	_id: "$author._id", username: "$author.username", profilePictureUrl: "$author.profilePictureUrl",
	city: "$author.city", country: "$author.country",
};
const authorLookup = [
	{ $lookup: { from: "users", localField: "user", foreignField: "_id", pipeline: [{ $project: authorFields }], as: "author" } },
	{ $unwind: "$author" }, // Deleted/missing authors do not produce searchable cards.
];

function validateSearch(query) {
	const { q, type, category, envelope } = query;
	if (typeof q !== "string" || q.trim().length < 2 || q.trim().length > 120)
		return { error: "Query must contain 2 to 120 characters." };
	if (!["users", "trips", "recommendations"].includes(type)) return { error: "Invalid search type." };
	if (category !== undefined && (type !== "recommendations" || typeof category !== "string" ||
		!Recommendation.schema.path("primaryCategory").enumValues.includes(category)))
		return { error: "Invalid recommendation category." };
	if (envelope !== undefined && envelope !== "true" && envelope !== "false")
		return { error: "envelope must be true or false." };
	const page = positiveInteger(query.page, 1), limit = positiveInteger(query.limit, 20);
	const skip = (page - 1) * limit;
	if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 50 || !Number.isSafeInteger(skip))
		return { error: "page must be a positive integer and limit must be an integer from 1 to 50." };
	return { q: q.trim(), type, category, envelope: envelope === "true", page, limit, skip };
}

// Uses the author's current followers, not a potentially stale viewer.following array.
function readableTrip(viewerId, user = "$user", visibility = "$defaultTripVisibility") {
	const clauses = [{ $eq: [visibility, "public"] }];
	if (viewerId) clauses.push(
		{ $eq: [user, viewerId] },
		{ $and: [{ $eq: [visibility, "followers_only"] }, { $in: [viewerId, { $ifNull: ["$author.followers", []] }] }] },
	);
	return { $or: clauses };
}

function tripPipeline(rx, viewerId) {
	return [
		{ $match: { format: "json", $or: [{ title: rx }, { description: rx }, { startLocationName: rx }, { endLocationName: rx }] } },
		...authorLookup,
		{ $match: { $expr: readableTrip(viewerId) } },
	];
}

function recommendationPipeline(rx, category, viewerId, legacyCategorySearch) {
	// This search intentionally has a narrower standalone policy than the legacy
	// global recommendation API. Do not change that API's shared visibility helper.
	const standalone = viewerId ? [{ $and: [
		{ $eq: [{ $ifNull: ["$associatedTrip", null] }, null] }, { $eq: ["$user", viewerId] },
	] }] : [];
	return [
		{ $match: { $or: [
			{ name: rx }, { description: rx },
			// Retain old category-as-text matches for existing bare-array callers only.
			...(legacyCategorySearch ? [{ primaryCategory: new RegExp(`^${rx.source}$`, "i") }] : []),
		], ...(category ? { primaryCategory: category } : {}) } },
		...authorLookup,
		{ $lookup: { from: "trips", localField: "associatedTrip", foreignField: "_id", pipeline: [
			{ $project: { user: 1, defaultTripVisibility: 1 } },
		], as: "linkedTrip" } },
		{ $unwind: { path: "$linkedTrip", preserveNullAndEmptyArrays: true } },
		{ $match: { $expr: { $or: [
			...standalone,
			{ $and: [
				{ $ne: [{ $ifNull: ["$associatedTrip", null] }, null] },
				{ $eq: ["$linkedTrip.user", "$user"] }, // Reject orphan and foreign associations, even for their owner.
				readableTrip(viewerId, "$linkedTrip.user", "$linkedTrip.defaultTripVisibility"),
			] },
		] } } },
	];
}

function tripCardStages(viewerId) {
	return [
		{ $lookup: { from: "recommendations", let: { tripId: "$_id", ownerId: "$user" }, pipeline: [
			{ $match: { $expr: { $and: [{ $eq: ["$associatedTrip", "$$tripId"] }, { $eq: ["$user", "$$ownerId"] }] } } },
			{ $count: "count" },
		], as: "recommendationStats" } },
		{ $project: {
			_id: 1, title: 1, description: 1, startDate: 1, endDate: 1, createdAt: 1,
			startLocationName: 1, endLocationName: 1, defaultTravelMode: 1, defaultTripVisibility: 1,
			simplifiedRoute: 1, mapCenter: 1, distanceMeters: 1, durationMillis: 1, photos: 1,
			coverPhotoUrl: { $ifNull: [{ $arrayElemAt: ["$photos", 0] }, null] }, // Legacy name; value is a media ID, not a URL.
			distanceKm: { $round: [{ $divide: [{ $ifNull: ["$distanceMeters", 0] }, 1000] }, 2] },
			durationSec: { $round: [{ $divide: [{ $ifNull: ["$durationMillis", 0] }, 1000] }, 0] },
			likesCount: { $size: { $ifNull: ["$likes", []] } }, commentsCount: { $size: { $ifNull: ["$comments", []] } },
			recommendationCount: { $ifNull: [{ $arrayElemAt: ["$recommendationStats.count", 0] }, 0] },
			isLikedByCurrentUser: viewerId ? { $in: [viewerId, { $ifNull: ["$likes", []] }] } : { $literal: false },
			user: authorProjection,
		} },
	];
}

/**
 * GET /api/v2/search?q=&type=users|trips|recommendations&page=1&limit=20
 * Bare arrays remain the default for existing callers. Mobile opts into
 * envelope=true: { results, page, limit, total, hasMore }, requiring a valid login.
 * Both page results and total operate on the same already-visible documents.
 */
const performSearchJson = async (req, res, next) => {
	const options = validateSearch(req.query);
	if (options.error) return res.status(400).json({ message: options.error });
	if (options.envelope && !req.user?._id) return res.status(401).json({ message: "Sign in to search." });
	try {
		const { q, type, category, page, limit, skip, envelope } = options;
		// Aggregations do not perform Mongoose's query casting.
		const viewerId = req.user?._id ? new mongoose.Types.ObjectId(String(req.user._id)) : null;
		const rx = new RegExp(escapeRegex(q), "i");
		let model, pipeline, cardStages, sort;
		if (type === "users") {
			model = User;
			pipeline = [{ $match: { username: rx, ...(viewerId ? { _id: { $ne: viewerId } } : {}) } }];
			cardStages = [{ $project: { _id: 1, username: 1, profilePictureUrl: 1, city: 1, country: 1 } }];
			sort = { createdAt: -1, _id: -1 };
		} else if (type === "trips") {
			model = Trip;
			pipeline = tripPipeline(rx, viewerId);
			cardStages = tripCardStages(viewerId);
			sort = { startDate: -1, _id: -1 };
		} else {
			model = Recommendation;
			pipeline = recommendationPipeline(rx, category, viewerId, !envelope);
			cardStages = [{ $project: {
				_id: 1, name: 1, description: 1, primaryCategory: 1, rating: 1, location: 1,
				photos: 1, attributeTags: 1, associatedTrip: 1, associatedPoiId: 1, createdAt: 1, source: 1,
				coverPhotoUrl: { $ifNull: [{ $arrayElemAt: ["$photos", 0] }, null] }, user: authorProjection,
			} }];
			sort = { createdAt: -1, _id: -1 };
		}
		const resultsPipeline = [{ $sort: sort }, { $skip: skip }, { $limit: limit }, ...cardStages];
		// Legacy callers need no count. Either way, visibility always precedes paging.
		if (!envelope) {
			const results = await model.aggregate([...pipeline, ...resultsPipeline]);
			res.set("Cache-Control", "private, no-store");
			return res.json(results);
		}
		const [response] = await model.aggregate([...pipeline, { $facet: {
			results: resultsPipeline, metadata: [{ $count: "total" }],
		} }]);
		const results = response?.results || [], total = response?.metadata?.[0]?.total || 0;
		res.set("Cache-Control", "private, no-store");
		return res.json({ results, page, limit, total, hasMore: skip + results.length < total });
	} catch (error) { next(error); }
};

/** Existing /users route keeps its token-at-word-start matching and array shape. */
const searchUsers = async (req, res, next) => {
	const options = validateSearch({ ...req.query, type: "users" });
	if (options.error) return res.status(400).json({ message: options.error });
	const tokens = options.q.split(/\s+/).filter(token => token.length >= 2);
	if (!tokens.length) return res.status(400).json({ message: "Enter at least one username token with 2 characters." });
	try {
		const users = await User.find({ $and: tokens.map(token => ({ username: new RegExp("\\b" + escapeRegex(token), "i") })) })
			.sort({ createdAt: -1, _id: -1 }).skip(options.skip).limit(options.limit)
			.select("_id username profilePictureUrl city country").lean();
		res.set("Cache-Control", "private, no-store");
		return res.json(users);
	} catch (error) { next(error); }
};

module.exports = { performSearchJson, searchUsers };

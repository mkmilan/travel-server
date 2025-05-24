const turf = require("@turf/turf");
const Trip = require("../models/Trip");
const User = require("../models/User");
// const Recommendation = require("../models/Recommendation"); // No longer directly used here for creation
const mongoose = require("mongoose");
const {
	processPendingRecommendations,
} = require("./recommendationJsonController"); // Import the new function

/* POST  /api/v2/trips/json   (protected) */
exports.createTripJson = async (req, res, next) => {
	try {
		const userId = req.user._id;
		const userSettings = req.user.settings || {};
		const {
			title: requestTitle,
			description,
			startLocationName,
			endLocationName,
			startTime,
			segments = [],
			pois = [],
			recommendations: pendingRecommendationsPayload = [], // Renamed to avoid conflict
			defaultTripVisibility: requestDefaultTripVisibility,
			defaultTravelMode: requestDefaultTravelMode,
		} = req.body;

		if (!startTime || !segments.length) {
			return res
				.status(400)
				.json({ message: "startTime & segments are required" });
		}

		const allPts = segments.flatMap((s) => s.track);
		if (allPts.length < 2) {
			return res.status(400).json({ message: "Not enough track points" });
		}

		const line = turf.lineString(allPts.map((p) => [p.lon, p.lat]));
		const distanceMeters = turf.length(line, { units: "meters" });
		const startDate = new Date(startTime);
		const endDate = new Date(
			segments[segments.length - 1].endTime || allPts[allPts.length - 1].t
		);
		const durationMillis = endDate.getTime() - startDate.getTime();
		const simplified = turf.simplify(line, {
			tolerance: 0.0001,
			highQuality: true,
		});

		const pointsOfInterest = (pois || []).map((p) => ({
			lat: p.lat,
			lon: p.lon,
			timestamp: p.timestamp ? new Date(p.timestamp) : new Date(),
			name: p.name || null,
			description: p.note || null,
		}));

		const newTripData = {
			format: "json",
			user: userId,
			title: requestTitle || `Trip on ${startDate.toLocaleDateString()}`,
			description: description || "",
			startLocationName: startLocationName || null,
			endLocationName: endLocationName || null,
			startDate,
			endDate,
			durationMillis,
			distanceMeters,
			segments,
			pointsOfInterest,
			simplifiedRoute: {
				type: "LineString",
				coordinates: simplified.geometry.coordinates,
			},
			defaultTripVisibility:
				requestDefaultTripVisibility ||
				userSettings.defaultTripVisibility ||
				Trip.schema.path("defaultTripVisibility").defaultValue,
			defaultTravelMode:
				requestDefaultTravelMode ||
				userSettings.defaultTravelMode ||
				Trip.schema.path("defaultTravelMode").defaultValue,
			mapCenter: { lat: allPts[0].lat, lon: allPts[0].lon },
		};

		const savedTrip = await Trip.create(newTripData);

		// --- Process Pending Recommendations using the new controller function ---
		let recommendationsOutcome = [];
		if (savedTrip && savedTrip._id) {
			console.log(
				`Processing ${pendingRecommendationsPayload.length} pending recommendations for trip ${savedTrip._id} using recommendationJsonController...`
			);
			recommendationsOutcome = await processPendingRecommendations(
				pendingRecommendationsPayload,
				userId,
				savedTrip._id
			);
			console.log(
				`Finished processing recommendations for trip ${savedTrip._id}. ${
					recommendationsOutcome.filter((r) => r.status === "created").length
				} created.`
			);
		}
		// --- End Recommendation Processing ---

		const populatedTrip = await Trip.findById(savedTrip._id)
			.populate("user", "username profilePictureUrl")
			.lean();

		res.status(201).json({
			trip: populatedTrip,
			recommendationsOutcome: recommendationsOutcome,
		});
	} catch (err) {
		console.error("createTripJson error:", err);
		if (!res.headersSent) {
			next(err);
		}
	}
};

exports.getTripJsonById = async (req, res, next) => {
	const { tripId } = req.params;

	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		return res.status(400).json({ message: "Invalid Trip ID" });
	}

	try {
		const trip = await Trip.findById(tripId)
			.populate("user", "username profilePictureUrl followers")
			.lean();

		if (!trip || trip.format !== "json") {
			return res
				.status(404)
				.json({ message: "Trip not found or not JSON format" });
		}

		const isOwner = req.user?._id?.toString() === trip.user._id.toString();
		const isFollower =
			req.user?._id &&
			trip.user.followers?.some(
				(f) => f.toString() === req.user._id.toString()
			);

		if (
			trip.defaultTripVisibility === "public" ||
			isOwner ||
			(trip.defaultTripVisibility === "followers_only" && isFollower)
		) {
			return res.status(200).json(trip);
		}

		if (!req.user) {
			return res
				.status(401)
				.json({ message: "Authentication required to view this trip" });
		}

		return res
			.status(403)
			.json({ message: "You don't have permission to view this trip" });
	} catch (error) {
		console.error("getTripJsonById error:", error);
		next(error);
	}
};

exports.getMyJsonTrips = async (req, res, next) => {
	const userId = req.user._id;

	try {
		const trips = await Trip.aggregate([
			{ $match: { user: userId, format: "json" } },
			{ $sort: { startDate: -1 } },
			{
				$project: {
					_id: 1,
					title: 1,
					startDate: 1,
					description: { $substrCP: ["$description", 0, 150] },
					defaultTravelMode: 1,
					defaultTripVisibility: 1,
					simplifiedRoute: 1,
					distanceMeters: 1,
					durationMillis: 1,
					likesCount: { $ifNull: [{ $size: "$likes" }, 0] },
					commentsCount: { $ifNull: [{ $size: "$comments" }, 0] },
					createdAt: 1,
				},
			},
		]);

		res.status(200).json(trips);
	} catch (error) {
		console.error("getMyJsonTrips error:", error);
		next(error);
	}
};

/* GET /api/v2/trips/json/feed (protected) */
exports.getFollowingTripsFeedJson = async (req, res, next) => {
	const userId = req.user._id;

	try {
		// 1. Get the list of users the current user is following
		const currentUser = await User.findById(userId).select("following").lean();
		if (
			!currentUser ||
			!currentUser.following ||
			currentUser.following.length === 0
		) {
			return res.status(200).json([]); // No one followed, return empty feed
		}
		const followedUserIds = currentUser.following;

		// 2. Fetch trips from followed users
		const feedTrips = await Trip.aggregate([
			{
				$match: {
					user: { $in: followedUserIds }, // Trips from users I follow
					format: "json",
					$or: [
						{ defaultTripVisibility: "public" },
						{ defaultTripVisibility: "followers_only" },
					],
				},
			},
			{ $sort: { startDate: -1 } }, // Show newest trips first
			{
				$lookup: {
					// Populate user details for each trip
					from: "users", // The collection name for Users
					localField: "user",
					foreignField: "_id",
					as: "userDetails",
				},
			},
			{
				$unwind: {
					// Unwind the userDetails array (should be only one user per trip)
					path: "$userDetails",
					preserveNullAndEmptyArrays: true, // Keep trip even if user somehow not found
				},
			},
			{
				$project: {
					// Select and shape the data for the feed
					_id: 1,
					title: 1,
					startDate: 1,
					description: { $substrCP: ["$description", 0, 150] }, // Snippet
					defaultTravelMode: 1,
					defaultTripVisibility: 1,
					simplifiedRoute: 1, // For map preview
					distanceMeters: 1,
					durationMillis: 1,
					likesCount: { $ifNull: [{ $size: "$likes" }, 0] },
					commentsCount: { $ifNull: [{ $size: "$comments" }, 0] },
					createdAt: 1,
					user: {
						// Include selected user details
						_id: "$userDetails._id",
						username: "$userDetails.username",
						profilePictureUrl: "$userDetails.profilePictureUrl",
					},
					// You might want to add other fields like start/end location names
					startLocationName: 1,
					endLocationName: 1,
				},
			},
		]);

		res.status(200).json(feedTrips);
	} catch (error) {
		console.error("getFollowingTripsFeedJson error:", error);
		next(error);
	}
};

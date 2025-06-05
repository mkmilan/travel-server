const turf = require("@turf/turf");
const Trip = require("../models/Trip");
const User = require("../models/User");
const Recommendation = require("../models/Recommendation");
const mongoose = require("mongoose");
const { processPendingRecommendations } = require("./recommendationJsonController"); // Import the new function
const { json } = require("express");

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
			return res.status(400).json({ message: "startTime & segments are required" });
		}

		const allPts = segments.flatMap((s) => s.track);
		if (allPts.length < 2) {
			return res.status(400).json({ message: "Not enough track points" });
		}

		const line = turf.lineString(allPts.map((p) => [p.lon, p.lat]));
		const distanceMeters = turf.length(line, { units: "meters" });
		const startDate = new Date(startTime);
		const endDate = new Date(segments[segments.length - 1].endTime || allPts[allPts.length - 1].t);
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

		const populatedTrip = await Trip.findById(savedTrip._id).populate("user", "username profilePictureUrl").lean();

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
		const trip = await Trip.findById(tripId).populate("user", "username profilePictureUrl followers").lean(); // Keep .lean() for the main trip object

		if (!trip || trip.format !== "json") {
			return res.status(404).json({ message: "Trip not found or not JSON format" });
		}

		const isOwner = req.user?._id?.toString() === trip.user._id.toString();
		const isFollower = req.user?._id && trip.user.followers?.some((f) => f.toString() === req.user._id.toString());

		if (
			trip.defaultTripVisibility === "public" ||
			isOwner ||
			(trip.defaultTripVisibility === "followers_only" && isFollower)
		) {
			// Fetch associated recommendations
			const recommendations = await Recommendation.find({
				associatedTrip: tripId,
			})
				.populate("user", "username profilePictureUrl") // Populate user details for recommendations
				.lean(); // Use .lean() for recommendations as well

			// Add recommendations to the trip object
			const tripWithRecommendations = { ...trip, recommendations };

			return res.status(200).json(tripWithRecommendations);
		}

		if (!req.user) {
			return res.status(401).json({ message: "Authentication required to view this trip" });
		}

		return res.status(403).json({ message: "You don't have permission to view this trip" });
	} catch (error) {
		console.error("getTripJsonById error:", error);
		next(error);
	}
};

/* PUT /api/v2/trips/json/:tripId (protected) */
exports.updateTripJson = async (req, res, next) => {
	const { tripId } = req.params;
	const userId = req.user._id;

	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		return res.status(400).json({ message: "Invalid Trip ID" });
	}

	try {
		const trip = await Trip.findById(tripId);

		if (!trip || trip.format !== "json") {
			return res.status(404).json({ message: "Trip not found or not JSON format" });
		}

		if (trip.user.toString() !== userId.toString()) {
			return res.status(403).json({ message: "User not authorized to update this trip" });
		}

		// Fields that can be updated
		const { title, description, startLocationName, endLocationName, defaultTripVisibility, defaultTravelMode } =
			req.body;
		// const { title, description, startLocationName, endLocationName, defaultTripVisibility, defaultTravelMode, photos } =
		// 	req.body;

		// Update fields if they are provided in the request
		if (title !== undefined) trip.title = title;
		if (description !== undefined) trip.description = description;
		if (startLocationName !== undefined) trip.startLocationName = startLocationName;
		if (endLocationName !== undefined) trip.endLocationName = endLocationName;
		if (defaultTripVisibility !== undefined) trip.defaultTripVisibility = defaultTripVisibility;
		if (defaultTravelMode !== undefined) trip.defaultTravelMode = defaultTravelMode;

		// if (photos !== undefined && Array.isArray(photos)) {
		// 	trip.photos = photos.filter((id) => typeof id === "string" && mongoose.Types.ObjectId.isValid(id));
		// }
		// Note: For simplicity, this update does not re-calculate distance, duration, or simplifiedRoute.
		// If segments or POIs were to be updated, those would need more complex handling similar to createTripJson.

		const updatedTrip = await trip.save();
		const populatedTrip = await Trip.findById(updatedTrip._id).populate("user", "username profilePictureUrl").lean();

		res.status(200).json(populatedTrip);
		console.log("trip update", populatedTrip);
	} catch (error) {
		console.error("updateTripJson error:", error);
		if (!res.headersSent) {
			next(error);
		}
	}
};

exports.getMyJsonTrips = async (req, res, next) => {
	const userId = req.user._id;
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 10;
	const skip = (page - 1) * limit;

	try {
		const matchQuery = { user: userId, format: "json" };

		const tripsPipeline = [
			{ $match: matchQuery },
			{ $sort: { startDate: -1 } },
			{ $skip: skip },
			{ $limit: limit },
			{
				$lookup: {
					from: "recommendations", // The collection name for your Recommendation model
					localField: "_id", // Field from the trips collection
					foreignField: "associatedTrip", // Field in the recommendations collection that links to the trip
					as: "tripRecommendations", // Name of the new array field to add to the input documents
				},
			},
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
					recommendationCount: { $ifNull: [{ $size: "$tripRecommendations" }, 0] },
					isLikedByCurrentUser: { $in: [userId, { $ifNull: ["$likes", []] }] }, // Added isLikedByCurrentUser
					createdAt: 1,
					// user field is not projected here as it's "my" trips, client knows the user.
					// If needed for consistency, it can be added via another $lookup or if populated before aggregation.
				},
			},
		];

		const trips = await Trip.aggregate(tripsPipeline);
		const totalCount = await Trip.countDocuments(matchQuery);

		res.status(200).json({
			items: trips,
			page,
			limit,
			totalPages: Math.ceil(totalCount / limit),
			totalCount,
		});
	} catch (error) {
		console.error("getMyJsonTrips error:", error);
		next(error);
	}
};

/* GET /api/v2/trips/json/feed (protected) */
exports.getTripsFeedJson = async (req, res, next) => {
	const userId = req.user._id;
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 10;
	const skip = (page - 1) * limit;

	try {
		// 1. Get the list of users the current user is following
		const currentUser = await User.findById(userId).select("following").lean();
		if (!currentUser || !currentUser.following || currentUser.following.length === 0) {
			return res.status(200).json({
				items: [],
				page,
				limit,
				totalPages: 0,
				totalCount: 0,
			}); // No one followed, return empty feed
		}
		const followedUserIds = currentUser.following;

		const matchStage = {
			user: { $in: followedUserIds }, // Trips from users I follow
			format: "json",
			$or: [{ defaultTripVisibility: "public" }, { defaultTripVisibility: "followers_only" }],
		};

		// 2. Fetch trips from followed users
		const feedTripsPipeline = [
			{ $match: matchStage },
			{ $sort: { startDate: -1 } }, // Show newest trips first
			{ $skip: skip },
			{ $limit: limit },
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
				$lookup: {
					from: "recommendations",
					localField: "_id",
					foreignField: "associatedTrip",
					as: "tripRecommendations",
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
					recommendationCount: { $ifNull: [{ $size: "$tripRecommendations" }, 0] },
					isLikedByCurrentUser: { $in: [userId, { $ifNull: ["$likes", []] }] },
					createdAt: 1,
					user: {
						// Include selected user details
						_id: "$userDetails._id",
						username: "$userDetails.username",
						profilePictureUrl: "$userDetails.profilePictureUrl",
					},
					startLocationName: 1,
					endLocationName: 1,
				},
			},
		];

		const feedTrips = await Trip.aggregate(feedTripsPipeline);
		const totalCount = await Trip.countDocuments(matchStage);

		res.status(200).json({
			items: feedTrips,
			page,
			limit,
			totalPages: Math.ceil(totalCount / limit),
			totalCount,
		});
	} catch (error) {
		console.error("getTripsFeedJson error:", error); // Corrected console error log name
		next(error);
	}
};

/**
 * @desc    Get JSON trips for a specific user, respecting visibility
 * @route   GET /api/v2/trips/json/user/:userId
 * @access  Public (with optional auth for followers_only/private content)
 */
exports.getUserJsonTrips = async (req, res, next) => {
	const targetUserIdString = req.params.userId;
	const requestingUser = req.user; // From protectOptional middleware

	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 10;
	const skip = (page - 1) * limit;

	if (!mongoose.Types.ObjectId.isValid(targetUserIdString)) {
		return res.status(400).json({ message: `Invalid target user ID format: ${targetUserIdString}` });
	}
	const targetUserId = new mongoose.Types.ObjectId(targetUserIdString);

	try {
		const targetUser = await User.findById(targetUserId).select("followers").lean();
		if (!targetUser) {
			return res.status(404).json({ message: "Target user not found" });
		}

		const queryConditions = {
			user: targetUserId,
			format: "json",
		};

		const allowedVisibilities = ["public"];
		let isOwner = false;

		if (requestingUser) {
			if (requestingUser._id.equals(targetUserId)) {
				// Owner can see all their trips
				allowedVisibilities.push("followers_only", "private");
				isOwner = true;
			} else {
				// Check if the requesting user follows the target user
				const isFollower = targetUser.followers.some((followerId) => followerId.equals(requestingUser._id));
				if (isFollower) {
					allowedVisibilities.push("followers_only");
				}
			}
		}
		// If not owner, and not a follower (or unauthenticated), only 'public' is allowed

		queryConditions.defaultTripVisibility = { $in: allowedVisibilities };

		const tripsPipeline = [
			{ $match: queryConditions },
			{ $sort: { startDate: -1 } },
			{ $skip: skip },
			{ $limit: limit },
			{
				$lookup: {
					from: "users",
					localField: "user",
					foreignField: "_id",
					as: "userDetails",
				},
			},
			{ $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true } },
			{
				$lookup: {
					from: "recommendations",
					localField: "_id",
					foreignField: "associatedTrip",
					as: "tripRecommendations",
				},
			},
			{
				$addFields: {
					recommendationCount: { $ifNull: [{ $size: "$tripRecommendations" }, 0] },
					isLikedByCurrentUser: { $in: [requestingUser?._id, { $ifNull: ["$likes", []] }] },
					user: {
						// Shaping the user object
						_id: "$userDetails._id",
						username: "$userDetails.username",
						profilePictureUrl: "$userDetails.profilePictureUrl",
					},
				},
			},
			{
				$project: {
					// Final field selection
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
					recommendationCount: 1,
					isLikedByCurrentUser: 1,
					user: 1,
					createdAt: 1,
					startLocationName: 1,
					endLocationName: 1,
					// Clean up temporary fields
					// userDetails: 0,
					// tripRecommendations: 0,
				},
			},
		];

		const trips = await Trip.aggregate(tripsPipeline);
		const totalCount = await Trip.countDocuments(queryConditions);

		res.status(200).json({
			data: trips,
			page,
			limit,
			totalPages: Math.ceil(totalCount / limit),
			totalCount,
		});
	} catch (error) {
		console.error(`Error fetching JSON trips for user ${targetUserIdString}:`, error);
		next(error);
	}
};

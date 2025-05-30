const Recommendation = require("../models/Recommendation");
const mongoose = require("mongoose");
const User = require("../models/User");
const Trip = require("../models/Trip");

/**
 * @desc    Processes an array of pending recommendation data from a JSON payload
 *          and creates recommendation documents.
 * @param   {Array<Object>} pendingRecommendations - Array of recommendation data objects.
 * @param   {mongoose.Types.ObjectId} userId - The ID of the user creating the recommendations.
 * @param   {mongoose.Types.ObjectId} tripId - The ID of the trip these recommendations are associated with.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of outcomes for each recommendation.
 */
const processPendingRecommendations = async (pendingRecommendations, userId, tripId) => {
	if (!pendingRecommendations || !Array.isArray(pendingRecommendations) || pendingRecommendations.length === 0) {
		return []; // No recommendations to process
	}

	const createdRecommendationsInfo = [];
	const allowedCategories = Recommendation.schema.path("primaryCategory").enumValues;

	for (const recData of pendingRecommendations) {
		try {
			// --- Validate and Map Recommendation Data ---
			if (
				!recData.name ||
				recData.latitude === undefined ||
				recData.longitude === undefined ||
				!recData.primaryCategory
			) {
				console.warn(
					`Skipping recommendation (tripId: ${tripId}) due to missing core fields (name, latitude, longitude, primaryCategory):`,
					recData.name || "N/A"
				);
				createdRecommendationsInfo.push({
					name: recData.name || "Unknown",
					status: "skipped",
					reason: "Missing core fields",
				});
				continue;
			}

			const lat = parseFloat(recData.latitude);
			const lon = parseFloat(recData.longitude);

			if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
				console.warn(`Skipping recommendation (tripId: ${tripId}, name: ${recData.name}) due to invalid coordinates:`, {
					lat,
					lon,
				});
				createdRecommendationsInfo.push({
					name: recData.name,
					status: "skipped",
					reason: "Invalid coordinates",
				});
				continue;
			}

			let rating = recData.rating ? parseFloat(recData.rating) : 3; // Default rating
			if (isNaN(rating) || rating < 1 || rating > 5) {
				console.warn(
					`Invalid rating for recommendation (tripId: ${tripId}, name: ${recData.name}), using default. Rating: ${recData.rating}`
				);
				rating = 3;
			}

			let primaryCategory = recData.primaryCategory;
			if (!allowedCategories.includes(primaryCategory)) {
				console.warn(
					`Invalid primaryCategory '${primaryCategory}' for recommendation (tripId: ${tripId}, name: '${recData.name}'). Setting to OTHER.`
				);
				primaryCategory = "OTHER";
			}

			// Assuming photo handling for JSON means photo IDs or URLs are passed, not raw files.
			// If `recData.photos` contains an array of pre-uploaded photo IDs:
			const photoIds = Array.isArray(recData.photoIds)
				? recData.photoIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
				: [];

			const recommendationToSave = {
				user: userId,
				name: recData.name,
				description: recData.description || recData.note || "", // 'note' as fallback from mobile
				rating: rating,
				primaryCategory: primaryCategory,
				attributeTags: Array.isArray(recData.attributeTags) ? recData.attributeTags : [],
				location: {
					type: "Point",
					coordinates: [lon, lat], // [longitude, latitude]
				},
				photos: photoIds, // Use validated photo IDs
				associatedTrip: tripId,
				// associatedPoiId: recData.associatedPoiId && mongoose.Types.ObjectId.isValid(recData.associatedPoiId) ? recData.associatedPoiId : null,
				source: recData.source || "TRACKING", // More specific source
			};

			const savedRecommendation = await Recommendation.create(recommendationToSave);
			createdRecommendationsInfo.push({
				id: savedRecommendation._id,
				name: savedRecommendation.name,
				status: "created",
			});
			console.log(`Successfully created recommendation '${savedRecommendation.name}' for trip ${tripId} via JSON.`);
		} catch (recError) {
			console.error(
				`Error saving a pending recommendation ('${recData.name || "N/A"}') for trip ${tripId} from JSON:`,
				recError.message,
				"Data:",
				recData
			);
			createdRecommendationsInfo.push({
				name: recData.name || "Unknown",
				status: "failed",
				error: recError.message,
			});
		}
	}
	return createdRecommendationsInfo;
};

const createSingleRecommendationJson = async (req, res, next) => {
	try {
		const userId = req.user._id;
		const recommendationData = req.body;
		// Ensure associatedTrip is explicitly null if not provided or empty,
		// to be compatible with how processPendingRecommendations might use it.
		const associatedTripId = recommendationData.associatedTrip ? recommendationData.associatedTrip : null;

		// Basic validation for the single recommendation object
		if (
			!recommendationData.name ||
			recommendationData.latitude === undefined ||
			recommendationData.longitude === undefined ||
			!recommendationData.primaryCategory
		) {
			return res.status(400).json({
				message: "Missing required fields for recommendation (name, latitude, longitude, primaryCategory).",
			});
		}

		// Call processPendingRecommendations with an array containing the single recommendation
		const creationResults = await processPendingRecommendations(
			[recommendationData], // Pass as an array
			userId,
			associatedTripId // Pass associatedTripId from payload, can be null
		);

		if (creationResults.length === 0 || !creationResults[0]) {
			return res.status(400).json({ message: "Recommendation processing failed." });
		}

		const result = creationResults[0];
		if (result.status === "created" && result.id) {
			const newRecommendation = await Recommendation.findById(result.id);
			if (!newRecommendation) {
				// Should not happen if status is 'created' and id is present
				return res.status(404).json({ message: "Newly created recommendation not found." });
			}
			return res.status(201).json(newRecommendation);
		} else {
			return res.status(400).json({ message: result.error || "Failed to create recommendation." });
		}
	} catch (error) {
		console.error("Error in createSingleRecommendationJson:", error);
		if (!res.headersSent) {
			res.status(500).json({ message: "Server error while creating recommendation." });
		}
		// Consider calling next(error) if you have a centralized error handler
	}
};

const updateRecommendationJson = async (req, res, next) => {
	const { recommendationId } = req.params;
	const userId = req.user._id;
	const updateData = req.body;

	if (!mongoose.Types.ObjectId.isValid(recommendationId)) {
		return res.status(400).json({ message: "Invalid recommendation ID." });
	}

	try {
		const recommendation = await Recommendation.findById(recommendationId);

		if (!recommendation) {
			return res.status(404).json({ message: "Recommendation not found." });
		}

		if (recommendation.user.toString() !== userId.toString()) {
			return res.status(403).json({
				message: "User not authorized to update this recommendation.",
			});
		}

		// Update fields
		if (updateData.name !== undefined) recommendation.name = updateData.name;
		if (updateData.description !== undefined) recommendation.description = updateData.description;

		if (updateData.rating !== undefined) {
			const rating = parseFloat(updateData.rating);
			if (isNaN(rating) || rating < 1 || rating > 5) {
				return res.status(400).json({ message: "Invalid rating. Must be between 1 and 5." });
			}
			recommendation.rating = rating;
		}

		if (updateData.primaryCategory !== undefined) {
			if (!Recommendation.schema.path("primaryCategory").enumValues.includes(updateData.primaryCategory)) {
				return res.status(400).json({ message: "Invalid primary category." });
			}
			recommendation.primaryCategory = updateData.primaryCategory;
		}

		if (updateData.attributeTags !== undefined) {
			if (!Array.isArray(updateData.attributeTags)) {
				return res.status(400).json({ message: "attributeTags must be an array." });
			}
			recommendation.attributeTags = updateData.attributeTags;
		}

		if (updateData.latitude !== undefined && updateData.longitude !== undefined) {
			const lat = parseFloat(updateData.latitude);
			const lon = parseFloat(updateData.longitude);
			if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
				return res.status(400).json({ message: "Invalid latitude or longitude." });
			}
			recommendation.location = { type: "Point", coordinates: [lon, lat] };
		} else if (updateData.latitude !== undefined || updateData.longitude !== undefined) {
			return res.status(400).json({
				message: "Both latitude and longitude must be provided to update location.",
			});
		}

		// Assuming photoIds are passed for JSON updates, similar to creation
		if (updateData.photoIds !== undefined) {
			if (!Array.isArray(updateData.photoIds)) {
				return res.status(400).json({ message: "photoIds must be an array." });
			}
			// Assuming photoIds are ObjectIds. If they are URLs, adjust validation.
			recommendation.photos = updateData.photoIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
		} else if (updateData.photos !== undefined) {
			// Fallback if 'photos' is sent
			if (!Array.isArray(updateData.photos)) {
				return res.status(400).json({
					message: "photos must be an array of valid photo identifiers.",
				});
			}
			recommendation.photos = updateData.photos.filter((id) => mongoose.Types.ObjectId.isValid(id)); // Or handle as URLs if applicable
		}

		if (updateData.associatedTrip !== undefined) {
			if (updateData.associatedTrip === null || mongoose.Types.ObjectId.isValid(updateData.associatedTrip)) {
				recommendation.associatedTrip = updateData.associatedTrip;
			} else {
				return res.status(400).json({ message: "Invalid associatedTrip ID." });
			}
		}

		// Add other updatable fields as necessary e.g. source
		if (updateData.source !== undefined) {
			if (!Recommendation.schema.path("source").enumValues.includes(updateData.source)) {
				return res.status(400).json({ message: "Invalid source value." });
			}
			recommendation.source = updateData.source;
		}

		const updatedRecommendation = await recommendation.save();
		res.status(200).json(updatedRecommendation);
	} catch (error) {
		console.error("Error in updateRecommendationJson:", error);
		if (error.name === "ValidationError") {
			return res.status(400).json({ message: error.message });
		}
		if (!res.headersSent) {
			res.status(500).json({ message: "Server error while updating recommendation." });
		}
		// Consider calling next(error)
	}
};

/**
 * @desc    Get recommendations created by a specific user (JSON focused), respecting visibility
 * @route   GET /api/v2/recommendations/user/:userId
 * @access  Public (conditionally, based on trip visibility and user relationship)
 */
const getUserRecommendationsJson = async (req, res, next) => {
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
		const targetUserDetails = await User.findById(targetUserId).select("followers").lean();
		if (!targetUserDetails) {
			return res.status(404).json({ message: "Target user not found" });
		}

		let isOwner = false;
		let isFollower = false;

		if (requestingUser) {
			if (requestingUser._id.equals(targetUserId)) {
				isOwner = true;
			} else {
				isFollower = targetUserDetails.followers.some((followerId) => followerId.equals(requestingUser._id));
			}
		}

		const filterConditions = {
			$expr: {
				$or: [
					// Case 1: Recommendation is associated with a public trip
					{ $eq: ["$tripInfo.defaultTripVisibility", "public"] },
					// Case 2: Recommendation is associated with a followers_only trip
					{
						$and: [{ $eq: ["$tripInfo.defaultTripVisibility", "followers_only"] }, { $or: [isOwner, isFollower] }],
					},
					// Case 3: Recommendation is associated with a private trip
					{
						$and: [{ $eq: ["$tripInfo.defaultTripVisibility", "private"] }, isOwner],
					},
					// Case 4: Recommendation has NO associated trip (visible only to its owner)
					{
						$and: [
							{ $eq: ["$associatedTrip", null] }, // Check if the field itself is null
							isOwner,
						],
					},
				],
			},
		};

		const basePipeline = [
			{ $match: { user: targetUserId } }, // Match recommendations by the target user
			{
				$lookup: {
					// Join with trips collection
					from: "trips",
					localField: "associatedTrip",
					foreignField: "_id",
					pipeline: [
						// Select only necessary fields from the trip
						{ $project: { defaultTripVisibility: 1 } },
					],
					as: "tripInfo",
				},
			},
			{
				$unwind: {
					// Unwind the tripInfo array
					path: "$tripInfo",
					preserveNullAndEmptyArrays: true, // Keep recommendations even if no associated trip
				},
			},
			{ $match: filterConditions }, // Apply the dynamic visibility filter
		];

		const recommendationsQueryPipeline = [
			...basePipeline,
			{ $sort: { createdAt: -1 } },
			{ $skip: skip },
			{ $limit: limit },
			{
				// Re-populate user details for the recommendation itself (creator)
				$lookup: {
					from: "users",
					localField: "user",
					foreignField: "_id",
					pipeline: [{ $project: { username: 1, profilePictureUrl: 1 } }],
					as: "userDetails",
				},
			},
			{
				$unwind: {
					path: "$userDetails",
					preserveNullAndEmptyArrays: true,
				},
			},
			{
				$project: {
					// Define the shape of the output documents
					_id: 1,
					name: 1,
					description: 1,
					rating: 1,
					primaryCategory: 1,
					user: {
						// Populate user details for the recommendation's creator
						_id: "$userDetails._id",
						username: "$userDetails.username",
						profilePictureUrl: "$userDetails.profilePictureUrl",
					},
					createdAt: 1,
					location: 1,
					attributeTags: 1,
					photos: 1,
					associatedTrip: 1,
					// tripVisibility: "$tripInfo.defaultTripVisibility" // Optional: for debugging
				},
			},
		];

		const totalCountPipeline = [...basePipeline, { $count: "totalCount" }];

		const [recommendations, totalCountResult] = await Promise.all([
			Recommendation.aggregate(recommendationsQueryPipeline),
			Recommendation.aggregate(totalCountPipeline),
		]);

		const totalCount = totalCountResult.length > 0 ? totalCountResult[0].totalCount : 0;

		res.status(200).json({
			data: recommendations,
			page,
			limit,
			totalPages: Math.ceil(totalCount / limit),
			totalCount,
		});
	} catch (error) {
		console.error(`Error fetching JSON recommendations for user ${targetUserIdString}:`, error);
		next(error);
	}
};

module.exports = {
	processPendingRecommendations,
	createSingleRecommendationJson,
	updateRecommendationJson,
	getUserRecommendationsJson, // Add new export
};

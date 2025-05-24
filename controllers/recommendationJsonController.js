const Recommendation = require("../models/Recommendation");
const mongoose = require("mongoose");

/**
 * @desc    Processes an array of pending recommendation data from a JSON payload
 *          and creates recommendation documents.
 * @param   {Array<Object>} pendingRecommendations - Array of recommendation data objects.
 * @param   {mongoose.Types.ObjectId} userId - The ID of the user creating the recommendations.
 * @param   {mongoose.Types.ObjectId} tripId - The ID of the trip these recommendations are associated with.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of outcomes for each recommendation.
 */
const processPendingRecommendations = async (
	pendingRecommendations,
	userId,
	tripId
) => {
	if (
		!pendingRecommendations ||
		!Array.isArray(pendingRecommendations) ||
		pendingRecommendations.length === 0
	) {
		return []; // No recommendations to process
	}

	const createdRecommendationsInfo = [];
	const allowedCategories =
		Recommendation.schema.path("primaryCategory").enumValues;

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

			if (
				isNaN(lat) ||
				isNaN(lon) ||
				lat < -90 ||
				lat > 90 ||
				lon < -180 ||
				lon > 180
			) {
				console.warn(
					`Skipping recommendation (tripId: ${tripId}, name: ${recData.name}) due to invalid coordinates:`,
					{ lat, lon }
				);
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
				attributeTags: Array.isArray(recData.attributeTags)
					? recData.attributeTags
					: [],
				location: {
					type: "Point",
					coordinates: [lon, lat], // [longitude, latitude]
				},
				photos: photoIds, // Use validated photo IDs
				associatedTrip: tripId,
				// associatedPoiId: recData.associatedPoiId && mongoose.Types.ObjectId.isValid(recData.associatedPoiId) ? recData.associatedPoiId : null,
				source: recData.source || "TRACKING", // More specific source
			};

			const savedRecommendation = await Recommendation.create(
				recommendationToSave
			);
			createdRecommendationsInfo.push({
				id: savedRecommendation._id,
				name: savedRecommendation.name,
				status: "created",
			});
			console.log(
				`Successfully created recommendation '${savedRecommendation.name}' for trip ${tripId} via JSON.`
			);
		} catch (recError) {
			console.error(
				`Error saving a pending recommendation ('${
					recData.name || "N/A"
				}') for trip ${tripId} from JSON:`,
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

module.exports = {
	processPendingRecommendations,
};

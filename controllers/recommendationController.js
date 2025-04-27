// filepath: /home/mkmilan/Documents/my/travel-2/server/controllers/recommendationController.js
const Recommendation = require("../models/Recommendation");
const storageService = require("../services/storageService"); // For photo uploads
const mongoose = require("mongoose");
const path = require("path");
const sharp = require("sharp"); // For image processing

/**
 * @desc    Create a new recommendation
 * @route   POST /api/recommendations
 * @access  Private
 */
const createRecommendation = async (req, res, next) => {
	const {
		name,
		description,
		rating,
		primaryCategory,
		attributeTags, // Expecting an array of strings
		latitude, // Expecting coordinates directly for now
		longitude, // Expecting coordinates directly for now
		// locationSearchTerm, // We'll add geocoding based on this later
	} = req.body;
	const userId = req.user._id;

	// --- Basic Validation ---
	if (
		!name ||
		!description ||
		!rating ||
		!primaryCategory ||
		latitude === undefined ||
		longitude === undefined
	) {
		res.status(400);
		return next(
			new Error(
				"Missing required fields: name, description, rating, primaryCategory, latitude, longitude"
			)
		);
	}

	// Validate coordinates
	const lat = parseFloat(latitude);
	const lon = parseFloat(longitude);
	if (
		isNaN(lat) ||
		isNaN(lon) ||
		lat < -90 ||
		lat > 90 ||
		lon < -180 ||
		lon > 180
	) {
		res.status(400);
		return next(new Error("Invalid latitude or longitude provided."));
	}

	// Validate rating (basic check, schema handles min/max)
	if (isNaN(parseFloat(rating))) {
		res.status(400);
		return next(new Error("Invalid rating value."));
	}

	// TODO: Add validation for primaryCategory and attributeTags against enum values later if needed

	// --- Photo Upload Handling (Similar to tripController) ---
	let uploadedPhotoIds = [];
	if (req.files && req.files.length > 0) {
		console.log(`Processing ${req.files.length} photos for recommendation...`);
		try {
			const uploadPromises = req.files.map(async (file) => {
				// --- Sharp Processing ---
				let processedBufferData;
				let processedMetadata;
				const TARGET_SIZE_KB = 512; // Smaller target for recommendation photos?
				const MAX_DIMENSION = 1280;
				try {
					let bufferObj;
					const imageProcessor = sharp(file.buffer, { failOn: "truncated" })
						.rotate()
						.resize({
							width: MAX_DIMENSION,
							height: MAX_DIMENSION,
							fit: sharp.fit.inside,
							withoutEnlargement: true,
						});

					let currentQuality = 75; // Start with decent quality
					bufferObj = await imageProcessor
						.webp({ quality: currentQuality, effort: 4 })
						.toBuffer({ resolveWithObject: true });

					// Reduce quality if too large
					if (bufferObj.data.length > TARGET_SIZE_KB * 1024) {
						console.log(`Rec photo > ${TARGET_SIZE_KB}KB, reducing quality...`);
						currentQuality = 60;
						bufferObj = await imageProcessor
							.webp({ quality: currentQuality, effort: 4 })
							.toBuffer({ resolveWithObject: true });
					}
					processedBufferData = bufferObj.data;
					processedMetadata = bufferObj.info;
				} catch (sharpError) {
					console.error(
						`Sharp processing failed for ${file.originalname}:`,
						sharpError
					);
					throw new Error(`Image processing failed: ${sharpError.message}`);
				}
				// --- End Sharp ---

				const originalNameBase = path.parse(file.originalname).name;
				const storageFilename = `rec_${userId}_${originalNameBase}_${Date.now()}.webp`;
				const metadata = {
					userId: userId.toString(),
					recommendationName: name, // Add context
					originalFilename: file.originalname,
					processedFilename: storageFilename,
					mimetype: "image/webp",
					size: processedMetadata.size,
					width: processedMetadata.width,
					height: processedMetadata.height,
				};

				console.log(`Uploading ${storageFilename} to GridFS...`);
				const fileId = await storageService.uploadFile(
					processedBufferData,
					storageFilename,
					"image/webp",
					metadata
				);
				return fileId.toString(); // Return as string
			});
			uploadedPhotoIds = await Promise.all(uploadPromises);
			console.log("Recommendation photos uploaded:", uploadedPhotoIds);
		} catch (uploadError) {
			// If any photo upload fails, stop and return error
			// Cleanup potentially already uploaded photos for this request? (More complex)
			console.error("Error during recommendation photo upload:", uploadError);
			return next(new Error(`Failed to upload photos: ${uploadError.message}`));
		}
	}
	// --- End Photo Handling ---

	try {
		// --- Create Recommendation Document ---
		const newRecommendation = new Recommendation({
			user: userId,
			name,
			description,
			rating: parseFloat(rating),
			primaryCategory,
			attributeTags: attributeTags || [], // Ensure it's an array
			location: {
				type: "Point",
				coordinates: [lon, lat], // Store as [longitude, latitude]
			},
			photos: uploadedPhotoIds,
			source: "MANUAL", // Explicitly set source
			// associatedTrip: null // Not linked to a trip if created manually
		});

		const savedRecommendation = await newRecommendation.save();
		console.log("Recommendation saved successfully:", savedRecommendation._id);

		// Populate user details before sending response
		const populatedRec = await Recommendation.findById(savedRecommendation._id)
			.populate("user", "username profilePictureUrl") // Populate user details
			.lean();

		res.status(201).json(populatedRec);
	} catch (error) {
		console.error("Error saving recommendation:", error);
		// Handle potential validation errors from Mongoose
		if (error.name === "ValidationError") {
			const messages = Object.values(error.errors).map((val) => val.message);
			res.status(400);
			return next(new Error(messages.join(", ")));
		}
		// Cleanup uploaded photos if DB save fails? (More complex)
		next(error); // Pass to global error handler
	}
};

// --- Placeholder for Get Recommendations (Search) ---
const getRecommendations = async (req, res, next) => {
	// TODO: Implement search/filtering logic based on query params
	// (nearby, category, tags, rating, text search)
	try {
		// For now, just return all recommendations, sorted newest first
		const recommendations = await Recommendation.find({})
			.populate("user", "username profilePictureUrl") // Populate user details
			.sort({ createdAt: -1 }) // Sort by creation date descending
			.limit(20) // Limit results for now
			.lean();

		res.status(200).json(recommendations);
	} catch (error) {
		console.error("Error fetching recommendations:", error);
		next(error);
	}
};

// --- Placeholder for Get Single Recommendation ---
const getRecommendationById = async (req, res, next) => {
	const { recommendationId } = req.params;
	if (!mongoose.Types.ObjectId.isValid(recommendationId)) {
		res.status(400);
		return next(new Error("Invalid Recommendation ID format"));
	}
	try {
		const recommendation = await Recommendation.findById(recommendationId)
			.populate("user", "username profilePictureUrl")
			.lean();
		if (!recommendation) {
			res.status(404);
			return next(new Error("Recommendation not found"));
		}
		res.status(200).json(recommendation);
	} catch (error) {
		console.error("Error fetching recommendation by ID:", error);
		next(error);
	}
};

// TODO: Add updateRecommendation and deleteRecommendation controllers

module.exports = {
	createRecommendation,
	getRecommendations,
	getRecommendationById,
	// updateRecommendation,
	// deleteRecommendation
};

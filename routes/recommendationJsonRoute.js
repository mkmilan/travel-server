// filepath: /home/mkmilan/Documents/my/travel-2/server/routes/recommendationJsonRoute.js
const express = require("express");
const { protect, protectOptional } = require("../middleware/authMiddleware");
const { uploadMultiplePhotos } = require("../config/multerConfig");

// Import only the JSON controller methods needed for these routes
const {
	createSingleRecommendationJson,
	updateRecommendationJson,
	getUserRecommendationsJson,
	uploadRecommendationPhotos,
	deleteRecommendationPhoto,
	deleteRecommendationJson,
	// Add getRecommendationJsonById, deleteRecommendationJson if you create them
} = require("../controllers/recommendationJsonController");
const { getRecommendationById } = require("../controllers/recommendationController"); // Assuming this can serve JSON

const router = express.Router();

// POST /api/recommendations/json - Create a new recommendation via JSON payload
router.post("/", protect, createSingleRecommendationJson); // Changed path to /

router.get("/:recommendationId", getRecommendationById); // This might need protectOptional or protect

router.get("/user/:userId", protectOptional, getUserRecommendationsJson);

router.put("/:recommendationId", protect, updateRecommendationJson); // Changed path to /:recommendationId
router.delete("/:recommendationId", protect, deleteRecommendationJson);

//  /api/v2/recommendations/:recommendationId/photos
router.post("/:recommendationId/photos", protect, uploadMultiplePhotos, uploadRecommendationPhotos);
router.delete("/:recommendationId/photos/:photoId", protect, deleteRecommendationPhoto);
module.exports = router;

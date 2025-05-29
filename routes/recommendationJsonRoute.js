// filepath: /home/mkmilan/Documents/my/travel-2/server/routes/recommendationJsonRoute.js
const express = require("express");
const { protect, protectOptional } = require("../middleware/authMiddleware");

// Import only the JSON controller methods needed for these routes
const {
	createSingleRecommendationJson,
	updateRecommendationJson,
	getUserRecommendationsJson,
	// Add getRecommendationJsonById, deleteRecommendationJson if you create them
} = require("../controllers/recommendationJsonController");
const { getRecommendationById } = require("../controllers/recommendationController"); // Assuming this can serve JSON

const router = express.Router();

// POST /api/recommendations/json - Create a new recommendation via JSON payload
router.post("/", protect, createSingleRecommendationJson); // Changed path to /

router.get("/:recommendationId", getRecommendationById); // This might need protectOptional or protect

router.get("/user/:userId", protectOptional, getUserRecommendationsJson);

router.put("/:recommendationId", protect, updateRecommendationJson); // Changed path to /:recommendationId

module.exports = router;

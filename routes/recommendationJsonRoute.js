// filepath: /home/mkmilan/Documents/my/travel-2/server/routes/recommendationJsonRoute.js
const express = require("express");
const { protect } = require("../middleware/authMiddleware");

// Import only the JSON controller methods needed for these routes
const {
	createSingleRecommendationJson,
	updateRecommendationJson,
	// Add getRecommendationJsonById, deleteRecommendationJson if you create them
} = require("../controllers/recommendationJsonController");
const {
	getRecommendationById,
} = require("../controllers/recommendationController"); // Assuming this can serve JSON

const router = express.Router();

// POST /api/recommendations/json - Create a new recommendation via JSON payload
router.post("/", protect, createSingleRecommendationJson); // Changed path to /

// GET /api/recommendations/json/:recommendationId - Get a single recommendation (assuming it can return JSON)
// If getRecommendationById from the standard controller is sufficient and returns JSON, it can be used.
// Otherwise, a specific getRecommendationJsonById might be needed in recommendationJsonController.js
router.get("/:recommendationId", getRecommendationById); // This might need protectOptional or protect

// PUT /api/recommendations/json/:recommendationId - Update a recommendation via JSON payload
router.put("/:recommendationId", protect, updateRecommendationJson); // Changed path to /:recommendationId

// TODO: Consider adding a specific DELETE route for JSON if behavior differs from the standard one.
// e.g., router.delete("/:recommendationId", protect, deleteRecommendationJson);

module.exports = router;

// Note: The original file had routes like router.post("/json", ...)
// I've changed them to router.post("/", ...) assuming this router is mounted at /api/recommendations/json
// If this router is mounted at /api/recommendations, then the /json path segment would be needed.
// Please clarify the base path for this router in server.js if my assumption is incorrect.
// For now, I'm assuming the base path will distinguish it as the JSON specific route.

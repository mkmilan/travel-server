// filepath: /home/mkmilan/Documents/my/travel-2/server/routes/recommendationRoutes.js
const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { uploadMultiplePhotos } = require("../config/multerConfig"); // Use same config as trips for now
const {
	createRecommendation,
	getRecommendations,
	getRecommendationById,
	// updateRecommendation,
	deleteRecommendation,
} = require("../controllers/recommendationController");

const router = express.Router();

// POST /api/recommendations - Create a new recommendation (requires login, handles photo uploads)
router.post(
	"/",
	protect, // Ensure user is logged in
	uploadMultiplePhotos, // Use multer middleware to handle 'photos' field (max 5)
	createRecommendation
);

// GET /api/recommendations - Get/Search recommendations
router.get("/", getRecommendations); // Public for now, add auth if needed

// GET /api/recommendations/:recommendationId - Get a single recommendation
router.get("/:recommendationId", getRecommendationById); // Public for now

// TODO: Add PUT /:recommendationId route for updates (protected, owner only)
// router.put('/:recommendationId', protect, updateRecommendation);

// TODO: Add DELETE /:recommendationId route for deletion (protected, owner only)
router.delete("/:recommendationId", protect, deleteRecommendation);

module.exports = router;

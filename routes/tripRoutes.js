// server/routes/tripRoutes.js
const express = require("express");
// Import deleteTrip
const { uploadMultiplePhotos } = require("../config/multerConfig");
const {
	createTrip,
	getTripById,
	getTripGpx,
	getMyTrips,
	updateTrip,
	deleteTrip,
	getFeedTrips,
	likeTrip,
	unlikeTrip,
	addCommentToTrip,
	getTripComments,
	uploadTripPhotos,
	deleteTripPhoto,
	getTripLikers,
	deleteCommentFromTrip,
} = require("../controllers/tripController");
const { protect } = require("../middleware/authMiddleware");
const {
	getRecommendationsForTrip,
} = require("../controllers/recommendationController");

const router = express.Router();

// --- Collection Routes ---
router.post("/", protect, createTrip);
router.get("/me", protect, getMyTrips);
router.get("/feed", protect, getFeedTrips);

// --- Specific Document Routes ---
router.get("/:tripId/gpx", getTripGpx);
router.put("/:tripId", protect, updateTrip);
router.delete("/:tripId", protect, deleteTrip);

router.post("/:tripId/photos", protect, uploadMultiplePhotos, uploadTripPhotos);
router.delete("/:tripId/photos/:photoId", protect, deleteTripPhoto);

router.post("/:tripId/comments", protect, addCommentToTrip);
router.get("/:tripId/comments", getTripComments);
router
	.route("/:tripId/comments/:commentId")
	.delete(protect, deleteCommentFromTrip);
router.post("/:tripId/like", protect, likeTrip);
router.delete("/:tripId/like", protect, unlikeTrip);
router.get("/:tripId/likers", getTripLikers);

router.route("/:tripId/recommendations").get(getRecommendationsForTrip);

// --- General Document Route ---
router.get("/:tripId", getTripById);

module.exports = router;

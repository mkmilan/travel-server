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
	addPoiToTrip,
	deleteCommentFromTrip,
} = require("../controllers/tripController");
const { protect, protectOptional } = require("../middleware/authMiddleware");
const {
	getRecommendationsForTrip,
} = require("../controllers/recommendationController");

const router = express.Router();

// --- Collection Routes ---
router.post("/", protect, createTrip);
router.get("/me", protect, getMyTrips);
router.get("/feed", protect, getFeedTrips);

// --- Specific Document Routes ---
const mediaAccess = require("../middleware/mediaAccess").defaultMediaAccess();
router.get("/:tripId/gpx", protectOptional, mediaAccess.tripGpx, getTripGpx);
router.put("/:tripId", protect, updateTrip);
router.delete("/:tripId", protect, deleteTrip);
router.post("/:tripId/pois", protect, addPoiToTrip);

router.post("/:tripId/photos", protect, uploadMultiplePhotos, uploadTripPhotos);
router.delete("/:tripId/photos/:photoId", protect, deleteTripPhoto);

router.post("/:tripId/comments", protect, mediaAccess.trip, addCommentToTrip);
router.get("/:tripId/comments", protectOptional, mediaAccess.trip, getTripComments);
router
	.route("/:tripId/comments/:commentId")
	.delete(protect, mediaAccess.trip, deleteCommentFromTrip);
router.post("/:tripId/like", protect, mediaAccess.trip, likeTrip);
router.delete("/:tripId/like", protect, mediaAccess.trip, unlikeTrip);
router.get("/:tripId/likers", protectOptional, mediaAccess.trip, getTripLikers);

router.route("/:tripId/recommendations").get(protectOptional, mediaAccess.trip, getRecommendationsForTrip);

// --- General Document Route ---
router.get("/:tripId", protect, getTripById);

module.exports = router;

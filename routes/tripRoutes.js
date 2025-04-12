// server/routes/tripRoutes.js
const express = require("express");
// Import deleteTrip
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
} = require("../controllers/tripController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// --- Collection Routes ---
router.post("/", protect, createTrip);
router.get("/me", protect, getMyTrips);
router.get("/feed", protect, getFeedTrips);

// --- Specific Document Routes ---
router.get("/:tripId/gpx", getTripGpx);
router.put("/:tripId", protect, updateTrip);
router.delete("/:tripId", protect, deleteTrip);

router.post("/:tripId/comments", protect, addCommentToTrip);
router.get("/:tripId/comments", getTripComments);
router.post("/:tripId/like", protect, likeTrip);
router.delete("/:tripId/like", protect, unlikeTrip);

// --- General Document Route ---
router.get("/:tripId", getTripById);

module.exports = router;

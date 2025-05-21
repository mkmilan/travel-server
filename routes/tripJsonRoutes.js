const express = require("express");
const router = express.Router();
const tripJsonController = require("../controllers/tripJsonController");
const { protect, protectOptional } = require("../middleware/authMiddleware");

// POST /api/v2/trips/json
router.post("/json", protect, tripJsonController.createTripJson);

router.get("/json/me", protect, tripJsonController.getMyJsonTrips);
router.get(
	"/json/:tripId",
	protectOptional,
	tripJsonController.getTripJsonById
);

module.exports = router;

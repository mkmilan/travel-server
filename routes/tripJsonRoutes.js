const express = require("express");
const router = express.Router();
const tripJsonController = require("../controllers/tripJsonController");
const { protect, protectOptional } = require("../middleware/authMiddleware");

// POST /api/v2/trips/json
router.post("/json", protect, tripJsonController.createTripJson);

router.get("/json/me", protect, tripJsonController.getMyJsonTrips);
router.get("/json/feed", protect, tripJsonController.getTripsFeedJson);
router.get("/json/:tripId", protectOptional, tripJsonController.getTripJsonById);
// GET /api/v2/trips/json/user/:userId - New route for specific user's JSON trips
router.get("/json/user/:userId", protectOptional, tripJsonController.getUserJsonTrips);

// PUT /api/v2/trips/json/:tripId
router.put("/json/:tripId", protect, tripJsonController.updateTripJson);

module.exports = router;

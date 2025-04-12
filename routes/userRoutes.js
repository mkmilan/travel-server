// server/routes/userRoutes.js
const express = require("express");
const {
	getUserProfileById,
	updateUserProfile,
	followUser,
	unfollowUser,
} = require("../controllers/userController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Public route to get any user's profile
// GET /api/users/:userId
router.get("/:userId", getUserProfileById);

// Private route for the logged-in user to update their own profile
// PUT /api/users/me
// Note: We use '/me' here to avoid conflict with '/:userId'.
// The actual user ID comes from the protect middleware (req.user._id)
router.put("/me", protect, updateUserProfile);

router.post("/:userId/follow", protect, followUser);
router.delete("/:userId/follow", protect, unfollowUser);

module.exports = router;

const express = require("express");
const {
	getUserProfileById,
	updateUserProfile,
	followUser,
	unfollowUser,
	searchUsers,
} = require("../controllers/userController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// --- Reorder these routes ---
// Specific route first
router.get("/search", searchUsers);

// General parameterized route after
// GET /api/users/:userId
router.get("/:userId", getUserProfileById);
// --- End reorder ---

// Private route for the logged-in user to update their own profile
// PUT /api/users/me
// Note: We use '/me' here to avoid conflict with '/:userId'.
// The actual user ID comes from the protect middleware (req.user._id)
router.put("/me", protect, updateUserProfile);

router.post("/:userId/follow", protect, followUser);
router.delete("/:userId/follow", protect, unfollowUser);

module.exports = router;

const express = require("express");
const {
	getUserProfileById,
	updateUserProfile,
	followUser,
	unfollowUser,
	searchUsers,
	getUserRecommendations,
	getUserPois,
	getUserFollowers,
	getUserFollowing,
	getUserPhotos,
	getUserSettings,
	updateUserSettings,
	getPublicProfileByUserId,
} = require("../controllers/userController");
const { protect, protectOptional } = require("../middleware/authMiddleware");
const { uploadSinglePhoto } = require("../config/multerConfig");

const router = express.Router();

router.get("/search", protect, searchUsers);
router.get("/settings", protect, getUserSettings);
router.put("/settings", protect, updateUserSettings);
router.get("/:userId", getUserProfileById);
// --- End reorder ---
//get other user profile by userId
router.get("/user/:userId", protectOptional, getPublicProfileByUserId);
// Note: We use '/me' here to avoid conflict with '/:userId'.
// The actual user ID comes from the protect middleware (req.user._id)
router.put("/me", protect, uploadSinglePhoto, updateUserProfile);

router.post("/:userId/follow", protect, followUser);
router.delete("/:userId/follow", protect, unfollowUser);
router.get("/:userId/recommendations", getUserRecommendations);
router.get("/:userId/pois", getUserPois);
router.get("/:userId/followers", getUserFollowers);
router.get("/:userId/following", getUserFollowing);
router.get("/:userId/photos", getUserPhotos);

module.exports = router;

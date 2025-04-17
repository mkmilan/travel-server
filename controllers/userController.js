// server/controllers/userController.js
const User = require("../models/User");
const mongoose = require("mongoose");

/**
 * @desc    Get user profile by ID
 * @route   GET /api/users/:userId
 * @access  Public
 */
const getUserProfileById = async (req, res, next) => {
	try {
		// Fetch user by ID passed in the route parameter
		// Exclude sensitive fields like password, email (unless needed publicly)
		// We also populate some follower/following counts for display
		const user = await User.findById(req.params.userId).select(
			"-password -email"
		); // Exclude password and email
		// .populate("followers", "username") // Optionally get usernames of followers
		// .populate("following", "username"); // Optionally get usernames of following

		if (!user) {
			res.status(404); // Not Found
			throw new Error("User not found");
		}

		// Optionally add counts if needed frequently
		const profileData = {
			_id: user._id,
			username: user.username,
			bio: user.bio,
			profilePictureUrl: user.profilePictureUrl,
			followersCount: user.followers.length,
			followingCount: user.following.length,
			followers: user.followers.map((id) => id.toString()),
			// followers: user.followers, // Optionally send full list if needed
			// following: user.following, // Optionally send full list if needed
			createdAt: user.createdAt,
			// Add any other public fields as needed (e.g., trip count later)
		};

		res.status(200).json(profileData);
	} catch (error) {
		// Handle potential CastError if userId format is invalid
		if (error.name === "CastError") {
			res.status(400); // Bad Request
			next(new Error(`Invalid user ID format: ${req.params.userId}`));
		} else {
			next(error); // Pass other errors to the global error handler
		}
	}
};

/**
 * @desc    Update current user's profile
 * @route   PUT /api/users/me
 * @access  Private
 */
const updateUserProfile = async (req, res, next) => {
	// req.user is attached by the 'protect' middleware
	const userId = req.user._id;
	const { bio, profilePictureUrl } = req.body; // Get fields to update from body

	try {
		// Find the user first
		const user = await User.findById(userId);

		if (!user) {
			res.status(404);
			throw new Error("User not found"); // Should not happen if protect middleware worked
		}

		// Update fields if they are provided in the request body
		user.bio = bio !== undefined ? bio : user.bio;
		user.profilePictureUrl =
			profilePictureUrl !== undefined
				? profilePictureUrl
				: user.profilePictureUrl;
		// Add other updatable fields here later (e.g., username, email - with care for uniqueness)

		const updatedUser = await user.save(); // Run validators and save

		// Respond with updated user data (excluding password)
		res.status(200).json({
			_id: updatedUser._id,
			username: updatedUser.username,
			email: updatedUser.email, // Keep email for the owner's view maybe
			bio: updatedUser.bio,
			profilePictureUrl: updatedUser.profilePictureUrl,
			following: updatedUser.following,
			followers: updatedUser.followers,
			token:
				req.headers.authorization?.split(" ")[1] ||
				generateToken(updatedUser._id), // Optionally re-issue token if needed, or just send back existing one from header
			createdAt: updatedUser.createdAt,
			updatedAt: updatedUser.updatedAt,
		});
	} catch (error) {
		// Handle validation errors (e.g., bio too long)
		if (error.name === "ValidationError") {
			const messages = Object.values(error.errors).map((val) => val.message);
			res.status(400); // Bad Request
			next(new Error(messages.join(", ")));
		} else {
			next(error);
		}
	}
};

/**
 * @desc    Search for users by username
 * @route   GET /api/users/search?q=query
 * @access  Public (or Private if needed)
 */
const searchUsers = async (req, res, next) => {
	const query = req.query.q; // Get search query from query parameter 'q'

	if (!query || typeof query !== "string" || query.trim().length === 0) {
		// Return empty array or bad request if query is missing/invalid
		return res.status(400).json({ message: "Search query is required." });
		// Alternatively: return res.json([]);
	}

	try {
		// Case-insensitive search for usernames containing the query string
		// Use a regular expression for partial matching
		const users = await User.find({
			username: { $regex: query, $options: "i" }, // 'i' for case-insensitive
		}).select("_id username profilePictureUrl"); // Select only needed fields

		if (!users || users.length === 0) {
			// Return empty array if no users found, not an error
			return res.status(200).json([]);
		}

		res.status(200).json(users);
	} catch (error) {
		console.error("Error searching users:", error);
		next(error); // Pass error to global handler
	}
};

/**
 * @desc    Follow a user
 * @route   POST /api/users/:userId/follow
 * @access  Private
 */
const followUser = async (req, res, next) => {
	const userIdToFollow = req.params.userId;
	const currentUserId = req.user._id; // From 'protect' middleware

	// Validate the ID format of the user to follow
	if (!mongoose.Types.ObjectId.isValid(userIdToFollow)) {
		res.status(400);
		return next(new Error(`Invalid user ID format: ${userIdToFollow}`));
	}

	// Prevent users from following themselves
	if (userIdToFollow === currentUserId.toString()) {
		res.status(400);
		return next(new Error("You cannot follow yourself."));
	}

	try {
		// Use Promise.all for parallel updates
		const [currentUser, userToFollow] = await Promise.all([
			User.findById(currentUserId),
			User.findById(userIdToFollow),
		]);

		// Check if users exist
		if (!currentUser) {
			res.status(404);
			return next(new Error("Current user not found.")); // Should be caught by protect middleware usually
		}
		if (!userToFollow) {
			res.status(404);
			return next(new Error("User to follow not found."));
		}

		// Check if already following
		// Use .toString() for reliable comparison of ObjectIds
		if (currentUser.following.some((id) => id.toString() === userIdToFollow)) {
			res.status(400);
			return next(new Error("You are already following this user."));
		}

		// --- Perform the follow ---
		// Add userToFollow to currentUser's following list
		currentUser.following.push(userIdToFollow);
		// Add currentUser to userToFollow's followers list
		userToFollow.followers.push(currentUserId);

		// --- Save both documents ---
		// Use Promise.all to save concurrently
		await Promise.all([currentUser.save(), userToFollow.save()]);

		console.log(`User ${currentUserId} followed user ${userIdToFollow}`);
		res
			.status(200)
			.json({ message: `Successfully followed ${userToFollow.username}` });
	} catch (error) {
		console.error(
			`Error following user ${userIdToFollow} by user ${currentUserId}:`,
			error
		);
		next(error);
	}
};

/**
 * @desc    Unfollow a user
 * @route   DELETE /api/users/:userId/follow
 * @access  Private
 */
const unfollowUser = async (req, res, next) => {
	const userIdToUnfollow = req.params.userId;
	const currentUserId = req.user._id;

	if (!mongoose.Types.ObjectId.isValid(userIdToUnfollow)) {
		res.status(400);
		return next(new Error(`Invalid user ID format: ${userIdToUnfollow}`));
	}

	// Prevent unfollowing self (though logically shouldn't happen)
	if (userIdToUnfollow === currentUserId.toString()) {
		res.status(400);
		return next(new Error("You cannot unfollow yourself."));
	}

	try {
		// Use Promise.all for parallel updates
		const [currentUser, userToUnfollow] = await Promise.all([
			User.findById(currentUserId),
			User.findById(userIdToUnfollow),
		]);

		// Check if users exist
		if (!currentUser) {
			res.status(404);
			return next(new Error("Current user not found."));
		}
		if (!userToUnfollow) {
			res.status(404);
			return next(new Error("User to unfollow not found."));
		}

		// --- Perform the unfollow ---
		// Remove userToUnfollow from currentUser's following list
		currentUser.following = currentUser.following.filter(
			(id) => id.toString() !== userIdToUnfollow
		);
		// Remove currentUser from userToUnfollow's followers list
		userToUnfollow.followers = userToUnfollow.followers.filter(
			(id) => id.toString() !== currentUserId.toString()
		);

		// --- Save both documents ---
		await Promise.all([currentUser.save(), userToUnfollow.save()]);

		console.log(`User ${currentUserId} unfollowed user ${userIdToUnfollow}`);
		res
			.status(200)
			.json({ message: `Successfully unfollowed ${userToUnfollow.username}` });
	} catch (error) {
		console.error(
			`Error unfollowing user ${userIdToUnfollow} by user ${currentUserId}:`,
			error
		);
		next(error);
	}
};

module.exports = {
	getUserProfileById,
	updateUserProfile,
	followUser,
	unfollowUser,
	searchUsers,
};

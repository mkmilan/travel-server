// server/controllers/userController.js
const User = require("../models/User");
const mongoose = require("mongoose");
const storageService = require("../services/storageService");
const generateToken = require("../utils/generateToken");
const sharp = require("sharp");
const path = require("path");

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
		// console.log("getUserProfileById user", user);

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
 * @desc    Update current user's profile (including profile picture)
 * @route   PUT /api/users/me
 * @access  Private
 */
const updateUserProfile = async (req, res, next) => {
	const userId = req.user._id;
	const { bio } = req.body;
	const file = req.file; // File from uploadSinglePhoto middleware

	try {
		const user = await User.findById(userId);
		if (!user) {
			res.status(404);
			throw new Error("User not found");
		}

		// Update bio if provided
		user.bio = bio !== undefined ? bio.trim() : user.bio;

		// --- Handle Profile Picture Upload ---
		if (file) {
			console.log(
				`Processing profile picture in memory: ${file.originalname}, Size: ${file.size}`
			);

			// --- Sharp Processing Pipeline (similar to uploadTripPhotos) ---
			let processedBufferData;
			let processedMetadata;
			const TARGET_SIZE_KB = 750; // Target 1MB for profile pics
			const MAX_DIMENSION = 1080;
			// let quality = 80; // Initial quality

			try {
				const imageProcessor = sharp(file.buffer, { failOn: "truncated" })
					.rotate() // Auto-rotate based on EXIF
					.resize({
						width: MAX_DIMENSION,
						height: MAX_DIMENSION,
						fit: sharp.fit.inside, // Maintain aspect ratio within bounds
						withoutEnlargement: true, // Don't upscale small images
					});

				// Try converting to WebP with reasonably high quality first
				let currentQuality = 85;
				let bufferObj = await imageProcessor
					.webp({ quality: currentQuality, effort: 4 })
					.toBuffer({ resolveWithObject: true });

				// If it's still too large, reduce quality
				if (bufferObj.data.length > TARGET_SIZE_KB * 1024) {
					console.log(
						`Profile pic > ${TARGET_SIZE_KB}KB (${(
							bufferObj.data.length / 1024
						).toFixed(1)} KB), reducing quality...`
					);
					currentQuality = 70; // Lower quality setting
					bufferObj = await imageProcessor
						.webp({ quality: currentQuality, effort: 4 })
						.toBuffer({ resolveWithObject: true });
				}

				processedBufferData = bufferObj.data;
				processedMetadata = bufferObj.info;

				console.log(
					`Sharp processing complete for profile picture ${
						file.originalname
					}. New size: ${(processedMetadata.size / 1024).toFixed(
						1
					)} KB, quality: ${currentQuality}`
				);
			} catch (sharpError) {
				console.error(
					`Sharp processing failed for profile picture ${file.originalname}:`,
					sharpError
				);
				throw new Error(
					`Image processing failed for profile picture: ${sharpError.message}`
				);
			}
			// --- End Sharp Processing ---

			// --- Delete Old Photo (if exists) ---
			if (
				user.profilePictureUrl
				//  &&
				// user.profilePictureUrl.startsWith("/photos/")
			) {
				const oldFileId = user.profilePictureUrl.split("/").pop();
				if (oldFileId && mongoose.Types.ObjectId.isValid(oldFileId)) {
					try {
						console.log(
							`Attempting to delete old profile picture file: ${oldFileId}`
						);
						await storageService.deleteFile(oldFileId);
						console.log(`Deleted old profile picture file: ${oldFileId}`);
					} catch (deleteError) {
						console.warn(
							`Failed to delete old profile picture file ${oldFileId}, continuing...`,
							deleteError
						);
						// Don't block update if old file deletion fails, just log it
					}
				}
			}

			// --- Upload Processed Photo to Storage ---
			// Define filename for storage (use user ID + timestamp + .webp)
			const originalNameBase = path.parse(file.originalname).name; // Get base name without extension
			const storageFilename = `profile_${userId}_${originalNameBase}_${Date.now()}.webp`;

			const metadata = {
				userId: userId.toString(),
				originalFilename: file.originalname,
				processedFilename: storageFilename,
				mimetype: "image/webp",
				size: processedMetadata.size,
				width: processedMetadata.width,
				height: processedMetadata.height,
			};

			console.log(
				`Uploading processed profile picture ${storageFilename} to GridFS...`
			);
			const fileId = await storageService.uploadFile(
				processedBufferData, // Pass the processed buffer
				storageFilename,
				"image/webp", // Pass the correct content type
				metadata // Pass the constructed metadata
			);
			console.log(
				`Uploaded processed profile picture ${storageFilename} with ID: ${fileId}`
			);

			// Update user's profilePictureUrl with the relative path
			user.profilePictureUrl = `${fileId}`;
			console.log("Updated user profilePictureUrl:", user.profilePictureUrl);
		} // End if (file)

		// Save the updated user document
		const updatedUser = await user.save();
		console.log(
			"Updated user profile profilePicture:",
			updatedUser.profilePictureUrl
		);

		// Respond with updated user data
		res.status(200).json({
			_id: updatedUser._id,
			username: updatedUser.username,
			email: updatedUser.email,
			bio: updatedUser.bio,
			profilePictureUrl: updatedUser.profilePictureUrl,
			following: updatedUser.following,
			followers: updatedUser.followers,
			token:
				req.headers.authorization?.split(" ")[1] ||
				generateToken(updatedUser._id),
			createdAt: updatedUser.createdAt,
			updatedAt: updatedUser.updatedAt,
		});
	} catch (error) {
		// Handle validation errors or other errors
		if (error.name === "ValidationError") {
			const messages = Object.values(error.errors).map((val) => val.message);
			res.status(400);
			next(new Error(messages.join(", ")));
		} else {
			console.error(`Error updating profile for user ${userId}:`, error);
			next(error); // Pass other errors to the global handler
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

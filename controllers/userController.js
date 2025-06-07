// server/controllers/userController.js
const User = require("../models/User");
const Trip = require("../models/Trip");
const Follow = require("../models/Follow");
const Recommendation = require("../models/Recommendation");
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
	const userId = req.params.userId;

	// Validate ID format first
	if (!mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400);
		return next(new Error(`Invalid user ID format: ${userId}`));
	}

	try {
		// Fetch user and perform aggregations/counts in parallel
		const [user, tripStats, recommendationCount, poiCountResult] = await Promise.all([
			User.findById(userId).select("-password -email"), // Exclude sensitive fields
			Trip.aggregate([
				// Aggregate total distance and count trips for the user
				{ $match: { user: new mongoose.Types.ObjectId(userId) } },
				{
					$group: {
						_id: null, // Group all trips for the user
						totalDistance: { $sum: "$distanceMeters" },
						totalTrips: { $sum: 1 },
					},
				},
			]),
			Recommendation.countDocuments({ user: userId }),

			Trip.aggregate([
				// Aggregate total POIs for the user
				{ $match: { user: new mongoose.Types.ObjectId(userId) } },
				{
					$project: {
						poiCount: { $size: { $ifNull: ["$pointsOfInterest", []] } },
					},
				},
				{ $group: { _id: null, totalPois: { $sum: "$poiCount" } } },
			]),
		]);

		if (!user) {
			res.status(404); // Not Found
			throw new Error("User not found");
		}

		// Extract results from aggregations (handle cases where user has no trips/pois)
		const totalDistance = tripStats[0]?.totalDistance || 0;
		const totalTrips = tripStats[0]?.totalTrips || 0;
		const totalPois = poiCountResult[0]?.totalPois || 0;

		// Construct the profile data object
		const profileData = {
			_id: user._id,
			username: user.username,
			bio: user.bio,
			city: user.city,
			country: user.country,
			profilePictureUrl: user.profilePictureUrl,
			followersCount: user.followers.length, // Existing count
			followingCount: user.following.length, // Existing count
			settings: user.settings,
			createdAt: user.createdAt,
			totalDistance: Math.round(totalDistance), // Round distance to nearest meter
			totalTrips: totalTrips,
			totalRecommendations: recommendationCount,
			totalPois: totalPois,
		};

		res.status(200).json(profileData);
	} catch (error) {
		// Specific CastError handling moved to validation check above
		console.error(`Error fetching profile for user ${userId}:`, error);
		next(error); // Pass other errors to the global error handler
	}
};

const getPublicProfileByUserId = async (req, res, next) => {
	const targetUserIdString = req.params.userId;
	const requestingUser = req.user; // Available if authenticated, due to protectOptional

	// Validate ID format first
	if (!mongoose.Types.ObjectId.isValid(targetUserIdString)) {
		res.status(400);
		return next(new Error(`Invalid user ID format: ${targetUserIdString}`));
	}
	const targetUserId = new mongoose.Types.ObjectId(targetUserIdString);

	try {
		// Fetch user and perform aggregations/counts in parallel
		const [user, tripStats, recommendationCount, poiCountResult] = await Promise.all([
			User.findById(targetUserId).select(
				"-password -email -settings -emailVerificationToken -emailVerificationExpires -passwordResetToken -passwordResetExpires"
			), // Exclude sensitive fields
			Trip.aggregate([
				{ $match: { user: targetUserId } },
				{
					$group: {
						_id: null,
						totalDistance: { $sum: "$distanceMeters" },
						totalTrips: { $sum: 1 },
					},
				},
			]),
			Recommendation.countDocuments({ user: targetUserId }),
			Trip.aggregate([
				{ $match: { user: targetUserId } },
				{ $project: { poiCount: { $size: { $ifNull: ["$pointsOfInterest", []] } } } },
				{ $group: { _id: null, totalPois: { $sum: "$poiCount" } } },
			]),
		]);

		if (!user) {
			res.status(404);
			return next(new Error("User not found"));
		}

		const totalDistance = tripStats[0]?.totalDistance || 0;
		const totalTrips = tripStats[0]?.totalTrips || 0;
		const totalPois = poiCountResult[0]?.totalPois || 0;

		// Construct the public profile data object
		const profileData = {
			_id: user._id,
			username: user.username,
			bio: user.bio,
			profilePictureUrl: user.profilePictureUrl,
			followersCount: user.followers?.length || 0, // Ensure followers array exists
			followingCount: user.following?.length || 0, // Ensure following array exists
			createdAt: user.createdAt,
			totalDistance: Math.round(totalDistance),
			totalTrips: totalTrips,
			totalRecommendations: recommendationCount,
			totalPois: totalPois,
			isFollowing: false, // Default to false
		};

		// Determine 'isFollowing' status if a user is authenticated
		if (requestingUser && user.followers) {
			// Check if the authenticated user's ID is in the target user's followers list
			profileData.isFollowing = user.followers.some((followerId) => followerId.equals(requestingUser._id));
		}

		// Determine if the requesting user is the profile owner
		// This can be useful for the client to know if it's viewing its own profile
		if (requestingUser && requestingUser._id.equals(targetUserId)) {
			profileData.isOwnProfile = true;
		} else {
			profileData.isOwnProfile = false;
		}

		res.status(200).json(profileData);
	} catch (error) {
		console.error(`Error fetching profile for user ${targetUserIdString}:`, error);
		next(error);
	}
};

/**
 * @desc    Update current user's profile (including profile picture)
 * @route   PUT /api/users/me
 * @access  Private
 */
const updateUserProfile = async (req, res, next) => {
	const userId = req.user._id;
	const { username, bio, city, country } = req.body;
	const file = req.file; // File from uploadSinglePhoto middleware

	try {
		const user = await User.findById(userId);
		if (!user) {
			res.status(404);
			throw new Error("User not found");
		}

		if (username !== undefined && username.trim() !== "" && user.username !== username.trim()) {
			user.username = username.trim();
		}
		// Update bio if provided
		user.bio = bio !== undefined ? bio.trim() : user.bio;
		// Update city and country if provided
		if (city !== undefined) user.city = city;
		if (country !== undefined) user.country = country;

		// --- Handle Profile Picture Upload ---
		if (file) {
			console.log(`Processing profile picture in memory: ${file.originalname}, Size: ${file.size}`);

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
						`Profile pic > ${TARGET_SIZE_KB}KB (${(bufferObj.data.length / 1024).toFixed(1)} KB), reducing quality...`
					);
					currentQuality = 70; // Lower quality setting
					bufferObj = await imageProcessor
						.webp({ quality: currentQuality, effort: 4 })
						.toBuffer({ resolveWithObject: true });
				}

				processedBufferData = bufferObj.data;
				processedMetadata = bufferObj.info;

				console.log(
					`Sharp processing complete for profile picture ${file.originalname}. New size: ${(
						processedMetadata.size / 1024
					).toFixed(1)} KB, quality: ${currentQuality}`
				);
			} catch (sharpError) {
				console.error(`Sharp processing failed for profile picture ${file.originalname}:`, sharpError);
				throw new Error(`Image processing failed for profile picture: ${sharpError.message}`);
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
						console.log(`Attempting to delete old profile picture file: ${oldFileId}`);
						await storageService.deleteFile(oldFileId);
						console.log(`Deleted old profile picture file: ${oldFileId}`);
					} catch (deleteError) {
						console.warn(`Failed to delete old profile picture file ${oldFileId}, continuing...`, deleteError);
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

			console.log(`Uploading processed profile picture ${storageFilename} to GridFS...`);
			const fileId = await storageService.uploadFile(
				processedBufferData, // Pass the processed buffer
				storageFilename,
				"image/webp", // Pass the correct content type
				metadata // Pass the constructed metadata
			);
			console.log(`Uploaded processed profile picture ${storageFilename} with ID: ${fileId}`);

			// Update user's profilePictureUrl with the relative path
			user.profilePictureUrl = `${fileId}`;
			console.log("Updated user profilePictureUrl:", user.profilePictureUrl);
		} // End if (file)

		// Save the updated user document
		const updatedUser = await user.save();
		console.log("Updated user profile profilePicture:", updatedUser.profilePictureUrl);

		// Respond with updated user data
		res.status(200).json({
			_id: updatedUser._id,
			username: updatedUser.username,
			email: updatedUser.email,
			bio: updatedUser.bio,
			city: updatedUser.city,
			country: updatedUser.country,
			profilePictureUrl: updatedUser.profilePictureUrl,
			following: updatedUser.following,
			followers: updatedUser.followers,
			token: req.headers.authorization?.split(" ")[1] || generateToken(updatedUser._id),
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
		res.status(200).json({ message: `Successfully followed ${userToFollow.username}` });
	} catch (error) {
		console.error(`Error following user ${userIdToFollow} by user ${currentUserId}:`, error);
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
		currentUser.following = currentUser.following.filter((id) => id.toString() !== userIdToUnfollow);
		// Remove currentUser from userToUnfollow's followers list
		userToUnfollow.followers = userToUnfollow.followers.filter((id) => id.toString() !== currentUserId.toString());

		// --- Save both documents ---
		await Promise.all([currentUser.save(), userToUnfollow.save()]);

		console.log(`User ${currentUserId} unfollowed user ${userIdToUnfollow}`);
		res.status(200).json({ message: `Successfully unfollowed ${userToUnfollow.username}` });
	} catch (error) {
		console.error(`Error unfollowing user ${userIdToUnfollow} by user ${currentUserId}:`, error);
		next(error);
	}
};

/**
 * @desc    Get recommendations created by a specific user
 * @route   GET /api/users/:userId/recommendations
 * @access  Public
 */
const getUserRecommendations = async (req, res, next) => {
	const userId = req.params.userId;
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 10; // Default limit 10 per page
	const skip = (page - 1) * limit;

	if (!mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400);
		return next(new Error(`Invalid user ID format: ${userId}`));
	}

	try {
		const [recommendations, totalCount] = await Promise.all([
			Recommendation.find({ user: userId })
				.select("_id name description rating primaryCategory user createdAt location") // Select fields needed for list display
				.sort({ createdAt: -1 }) // Sort by newest first
				.skip(skip)
				.limit(limit),
			Recommendation.countDocuments({ user: userId }),
		]);

		res.status(200).json({
			data: recommendations,
			page,
			limit,
			totalPages: Math.ceil(totalCount / limit),
			totalCount,
		});
	} catch (error) {
		console.error(`Error fetching recommendations for user ${userId}:`, error);
		next(error);
	}
};

/**
 * @desc    Get POIs created by a specific user (aggregated from trips)
 * @route   GET /api/users/:userId/pois
 * @access  Public
 */
const getUserPois = async (req, res, next) => {
	const userId = req.params.userId;
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 10; // Default limit 10 per page
	const skip = (page - 1) * limit;

	if (!mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400);
		return next(new Error(`Invalid user ID format: ${userId}`));
	}

	try {
		// Aggregation pipeline to extract and paginate POIs
		const aggregationPipeline = [
			{ $match: { user: new mongoose.Types.ObjectId(userId) } }, // Match user's trips
			{ $unwind: "$pointsOfInterest" }, // Deconstruct the POI array
			{ $sort: { "pointsOfInterest.timestamp": -1 } }, // Sort POIs by timestamp (newest first)
			{
				$project: {
					// Reshape the output to focus on POI details
					_id: "$pointsOfInterest._id", // Use POI's _id if available, or generate one if needed
					name: "$pointsOfInterest.name",
					description: "$pointsOfInterest.description",
					location: "$pointsOfInterest.location",
					timestamp: "$pointsOfInterest.timestamp",
					tripId: "$_id", // Include the trip ID for context
					tripTitle: "$title", // Include trip title for context
				},
			},
			{
				$facet: {
					// Use $facet for pagination within aggregation
					metadata: [{ $count: "totalCount" }],
					data: [{ $skip: skip }, { $limit: limit }],
				},
			},
		];

		const results = await Trip.aggregate(aggregationPipeline);

		const pois = results[0].data;
		const totalCount = results[0].metadata[0]?.totalCount || 0;

		res.status(200).json({
			data: pois,
			page,
			limit,
			totalPages: Math.ceil(totalCount / limit),
			totalCount,
		});
	} catch (error) {
		console.error(`Error fetching POIs for user ${userId}:`, error);
		next(error);
	}
};
/**
 * @desc    Get list of users following a specific user
 * @route   GET /api/users/:userId/followers
 * @access  Public (or Private if auth needed for follow status)
 */
const getUserFollowers = async (req, res, next) => {
	const userId = req.params.userId;
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 15; // Adjust limit as needed
	const skip = (page - 1) * limit;

	if (!mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400);
		return next(new Error(`Invalid user ID format: ${userId}`));
	}

	try {
		// Find the target user and populate their followers list with pagination
		const user = await User.findById(userId)
			.select("followers") // Only select the followers field initially
			.populate({
				path: "followers", // Populate the followers array
				select: "_id username profilePictureUrl followers", // Select needed fields for each follower (incl. *their* followers for button state)
				options: {
					sort: { username: 1 }, // Sort followers alphabetically
					skip: skip,
					limit: limit,
				},
			});

		if (!user) {
			res.status(404);
			throw new Error("User not found");
		}

		// Get total count separately for pagination metadata
		const totalCount = await User.countDocuments({
			_id: { $in: user.followers },
		}); // This might be slightly off if populate fails, better to count on the target user's followers array length before populating if possible, but that's complex. Let's stick to populating first.
		// A more accurate count requires fetching the user without pagination first.
		const targetUser = await User.findById(userId).select("followers");
		const accurateTotalCount = targetUser ? targetUser.followers.length : 0;

		res.status(200).json({
			data: user.followers, // The populated array (limited by pagination)
			page,
			limit,
			totalPages: Math.ceil(accurateTotalCount / limit),
			totalCount: accurateTotalCount,
		});
	} catch (error) {
		console.error(`Error fetching followers for user ${userId}:`, error);
		next(error);
	}
};

/**
 * @desc    Get list of users a specific user is following
 * @route   GET /api/users/:userId/following
 * @access  Public (or Private if auth needed for follow status)
 */
const getUserFollowing = async (req, res, next) => {
	const userId = req.params.userId;
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 15;
	const skip = (page - 1) * limit;

	if (!mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400);
		return next(new Error(`Invalid user ID format: ${userId}`));
	}

	try {
		// Find the target user and populate their following list with pagination
		const user = await User.findById(userId)
			.select("following")
			.populate({
				path: "following",
				select: "_id username profilePictureUrl followers", // Select needed fields (incl. *their* followers for button state)
				options: {
					sort: { username: 1 },
					skip: skip,
					limit: limit,
				},
			});

		if (!user) {
			res.status(404);
			throw new Error("User not found");
		}

		// Get total count accurately
		const targetUser = await User.findById(userId).select("following");
		const accurateTotalCount = targetUser ? targetUser.following.length : 0;

		res.status(200).json({
			data: user.following, // The populated array
			page,
			limit,
			totalPages: Math.ceil(accurateTotalCount / limit),
			totalCount: accurateTotalCount,
		});
	} catch (error) {
		console.error(`Error fetching following list for user ${userId}:`, error);
		next(error);
	}
};

/**
 * @desc    Get photos associated with a specific user (from trips, recommendations, profile)
 * @route   GET /api/users/:userId/photos
 * @access  Public
 */
const getUserPhotos = async (req, res, next) => {
	const { userId } = req.params;
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 12; // e.g., 12 photos per page for a gallery
	const skip = (page - 1) * limit;

	if (!mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400);
		return next(new Error(`Invalid user ID format: ${userId}`));
	}

	try {
		const userObjectId = new mongoose.Types.ObjectId(userId);
		let allPhotoEntries = [];

		// 1. Get User's Profile Picture
		const userProfile = await User.findById(userObjectId).select("profilePictureUrl createdAt");
		if (userProfile && userProfile.profilePictureUrl) {
			// Assuming profilePictureUrl directly stores the GridFS ID
			if (mongoose.Types.ObjectId.isValid(userProfile.profilePictureUrl)) {
				allPhotoEntries.push({
					photoId: userProfile.profilePictureUrl,
					sourceDate: userProfile.createdAt,
					context: "Profile Picture",
					uniqueKey: `profile-${userProfile.profilePictureUrl}`,
					sourceType: "profile",
					sourceId: null,
				});
			}
		}

		// 2. Get Photos from User's Trips
		const trips = await Trip.find({ user: userObjectId }).select("photos createdAt title").sort({ createdAt: -1 });

		trips.forEach((trip) => {
			trip.photos.forEach((photoId) => {
				if (mongoose.Types.ObjectId.isValid(photoId)) {
					allPhotoEntries.push({
						photoId: photoId.toString(),
						sourceDate: trip.createdAt,
						context: `Trip: ${trip.title}`,
						uniqueKey: `trip-${trip._id}-${photoId.toString()}`,
						sourceType: "trip",
						sourceId: trip._id.toString(),
					});
				}
			});
		});

		// 3. Get Photos from User's Recommendations
		const recommendations = await Recommendation.find({ user: userObjectId })
			.select("photos createdAt name")
			.sort({ createdAt: -1 });

		recommendations.forEach((rec) => {
			rec.photos.forEach((photoId) => {
				if (mongoose.Types.ObjectId.isValid(photoId)) {
					allPhotoEntries.push({
						photoId: photoId.toString(),
						sourceDate: rec.createdAt,
						context: `Recommendation: ${rec.name}`,
						uniqueKey: `rec-${rec._id}-${photoId.toString()}`,
						sourceType: "recommendation",
						sourceId: rec._id.toString(),
					});
				}
			});
		});

		// 4. Sort all photos by sourceDate (newest first)
		allPhotoEntries.sort((a, b) => b.sourceDate - a.sourceDate);

		// 5. Create a unique list based on photoId, keeping the first encountered (most recent context due to sort)
		// This is important if a photo ID could theoretically appear in multiple contexts, though unlikely with current setup.
		const uniquePhotosMap = new Map();
		allPhotoEntries.forEach((entry) => {
			if (!uniquePhotosMap.has(entry.photoId)) {
				uniquePhotosMap.set(entry.photoId, entry);
			}
		});
		const uniqueSortedPhotoEntries = Array.from(uniquePhotosMap.values());

		// 6. Apply Pagination
		const totalCount = uniqueSortedPhotoEntries.length;
		const paginatedPhotos = uniqueSortedPhotoEntries.slice(skip, skip + limit);
		const totalPages = Math.ceil(totalCount / limit);

		res.status(200).json({
			data: paginatedPhotos.map((p) => ({
				photoId: p.photoId,
				context: p.context,
				sourceDate: p.sourceDate,
				sourceType: p.sourceType,
				sourceId: p.sourceId,
			})), // Send necessary info
			page,
			limit,
			totalPages,
			totalCount,
		});
	} catch (error) {
		console.error(`Error fetching photos for user ${userId}:`, error);
		next(error);
	}
};

/**
 * @desc    Get current user's settings
 * @route   GET /api/users/settings
 * @access  Private
 */
const getUserSettings = async (req, res, next) => {
	try {
		const user = await User.findById(req.user._id).select("settings");
		if (!user) {
			res.status(404);
			throw new Error("User not found");
		}
		res.json(user.settings);
	} catch (error) {
		next(error);
	}
};

/**
 * @desc    Update current user's settings
 * @route   PUT /api/users/settings
 * @access  Private
 */
const updateUserSettings = async (req, res, next) => {
	console.log("Updating user settings body:", req.body);
	console.log("Updating user settings user:", req?.user);

	try {
		const userId = req.user._id;
		const { defaultTripVisibility, defaultTravelMode, preferredUnits, themePreference, dateFormat, timeFormat } =
			req.body;

		const user = await User.findById(userId);

		if (!user) {
			res.status(404);
			throw new Error("User not found");
		}

		// Update only the fields that are provided in the request
		if (defaultTripVisibility !== undefined) user.settings.defaultTripVisibility = defaultTripVisibility;
		if (defaultTravelMode !== undefined) user.settings.defaultTravelMode = defaultTravelMode;
		if (preferredUnits !== undefined) user.settings.preferredUnits = preferredUnits;
		if (themePreference !== undefined) user.settings.themePreference = themePreference;
		if (dateFormat !== undefined) user.settings.dateFormat = dateFormat;
		if (timeFormat !== undefined) user.settings.timeFormat = timeFormat;

		const updatedUser = await user.save();

		res.json({
			message: "Settings updated successfully",
			settings: updatedUser.settings,
		});
	} catch (error) {
		// Handle potential validation errors from the model
		if (error.name === "ValidationError") {
			res.status(400);
		}
		next(error);
	}
};

/**
 * POST /api/users/:userId/follow
 */
const followUserV2 = async (req, res, next) => {
	const followerId = req.user._id;
	const followeeId = req.params.userId;

	if (followerId.equals(followeeId)) {
		return res.status(400).json({ message: "You cannot follow yourself" });
	}

	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		// Create the edge – will throw on duplicate because of the unique index
		await Follow.create([{ follower: followerId, followee: followeeId }], { session });

		// Bump cached counters
		await Promise.all([
			User.updateOne({ _id: followerId }, { $inc: { followingCount: 1 } }, { session }),
			User.updateOne({ _id: followeeId }, { $inc: { followersCount: 1 } }, { session }),
		]);

		await session.commitTransaction();
		res.status(200).json({ message: "Followed" });
	} catch (err) {
		await session.abortTransaction();
		if (err.code === 11000) return res.status(400).json({ message: "Already following" });
		next(err);
	} finally {
		session.endSession();
	}
};

/**
 * DELETE /api/users/:userId/follow
 */
const unfollowUserV2 = async (req, res, next) => {
	const followerId = req.user._id;
	const followeeId = req.params.userId;

	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const deleted = await Follow.findOneAndDelete({ follower: followerId, followee: followeeId }, { session });
		if (!deleted) {
			await session.abortTransaction();
			return res.status(404).json({ message: "Not following" });
		}

		await Promise.all([
			User.updateOne({ _id: followerId }, { $inc: { followingCount: -1 } }, { session }),
			User.updateOne({ _id: followeeId }, { $inc: { followersCount: -1 } }, { session }),
		]);

		await session.commitTransaction();
		res.status(200).json({ message: "Unfollowed" });
	} catch (err) {
		await session.abortTransaction();
		next(err);
	} finally {
		session.endSession();
	}
};

/**
 * GET /api/users/:userId/followers
 */
const getUserFollowersV2 = async (req, res, next) => {
	const { userId } = req.params;
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 15;
	const skip = (page - 1) * limit;

	const pipeline = [
		{ $match: { followee: new mongoose.Types.ObjectId(userId) } },
		{
			$lookup: {
				from: "users",
				localField: "follower",
				foreignField: "_id",
				as: "user",
			},
		},
		{ $unwind: "$user" },
		{ $replaceRoot: { newRoot: "$user" } },
		{ $sort: { username: 1 } },
		{ $skip: skip },
		{ $limit: limit },
	];

	const [items, total] = await Promise.all([Follow.aggregate(pipeline), Follow.countDocuments({ followee: userId })]);

	res.json({ data: items, total });
};

/**
 * GET /api/users/:userId/following
 *   – the same as above but swap match field to `follower: userId`
 */
const getUserFollowingV2 = async (req, res, next) => {
	const { userId } = req.params;
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 15;
	const skip = (page - 1) * limit;

	const pipeline = [
		{ $match: { follower: new mongoose.Types.ObjectId(userId) } },
		{
			$lookup: {
				from: "users",
				localField: "followee",
				foreignField: "_id",
				as: "user",
			},
		},
		{ $unwind: "$user" },
		{ $replaceRoot: { newRoot: "$user" } },
		{ $sort: { username: 1 } },
		{ $skip: skip },
		{ $limit: limit },
	];

	const [items, total] = await Promise.all([Follow.aggregate(pipeline), Follow.countDocuments({ follower: userId })]);

	res.json({ data: items, total });
};

module.exports = {
	getUserProfileById,
	getPublicProfileByUserId,
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
	followUserV2,
	unfollowUserV2,
	getUserFollowersV2,
	getUserFollowingV2,
};

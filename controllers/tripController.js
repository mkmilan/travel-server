// server/controllers/tripController.js
const gpxParse = require("gpx-parse");
const turf = require("@turf/turf"); // For distance calculation and potentially simplification
const Trip = require("../models/Trip");
const User = require("../models/User");
const Recommendation = require("../models/Recommendation");
const storageService = require("../services/storageService");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
/**
 * @desc    Create a new trip
 * @route   POST /api/trips
 * @access  Private
 */
const createTrip = async (req, res, next) => {
	// Destructure data from request body
	// Expecting: title, description, startLocationName, endLocationName, gpxString
	const {
		title,
		description,
		startLocationName,
		endLocationName,
		gpxString,
		defaultTripVisibility,
		defaultTravelMode,
	} = req.body;
	const userId = req.user._id; // From 'protect' middleware
	const userSettings = req.user.settings;

	// Basic validation
	if (!gpxString) {
		res.status(400);
		return next(new Error("GPX data string is required."));
	}
	if (gpxString.length === 0) {
		res.status(400);
		return next(new Error("GPX data string cannot be empty."));
	}

	let parsedGpxData;
	let gpxFileRef; // To store the GridFS file ID

	try {
		// 1. Parse GPX String
		console.log("Parsing GPX data...");
		// gpx-parse uses callbacks, let's promisify or handle async carefully
		parsedGpxData = await new Promise((resolve, reject) => {
			gpxParse.parseGpx(gpxString, (error, data) => {
				if (error) {
					console.error("GPX Parsing Error:", error);
					reject(new Error(`Failed to parse GPX data: ${error.message}`));
				} else if (
					!data ||
					!data.tracks ||
					data.tracks.length === 0 ||
					!data.tracks[0].segments ||
					data.tracks[0].segments[0].length === 0
				) {
					reject(new Error("Invalid or empty GPX track data found."));
				} else {
					console.log(
						`GPX parsing successful. Found ${
							data?.waypoints ? data.waypoints.length : 0
						} waypoints.`
					);
					resolve(data);
				}
			});
		});

		// Flatten points from segments if necessary (assuming one track, one segment for simplicity)
		const trackPoints = parsedGpxData.tracks[0].segments.flat(); // Use flat() for segments array
		if (trackPoints.length < 2) {
			throw new Error("GPX track must contain at least two points.");
		}

		// 2. Extract Key Information from Parsed GPX
		const firstPoint = trackPoints[0];
		const lastPoint = trackPoints[trackPoints.length - 1];

		const startDate = new Date(firstPoint.time);
		const endDate = new Date(lastPoint.time);
		const durationMillis = endDate.getTime() - startDate.getTime();

		// Ensure dates are valid
		if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
			throw new Error("Invalid date found in GPX track points.");
		}

		// 3. Calculate Distance
		console.log("Calculating distance...");
		const geoJsonLine = turf.lineString(trackPoints.map((p) => [p.lon, p.lat])); // Create GeoJSON LineString
		const distanceMeters = turf.length(geoJsonLine, { units: "meters" }); // Calculate length in meters
		console.log(`Calculated distance: ${distanceMeters.toFixed(2)}m`);

		// 4. (Optional but recommended) Create Simplified Route
		console.log("Simplifying route...");
		// Adjust tolerance for desired simplification level (e.g., 0.0001 degrees is ~11m)
		const simplifiedGeoJson = turf.simplify(geoJsonLine, {
			tolerance: 0.0001,
			highQuality: true,
		});

		// --- Extract and Map Points of Interest (Waypoints) ---
		let mappedPois = [];
		if (parsedGpxData.waypoints && parsedGpxData.waypoints.length > 0) {
			mappedPois = parsedGpxData.waypoints.map((wpt) => ({
				lat: wpt.lat,
				lon: wpt.lon,
				timestamp: wpt.time ? new Date(wpt.time) : new Date(), // Use waypoint time or fallback to now
				name: wpt.name || null, // Use name if present
				description: wpt.desc || null, // Use description if present
			}));
			console.log(`Mapped ${mappedPois.length} POIs from GPX waypoints.`);
		}

		let validSimplifiedRoute = null; // Default to null
		// Check if the simplified coordinates array exists and has at least 2 points
		if (
			simplifiedGeoJson.geometry &&
			simplifiedGeoJson.geometry.coordinates &&
			simplifiedGeoJson.geometry.coordinates.length >= 2
		) {
			// Optional: Add a check for distinct points if MongoDB still complains
			// const firstCoord = simplifiedGeoJson.geometry.coordinates[0];
			// const lastCoord = simplifiedGeoJson.geometry.coordinates[simplifiedGeoJson.geometry.coordinates.length - 1];
			// if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1] || simplifiedGeoJson.geometry.coordinates.length > 2) {
			validSimplifiedRoute = {
				type: "LineString",
				coordinates: simplifiedGeoJson.geometry.coordinates,
			};
			console.log(
				`Route simplified to ${validSimplifiedRoute.coordinates.length} points.`
			);
			// } else {
			//    console.warn("Simplified route resulted in identical start/end points, skipping storage.");
			// }
		} else {
			console.warn(
				`Simplified route has less than 2 points (${
					simplifiedGeoJson?.geometry?.coordinates?.length || 0
				}), skipping simplifiedRoute storage.`
			);
		}

		// Extract center coordinates (approximate)
		const mapCenter = { lat: firstPoint.lat, lon: firstPoint.lon }; // Just use first point for now

		// 5. Upload GPX String to Storage (GridFS)
		console.log("Uploading GPX to storage...");

		const filename = `trip_${userId}_${Date.now()}.gpx`; // Create a unique filename

		gpxFileRef = await storageService.uploadFile(gpxString, filename, {
			userId: userId.toString(), // Add metadata
			originalTimestamp: Date.now(),
		});
		console.log(`GPX file stored with ref: ${gpxFileRef}`);

		// 6. Create Trip Document in DB
		console.log("Creating Trip document in database...");
		const newTrip = new Trip({
			user: userId,
			title: title || `Trip on ${startDate.toLocaleDateString()}`,
			description,
			startLocationName,
			endLocationName,
			startDate,
			endDate,
			durationMillis,
			distanceMeters,
			defaultTripVisibility:
				defaultTripVisibility ||
				userSettings?.defaultTripVisibility ||
				Trip.schema.path("defaultTripVisibility").defaultValue,
			defaultTravelMode:
				defaultTravelMode ||
				userSettings?.defaultTravelMode ||
				Trip.schema.path("defaultTravelMode").defaultValue,
			gpxFileRef,
			pointsOfInterest: mappedPois, // Save the mapped POIs
			mapCenter,
			simplifiedRoute: validSimplifiedRoute,
		});

		const savedTrip = await newTrip.save(); // Save to MongoDB
		console.log("Trip document saved successfully:", savedTrip._id);

		// 7. Send Response
		res.status(201).json(savedTrip); // Respond with the created trip data
	} catch (error) {
		console.error("Error during trip creation:", error);

		// Clean up uploaded GPX file if trip saving fails *after* upload
		if (gpxFileRef) {
			console.warn(
				`Trip creation failed after GPX upload. Attempting to delete GridFS file: ${gpxFileRef}`
			);
			try {
				await storageService.deleteFile(gpxFileRef);
				console.log(`Orphaned GridFS file ${gpxFileRef} deleted.`);
			} catch (deleteError) {
				console.error(
					`Failed to delete orphaned GridFS file ${gpxFileRef}:`,
					deleteError
				);
				// Log this error, but don't necessarily overwrite the original error sent to the client
			}
		}

		// Pass the original error to the global error handler
		next(error);
	}
};

/**
 * @desc    Get a single trip by its ID
 * @route   GET /api/trips/:tripId
 * @access  Public with protectOptional
 */
const getTripById = async (req, res, next) => {
	const { tripId } = req.params;

	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	try {
		const trip = await Trip.findById(tripId)
			.select("-gpxFileRef")
			.populate("user", "username profilePictureUrl followers")
			.lean();

		if (!trip) {
			res.status(404);
			return next(new Error(`Trip not found with ID: ${tripId}`));
		}

		// Since we're using protect middleware, req.user will always exist
		const requestingUser = req.user;
		const tripOwner = trip.user;

		// First check: Is the requesting user the owner?
		if (requestingUser._id.toString() === trip.user._id.toString()) {
			return res.status(200).json(trip);
		}

		// If not owner, check visibility
		if (trip.defaultTripVisibility === "public") {
			return res.status(200).json(trip);
		}

		if (trip.defaultTripVisibility === "followers_only") {
			// Check if user is a follower
			const isFollower =
				tripOwner.followers &&
				tripOwner.followers.some(
					(followerId) =>
						followerId.toString() === requestingUser._id.toString()
				);

			if (isFollower) {
				return res.status(200).json(trip);
			}
		}

		// If we reach here, user doesn't have permission
		res.status(403);
		return next(new Error("You don't have permission to view this trip"));
	} catch (error) {
		console.error(`Error fetching trip ${tripId}:`, error);
		next(error);
	}
};

/**
 * @desc    Get the raw GPX file content for a trip
 * @route   GET /api/trips/:tripId/gpx
 * @access  Public (for now, assuming GPX files aren't private)
 */
const getTripGpx = async (req, res, next) => {
	const { tripId } = req.params;

	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	try {
		// 1. Find the trip document to get the gpxFileRef
		const trip = await Trip.findById(tripId).select("gpxFileRef title user"); // Select only needed fields
		if (!trip || !trip.gpxFileRef) {
			res.status(404);
			// Distinguish between trip not found and GPX ref missing
			const message = !trip
				? `Trip not found with ID: ${tripId}`
				: `GPX file reference missing for trip: ${tripId}`;
			return next(new Error(message));
		}

		// 2. Use storageService to get the file stream
		console.log(
			`Attempting to stream GPX for trip ${tripId}, fileRef: ${trip.gpxFileRef}`
		);
		const downloadStream = storageService.getFileStream(trip.gpxFileRef);

		// 3. Set response headers for file download
		// Generate a user-friendly filename
		const filename = trip.title
			? trip.title.replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".gpx"
			: `trip_${tripId}.gpx`;
		res.setHeader("Content-Type", "application/gpx+xml");
		res.setHeader("Content-Disposition", `attachment; filename="${filename}"`); // Suggest download

		// 4. Pipe the stream to the response
		downloadStream.pipe(res);

		// Handle stream errors (e.g., file not found in GridFS after check)
		downloadStream.on("error", (streamError) => {
			console.error(
				`Error streaming GridFS file ${trip.gpxFileRef}:`,
				streamError
			);
			// Important: Check if headers were already sent
			if (!res.headersSent) {
				res.status(404); // Or 500 depending on error
				next(new Error(`Could not retrieve GPX file: ${streamError.message}`));
			} else {
				// If headers sent, we can't change status code, just end the response
				res.end();
			}
		});

		downloadStream.on("end", () => {
			console.log(
				`Successfully streamed GPX file ${trip.gpxFileRef} for trip ${tripId}`
			);
		});
	} catch (error) {
		console.error(`Error preparing GPX download for trip ${tripId}:`, error);
		next(error);
	}
};

/**
 * @desc    Get all trips for the currently logged-in user
 * @route   GET /api/trips/me
 * @access  Private
 */
const getMyTrips = async (req, res, next) => {
	const userId = req.user._id;

	try {
		// Use aggregation pipeline for more control over projected data
		const trips = await Trip.aggregate([
			// Stage 1: Match trips for the current user
			{ $match: { user: userId } },
			// Stage 2: Sort by start date descending
			{ $sort: { startDate: -1 } },
			// Stage 3: Project the required fields and calculate counts
			{
				$project: {
					_id: 1, // Keep the ID
					title: 1,
					startDate: 1,
					// endDate: 1, // Keep if needed, excluded for brevity
					distanceMeters: 1,
					durationMillis: 1, // Keep for display
					startLocationName: 1,
					endLocationName: 1,
					description: { $substrCP: ["$description", 0, 150] }, // Get first 150 chars of description
					simplifiedRoute: 1, // Include simplified route for mini-map
					defaultTravelMode: 1,
					defaultTripVisibility: 1,
					likesCount: { $size: "$likes" }, // Calculate size of likes array
					commentsCount: { $size: "$comments" }, // Calculate size of comments array
					// Exclude large/unused fields explicitly if necessary (though $project includes only specified)
					// gpxFileRef: 0,
					// photos: 0,
					// likes: 0, // Exclude the full arrays
					// comments: 0, // Exclude the full arrays
				},
			},
		]);

		res.status(200).json(trips);
	} catch (error) {
		console.error(
			`Error fetching trips via aggregation for user ${userId}:`,
			error
		);
		next(error);
	}
};

const updateTrip = async (req, res, next) => {
	const { tripId } = req.params;
	const userId = req.user._id; // From 'protect' middleware
	// Only allow updating certain fields
	const {
		title,
		description,
		startLocationName,
		endLocationName,
		defaultTravelMode,
		defaultTripVisibility,
	} = req.body;

	// Use enums directly from the model for validation
	const allowedVisibilities = Trip.schema.path(
		"defaultTripVisibility"
	).enumValues;
	const allowedTravelModes = Trip.schema.path("defaultTravelMode").enumValues;
	// Validate ObjectId format
	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	try {
		// Find the trip
		const trip = await Trip.findById(tripId);

		if (!trip) {
			res.status(404);
			return next(new Error(`Trip not found with ID: ${tripId}`));
		}

		// --- Authorization Check ---
		// Convert both IDs to strings for reliable comparison
		if (trip.user.toString() !== userId.toString()) {
			res.status(403); // Forbidden
			return next(new Error("User not authorized to update this trip"));
		}

		// --- Update Fields ---
		// Update only if the field exists in the request body (allows partial updates)
		if (title !== undefined) trip.title = title.trim() || "My Trip"; // Add default title if empty
		if (description !== undefined) trip.description = description.trim();
		if (startLocationName !== undefined)
			trip.startLocationName = startLocationName.trim();
		if (endLocationName !== undefined)
			trip.endLocationName = endLocationName.trim();
		// Note: We are NOT allowing updates to dates, distance, GPX ref, route etc. via this endpoint

		if (defaultTripVisibility !== undefined) {
			if (!allowedVisibilities.includes(defaultTripVisibility)) {
				res.status(400);
				return next(
					new Error(`Invalid trip visibility: ${defaultTripVisibility}`)
				);
			}
			trip.defaultTripVisibility = defaultTripVisibility;
		}

		if (defaultTravelMode !== undefined) {
			if (!allowedTravelModes.includes(defaultTravelMode)) {
				res.status(400);
				return next(new Error(`Invalid travel mode: ${defaultTravelMode}`));
			}
			trip.defaultTravelMode = defaultTravelMode;
		}

		// Save the updated trip (this will also run Mongoose validators)
		const updatedTrip = await trip.save();

		// Respond with the updated trip data (populate user again for consistency)
		const responseTrip = await Trip.findById(updatedTrip._id)
			.populate("user", "username profilePictureUrl")
			.lean(); // Use lean for final response

		res.status(200).json(responseTrip);
	} catch (error) {
		// Handle potential validation errors from Mongoose save
		if (error.name === "ValidationError") {
			const messages = Object.values(error.errors).map((val) => val.message);
			res.status(400); // Bad Request
			return next(new Error(messages.join(", ")));
		}
		console.error(`Error updating trip ${tripId}:`, error);
		next(error);
	}
};

/**
 * @desc    Delete a trip
 * @route   DELETE /api/trips/:tripId
 * @access  Private (Owner only)
 */
const deleteTrip = async (req, res, next) => {
	const { tripId } = req.params;
	const userId = req.user._id;

	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	// const session = await mongoose.startSession(); // Use a session for atomicity
	// session.startTransaction();

	try {
		const trip = await Trip.findById(tripId).select(
			"_id user gpxFileRef photos"
		);
		// .session(session);

		if (!trip) {
			// await session.commitTransaction();
			return res.status(204).send();
		}

		if (trip.user.toString() !== userId.toString()) {
			// await session.abortTransaction();
			res.status(403);
			return next(new Error("User not authorized to delete this trip"));
		}

		// Delete GPX file first if it exists
		if (trip.gpxFileRef) {
			try {
				await storageService.deleteFile(trip.gpxFileRef);
			} catch (deleteError) {
				// Log the error but continue with trip deletion
				console.warn(
					`Failed to delete GPX file ${trip.gpxFileRef}: ${deleteError.message}`
				);
			}
		}

		// 2. Delete associated photos if they exist
		if (trip.photos && trip.photos.length > 0) {
			const photoDeletionPromises = trip.photos.map(async (photoId) => {
				try {
					await storageService.deleteFile(photoId.toString()); // Ensure it's a string
				} catch (photoDeleteError) {
					// Log error for individual photo deletion failure but continue
					console.warn(
						`Failed to delete photo file ${photoId} (may already be deleted): ${photoDeleteError.message}`
					);
				}
			});
			// Wait for all photo deletions to attempt completion
			await Promise.all(photoDeletionPromises);
		}

		// 3. Find and delete associated recommendations and their photos
		const recommendationsToDelete = await Recommendation.find({
			associatedTrip: tripId,
		}).select("photos");
		// .session(session);

		if (recommendationsToDelete.length > 0) {
			for (const rec of recommendationsToDelete) {
				if (rec.photos && rec.photos.length > 0) {
					const recPhotoDeletionPromises = rec.photos.map(async (photoId) => {
						try {
							await storageService.deleteFile(photoId.toString());
						} catch (recPhotoDeleteError) {
							console.warn(
								`Failed to delete recommendation photo file ${photoId} for trip ${tripId}: ${recPhotoDeleteError.message}`
							);
						}
					});
					await Promise.all(recPhotoDeletionPromises);
				}
			}
			// Delete the recommendation documents
			await Recommendation.deleteMany({ associatedTrip: tripId });
			// .session(	session);
		}

		// Delete the trip document
		await Trip.deleteOne({ _id: tripId });
		// .session(session);

		// await session.commitTransaction();
		res.status(200).json({ message: "Trip deleted successfully" });
	} catch (error) {
		// await session.abortTransaction();
		console.error(`Error deleting trip ${tripId}:`, error);
		next(error);
	}
	//  finally {
	// 	session.endSession();
	// }
};

/**
 * @desc    Get trips for the user's feed (from people they follow)
 * @route   GET /api/trips/feed
 * @access  Private
 */
const getFeedTrips = async (req, res, next) => {
	const currentUserId = req.user._id;
	// Optional: Pagination query parameters (implement later if needed)
	// const page = parseInt(req.query.page, 10) || 1;
	// const limit = parseInt(req.query.limit, 10) || 10;
	// const skip = (page - 1) * limit;

	try {
		// 1. Get the list of users the current user is following
		// We only need the 'following' array from the User document
		const currentUser = await User.findById(currentUserId)
			.select("following")
			.lean();

		// if (
		// 	!currentUser ||
		// 	!currentUser.following ||
		// 	currentUser.following.length === 0
		// ) {
		// 	// User is not following anyone, return empty feed
		// 	return res.status(200).json([]);
		// }

		if (!currentUser?.following?.length) {
			return res.status(200).json([]);
		}

		const followingIds = currentUser.following; // Array of ObjectIds

		// First, let's check all trips from followed users
		const allTrips = await Trip.find({
			user: { $in: followingIds },
		}).lean();

		console.log(
			"Debug - All trips from followed users:",
			allTrips.map((t) => ({
				tripId: t._id,
				visibility: t.defaultTripVisibility,
				userId: t.user,
			}))
		);

		// 2. Find trips where the 'user' field is in the followingIds array
		// Use aggregation to get counts and project needed fields, similar to getMyTrips
		const feedTrips = await Trip.aggregate([
			// Stage 1: Match trips from followed users
			{
				$match: {
					user: { $in: followingIds },
					// Match trips that are either public OR followers_only
					defaultTripVisibility: { $in: ["public", "followers_only"] },
				},
			},

			{ $sort: { createdAt: -1 } },
			// Optional: Skip and Limit for pagination
			// { $skip: skip },
			// { $limit: limit },
			// Stage 3: Lookup user details for each trip
			{
				$lookup: {
					from: "users", // The actual collection name for users
					localField: "user",
					foreignField: "_id",
					as: "userDetails", // Output array name
				},
			},
			// Stage 4: Deconstruct the userDetails array (it will have 0 or 1 element)
			{ $unwind: "$userDetails" }, // Use $unwind cautiously, ensure user always exists
			// Stage 5: Project required fields + user details
			{
				$project: {
					_id: 1,
					title: 1,
					startDate: 1,
					distanceMeters: 1,
					durationMillis: 1,
					startLocationName: 1,
					endLocationName: 1,
					description: { $substrCP: ["$description", 0, 150] },
					simplifiedRoute: 1,
					defaultTravelMode: 1,
					defaultTripVisibility: 1,
					likesCount: { $size: "$likes" },
					commentsCount: { $size: "$comments" },
					createdAt: 1, // Include createdAt for sorting context if needed
					// Project required user fields from the lookup
					user: {
						_id: "$userDetails._id",
						username: "$userDetails.username",
						profilePictureUrl: "$userDetails.profilePictureUrl",
					},
					// Exclude fields if needed
				},
			},
		]);
		console.log(`Total feed trips found: ${feedTrips.length}`);
		console.log(
			"Trips visibility breakdown:",
			feedTrips.map((t) => ({
				tripId: t._id,
				visibility: t.defaultTripVisibility,
				userId: t.user._id,
			}))
		);

		res.status(200).json(feedTrips);
	} catch (error) {
		console.error(`Error fetching feed for user ${currentUserId}:`, error);
		next(error);
	}
};

/**
 * @desc    Like a trip
 * @route   POST /api/trips/:tripId/like
 * @access  Private
 */
const likeTrip = async (req, res, next) => {
	const { tripId } = req.params;
	const userId = req.user._id; // From 'protect' middleware

	// Validate ObjectId format
	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	try {
		// Find the trip
		const trip = await Trip.findById(tripId);

		if (!trip) {
			res.status(404);
			return next(new Error(`Trip not found with ID: ${tripId}`));
		}

		// Check if already liked by this user
		// Use .some() for efficiency and toString() for comparison
		const alreadyLiked = trip.likes.some(
			(like) => like.toString() === userId.toString()
		);

		if (alreadyLiked) {
			res.status(400);
			return;
			// return next(new Error("You have already liked this trip."));
		}

		// Add user's ID to the likes array
		trip.likes.push(userId);

		// Save the updated trip
		await trip.save();

		console.log(`User ${userId} liked trip ${tripId}`);
		// Respond with updated like count or simple success
		res.status(200).json({
			message: "Trip liked successfully",
			likesCount: trip.likes.length, // Send back the new count
		});
	} catch (error) {
		console.error(`Error liking trip ${tripId} by user ${userId}:`, error);
		next(error);
	}
};

/**
 * @desc    Unlike a trip
 * @route   DELETE /api/trips/:tripId/like
 * @access  Private
 */
const unlikeTrip = async (req, res, next) => {
	const { tripId } = req.params;
	const userId = req.user._id;

	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	try {
		const trip = await Trip.findById(tripId);

		if (!trip) {
			res.status(404);
			return next(new Error(`Trip not found with ID: ${tripId}`));
		}

		// Check if the user has actually liked the trip before unliking
		const initialLength = trip.likes.length;
		trip.likes = trip.likes.filter(
			(like) => like.toString() !== userId.toString()
		);

		// Check if the array length actually changed
		if (trip.likes.length === initialLength) {
			// User hadn't liked it in the first place
			console.log(
				`User ${userId} tried to unlike trip ${tripId}, but was not found in likes.`
			);
			// You could return 400, but often it's fine to just return success/updated count
			// return res.status(400).json({ message: "You haven't liked this trip." });
		} else {
			console.log(`User ${userId} unliked trip ${tripId}`);
		}

		// Save the updated trip
		await trip.save();

		res.status(200).json({
			message: "Trip unlike processed", // Use neutral message
			likesCount: trip.likes.length, // Send back the new count
		});
	} catch (error) {
		console.error(`Error unliking trip ${tripId} by user ${userId}:`, error);
		next(error);
	}
};

/**
 * @desc    Add a comment to a trip
 * @route   POST /api/trips/:tripId/comments
 * @access  Private
 */
const addCommentToTrip = async (req, res, next) => {
	const { tripId } = req.params;
	const userId = req.user._id;
	const { text } = req.body; // Get comment text from body

	// Validate ObjectId format
	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	// Validate comment text
	if (!text || typeof text !== "string" || text.trim().length === 0) {
		res.status(400);
		return next(new Error("Comment text cannot be empty."));
	}
	if (text.length > 500) {
		// Matches schema validation
		res.status(400);
		return next(new Error("Comment cannot exceed 500 characters."));
	}

	try {
		// Find the trip
		// Select only the comments field for update efficiency if needed, but findById is fine
		const trip = await Trip.findById(tripId);

		if (!trip) {
			res.status(404);
			return next(new Error(`Trip not found with ID: ${tripId}`));
		}

		// Create the new comment subdocument
		const newComment = {
			user: userId,
			text: text.trim(),
			// createdAt is defaulted by schema
		};

		// Add comment to the beginning of the array (newest first)
		trip.comments.unshift(newComment);

		// Save the trip with the new comment
		await trip.save();

		// --- Populate user info for the newly added comment ---
		// We need to populate the user details for the comment we just added
		// Find the newly added comment (it's the first one now)
		const addedComment = trip.comments[0];
		// Manually populate the user details from the logged-in user info we have
		// Or fetch fresh user details if needed (more robust but slower)
		const populatedComment = {
			...addedComment.toObject(), // Convert Mongoose subdoc to plain object
			user: {
				// Replace user ID with user object
				_id: req.user._id,
				username: req.user.username,
				profilePictureUrl: req.user.profilePictureUrl,
			},
		};
		// --- End Population ---

		console.log(`User ${userId} added comment to trip ${tripId}`);
		// Respond with the newly created and populated comment
		res.status(201).json(populatedComment);
	} catch (error) {
		console.error(
			`Error adding comment to trip ${tripId} by user ${userId}:`,
			error
		);
		next(error);
	}
};

/**
 * @desc    Get all comments for a specific trip
 * @route   GET /api/trips/:tripId/comments
 * @access  Public (or Private if comments should be restricted)
 */
const getTripComments = async (req, res, next) => {
	const { tripId } = req.params;

	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	try {
		// Find the trip and select only the comments field
		// Then populate the user details for each comment
		const trip = await Trip.findById(tripId)
			.select("comments") // Select only the comments array
			.populate({
				path: "comments.user", // Path to the user field within the comments array
				select: "username profilePictureUrl", // Fields to populate from User model
			})
			.lean(); // Use lean for performance

		if (!trip) {
			res.status(404);
			return next(new Error(`Trip not found with ID: ${tripId}`));
		}

		// Comments are already populated by the query
		// Ensure newest comments appear first if added via unshift
		// Or sort here if needed: trip.comments.sort((a, b) => b.createdAt - a.createdAt);
		res.status(200).json(trip.comments);
	} catch (error) {
		console.error(`Error fetching comments for trip ${tripId}:`, error);
		next(error);
	}
};

/**
 * @desc    Upload photos for a specific trip
 * @route   POST /api/trips/:tripId/photos
 * @access  Private (Owner Only)
 */
const uploadTripPhotos = async (req, res, next) => {
	const { tripId } = req.params;
	const userId = req.user._id;

	// Validate ObjectId format
	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	// Check if files were uploaded by multer (now in memory)
	if (!req.files || req.files.length === 0) {
		res.status(400);
		return next(new Error("No photo files were uploaded."));
	}

	console.log(
		`Received ${req.files.length} files in memory for trip ${tripId}`
	);

	let trip; // Define trip outside the try block for potential cleanup

	try {
		// Find the trip to check ownership
		trip = await Trip.findById(tripId).select("_id user photos"); // Select only necessary fields
		if (!trip) {
			res.status(404);
			// No temp files to clean up with memoryStorage
			return next(new Error(`Trip not found with ID: ${tripId}`));
		}

		// Authorization Check
		if (trip.user.toString() !== userId.toString()) {
			res.status(403);
			// No temp files to clean up with memoryStorage
			return next(
				new Error("User not authorized to upload photos to this trip")
			);
		}

		// Process and upload each file
		const uploadPromises = req.files.map(async (file) => {
			console.log(
				`Processing file in memory: ${file.originalname}, Size: ${file.size}`
			);

			// --- Sharp Processing Pipeline ---
			let processedBufferData;
			let processedMetadata;
			const TARGET_SIZE_KB = 1024;
			const MAX_DIMENSION = 1920;
			let quality = 80;
			try {
				let bufferObj;

				const imageProcessor = await sharp(file.buffer, { failOn: "truncated" })
					.rotate()
					.resize({
						width: MAX_DIMENSION,
						height: MAX_DIMENSION,
						fit: sharp.fit.inside,
						withoutEnlargement: true,
					});
				// .jpeg({ failOnError: false })
				// .png({ failOnError: false }) // <-- tolerate slight corruption in PNG inputs
				// .webp({ quality, effort: 4 })
				// .toBuffer({ resolveWithObject: true });

				// Try converting to WebP with reasonably high quality first
				let currentQuality = 80;
				bufferObj = await imageProcessor
					.webp({ quality: currentQuality, effort: 4 }) // effort 4 is a good balance
					.toBuffer({ resolveWithObject: true });

				// If it's still too large, reduce quality
				if (bufferObj.data.length > TARGET_SIZE_KB * 1024) {
					console.log(
						`Trip photo > ${TARGET_SIZE_KB}KB (${(
							bufferObj.data.length / 1024
						).toFixed(1)} KB), reducing quality...`
					);
					currentQuality = 65; // Lower quality setting for trip photos if needed
					bufferObj = await imageProcessor
						.webp({ quality: currentQuality, effort: 4 })
						.toBuffer({ resolveWithObject: true });
				}

				processedBufferData = bufferObj.data;
				processedMetadata = bufferObj.info;

				console.log(
					`Sharp processing complete for ${file.originalname}. New size: ${(
						processedMetadata.size / 1024
					).toFixed(1)} KB, quality: ${currentQuality}`
				);
			} catch (sharpError) {
				console.error(
					`Sharp processing failed for ${file.originalname}:`,
					sharpError
				);
				// Throw an error to stop this file's upload and potentially fail the request
				throw new Error(
					`Image processing failed for ${file.originalname}: ${sharpError.message}`
				);
			}
			// --- End Sharp Processing ---

			// Define filename for storage (use original name base + .webp)
			const originalNameBase = path.parse(file.originalname).name;
			const storageFilename = `trip_${tripId}_${originalNameBase}_${Date.now()}.webp`; // Ensure unique name and correct extension

			const metadata = {
				userId: userId.toString(),
				tripId: tripId,
				originalFilename: file.originalname, // Keep original name for reference
				processedFilename: storageFilename,
				mimetype: "image/webp", // Mimetype is now webp
				size: processedMetadata.size, // Use size of the processed buffer
				width: processedMetadata.width, // Store processed dimensions
				height: processedMetadata.height,
			};

			// Upload the *processed* buffer to GridFS using storageService
			console.log(`Uploading ${storageFilename} (processed) to GridFS...`);
			const fileId = await storageService.uploadFile(
				processedBufferData, // Pass the actual buffer data
				storageFilename,
				"image/webp",
				metadata
			);
			console.log(`Uploaded ${storageFilename} with ID: ${fileId}`);

			// --- NO Temporary file cleanup needed with memoryStorage ---
			// fs.unlinkSync(file.path); // REMOVE THIS LINE

			return fileId; // Return the stored file ID
		});

		// Wait for all uploads to complete
		const uploadedFileIds = await Promise.all(uploadPromises);
		console.log("All photos processed and uploaded:", uploadedFileIds);

		// Add the new photo file IDs to the trip's photos array
		trip.photos.push(...uploadedFileIds);
		await trip.save(); // Save the updated trip document

		res.status(200).json({
			message: `${uploadedFileIds.length} photos uploaded successfully.`,
			photoIds: uploadedFileIds, // Return the IDs of the uploaded photos
		});
	} catch (error) {
		console.error(`Error uploading photos for trip ${tripId}:`, error);
		next(error);
	}
};

/**
 * @desc    Delete a specific photo associated with a trip
 * @route   DELETE /api/trips/:tripId/photos/:photoId
 * @access  Private (Owner Only)
 */
const deleteTripPhoto = async (req, res, next) => {
	const { tripId, photoId } = req.params;
	const userId = req.user._id;

	// Validate IDs
	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID: ${tripId}`));
	}
	if (!mongoose.Types.ObjectId.isValid(photoId)) {
		res.status(400);
		return next(new Error(`Invalid Photo ID: ${photoId}`));
	}

	try {
		// Find the trip and verify ownership in one query
		const trip = await Trip.findOne({
			_id: tripId,
			user: userId,
		}).select("photos");

		if (!trip) {
			res.status(404);
			return next(new Error("Trip not found or user not authorized"));
		}

		// Remove the photo ID from the trip's photos array
		const photoIdString = photoId.toString();
		const photoExists = trip.photos.includes(photoIdString);

		if (!photoExists) {
			res.status(404);
			return next(new Error(`Photo ${photoId} not found in trip`));
		}

		// Try to delete the file from GridFS first
		try {
			await storageService.deleteFile(photoIdString);
			console.log(`Successfully deleted photo file ${photoId} from storage`);
		} catch (storageError) {
			console.error(
				`Failed to delete photo file ${photoId} from storage:`,
				storageError
			);
			// If the file doesn't exist in storage, we still want to remove the reference
			if (!storageError.message.includes("not found")) {
				throw storageError; // Re-throw if it's not a "not found" error
			}
		}

		// Remove the photo reference from the trip
		trip.photos = trip.photos.filter((id) => id.toString() !== photoIdString);
		await trip.save();
		console.log(`Removed photo reference ${photoId} from trip ${tripId}`);

		res.status(200).json({
			message: "Photo deleted successfully",
			photoId: photoId,
		});
	} catch (error) {
		console.error(`Error in deleteTripPhoto for ${tripId}/${photoId}:`, error);
		next(error);
	}
};

/**
 * @desc    Get users who liked a specific trip
 * @route   GET /api/trips/:tripId/likers
 * @access  Public (or Private if needed)
 */
const getTripLikers = async (req, res, next) => {
	const { tripId } = req.params;

	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID format: ${tripId}`));
	}

	try {
		// Find the trip, select only the 'likes' field, and populate user details
		const trip = await Trip.findById(tripId)
			.select("likes") // Select only the likes array
			.populate({
				path: "likes", // Path to the user IDs in the likes array
				select: "username profilePictureUrl", // Fields to populate from User model
			})
			.lean(); // Use lean for performance

		if (!trip) {
			res.status(404);
			return next(new Error(`Trip not found with ID: ${tripId}`));
		}

		// The 'likes' field now contains an array of populated user objects
		res.status(200).json(trip.likes);
	} catch (error) {
		console.error(`Error fetching likers for trip ${tripId}:`, error);
		next(error);
	}
};

/**
 * @desc    Delete a comment from a trip
 * @route   DELETE /api/trips/:tripId/comments/:commentId
 * @access  Private (Comment Owner Only)
 */
const deleteCommentFromTrip = async (req, res, next) => {
	const { tripId, commentId } = req.params;
	const userId = req.user._id; // From protect middleware

	// Validate IDs
	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID: ${tripId}`));
	}
	if (!mongoose.Types.ObjectId.isValid(commentId)) {
		res.status(400);
		return next(new Error(`Invalid Comment ID: ${commentId}`));
	}

	try {
		// Find the trip
		const trip = await Trip.findById(tripId).select("comments"); // Select only comments

		if (!trip) {
			res.status(404);
			return next(new Error(`Trip not found with ID: ${tripId}`));
		}

		// Find the comment within the trip's comments array
		const comment = trip.comments.id(commentId); // Mongoose subdocument .id() method

		if (!comment) {
			res.status(404);
			return next(
				new Error(`Comment ${commentId} not found in trip ${tripId}`)
			);
		}

		// --- Authorization Check: User must own the comment ---
		if (comment.user.toString() !== userId.toString()) {
			res.status(403); // Forbidden
			return next(new Error("User not authorized to delete this comment"));
		}
		// --- Delete the comment ---
		trip.comments = trip.comments.filter((c) => c._id.toString() !== commentId);

		// Save the parent trip document to persist the removal
		await trip.save();

		res.status(200).json({
			message: "Comment deleted successfully",
			commentId: commentId, // Return the ID of the deleted comment
			comments: trip.comments, // Optionally return the updated comments array
		});
	} catch (error) {
		next(error);
	}
};

/**
 * @desc    Add a Point of Interest (POI) to an existing trip
 * @route   POST /api/trips/:tripId/pois
 * @access  Private (Owner Only)
 */
const addPoiToTrip = async (req, res, next) => {
	const { tripId } = req.params;
	const userId = req.user._id;
	const { name, description, latitude, longitude } = req.body;

	// Validate IDs and coordinates
	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		res.status(400);
		return next(new Error(`Invalid Trip ID: ${tripId}`));
	}
	if (
		typeof latitude !== "number" ||
		typeof longitude !== "number" ||
		isNaN(latitude) ||
		isNaN(longitude)
	) {
		res.status(400);
		return next(new Error("Invalid latitude or longitude provided."));
	}
	// Optional: Validate name/description length if needed, matching schema
	if (name && name.length > 100) {
		res.status(400);
		return next(new Error("POI name cannot exceed 100 characters."));
	}
	if (description && description.length > 500) {
		res.status(400);
		return next(new Error("POI description cannot exceed 500 characters."));
	}

	try {
		// Find the trip and verify ownership
		const trip = await Trip.findOne({ _id: tripId, user: userId }).select(
			"pointsOfInterest simplifiedRoute"
		); // Select POIs and route for context

		if (!trip) {
			res.status(404);
			return next(new Error("Trip not found or user not authorized"));
		}

		// Create the new POI subdocument
		const newPoi = {
			lat: latitude,
			lon: longitude,
			timestamp: new Date(), // Use current time as timestamp for manually added POI
			name: name?.trim() || null, // Trim or set null
			description: description?.trim() || null, // Trim or set null
		};

		// Add the new POI to the array
		trip.pointsOfInterest.push(newPoi);

		// Save the updated trip
		await trip.save();

		// Get the newly added POI (it will be the last one in the array)
		const addedPoi = trip.pointsOfInterest[trip.pointsOfInterest.length - 1];

		console.log(`User ${userId} added POI to trip ${tripId}`);
		// Respond with the newly created POI object
		res.status(201).json(addedPoi);
	} catch (error) {
		console.error(`Error adding POI to trip ${tripId}:`, error);
		next(error);
	}
};

module.exports = {
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
};

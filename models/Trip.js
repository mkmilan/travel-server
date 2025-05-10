// server/models/Trip.js
const mongoose = require("mongoose");

// --- Comment Subdocument Schema ---
// Define this *before* the Trip schema that uses it
const commentSchema = new mongoose.Schema(
	{
		user: {
			// User who made the comment
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		text: {
			type: String,
			required: [true, "Comment text cannot be empty"],
			trim: true,
			maxlength: [500, "Comment cannot exceed 500 characters"],
		},
		createdAt: {
			// Timestamp for the comment itself
			type: Date,
			default: Date.now,
		},
	},
	{ _id: true }
); // Ensure subdocuments get their own _id

// --- POI Subdocument Schema ---
// Define this *before* the Trip schema that uses it
const poiSchema = new mongoose.Schema(
	{
		lat: { type: Number, required: true },
		lon: { type: Number, required: true },
		timestamp: { type: Date, required: true }, // When the POI was marked
		name: {
			type: String,
			trim: true,
			maxlength: [100, "POI name cannot exceed 100 characters"],
		},
		description: {
			type: String,
			trim: true,
			maxlength: [500, "POI description cannot exceed 500 characters"],
		},
		category: {
			type: String,
			trim: true,
			maxlength: [50, "Category cannot exceed 50 characters"],
		},
		externalLink: {
			type: String,
			trim: true,
			maxlength: [200, "External link cannot exceed 200 characters"],
		},
	},
	{ _id: true } // Don't need separate _id for POIs within the trip array
);

// --- Trip Schema ---
const tripSchema = new mongoose.Schema(
	{
		user: {
			// User who created the trip
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true, // Index for faster querying of user's trips
		},
		title: {
			type: String,
			required: [true, "Trip title is required"],
			trim: true,
			maxlength: [100, "Title cannot exceed 100 characters"],
			default: "My Trip",
		},
		description: {
			type: String,
			trim: true,
			maxlength: [2000, "Description cannot exceed 2000 characters"],
			default: "",
		},
		defaultTripVisibility: {
			type: String,
			enum: ["public", "followers_only", "private"],
			default: "public",
		},
		defaultTravelMode: {
			type: String,
			enum: [
				"motorhome",
				"campervan",
				"car",
				"motorcycle",
				"bicycle",
				"walking",
				"",
			],
			default: "motorhome",
		},
		startLocationName: {
			// User-defined start location (e.g., "City A")
			type: String,
			trim: true,
			maxlength: [100, "Location name cannot exceed 100 characters"],
		},
		endLocationName: {
			// User-defined end location (e.g., "City B")
			type: String,
			trim: true,
			maxlength: [100, "Location name cannot exceed 100 characters"],
		},
		startDate: {
			// Extracted from GPX or set by user
			type: Date,
			required: true,
		},
		endDate: {
			// Extracted from GPX or set by user
			type: Date,
			required: true,
		},
		durationMillis: {
			// Calculated from GPX timestamps
			type: Number,
			required: true,
		},
		distanceMeters: {
			// Calculated from GPX points
			type: Number,
			required: true,
		},
		gpxFileRef: {
			// Reference ID/Key/URL to the stored GPX file (GridFS ID initially)
			type: String, // Using String to accommodate GridFS ObjectId or potentially S3 Keys/URLs later
			required: true,
		},
		pointsOfInterest: [poiSchema],
		// Optional: For quicker map centering/initial zoom
		mapCenter: {
			lat: Number,
			lon: Number,
		},
		mapZoom: Number,
		// Optional but Recommended: Simplified route for faster map preview loading
		simplifiedRoute: {
			type: {
				type: String,
				enum: ["LineString"], // GeoJSON type
				// required: true // Make required if always generated
			},
			coordinates: {
				type: [[Number]], // Array of [lon, lat] pairs
				// required: true
			},
		},
		photos: [
			{
				// Array of IDs/URLs for associated photos
				type: String, // String to accommodate file IDs or URLs
			},
		],
		likes: [
			{
				// Array of user IDs who liked the trip
				type: mongoose.Schema.Types.ObjectId,
				ref: "User",
			},
		],
		comments: [commentSchema], // Array of comment subdocuments
	},
	{
		timestamps: true, // Adds createdAt and updatedAt for the Trip itself
	}
);

// --- Indexes ---
// Index for geospatial queries on simplifiedRoute (if using it)
tripSchema.index({ simplifiedRoute: "2dsphere" });
// Compound index if frequently querying user's trips by date
tripSchema.index({ user: 1, startDate: -1 });

const Trip = mongoose.model("Trip", tripSchema);

module.exports = Trip;

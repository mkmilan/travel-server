// Potential server/models/Recommendation.js
const mongoose = require("mongoose");

const recommendationSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		location: {
			// GeoJSON Point for geospatial queries
			type: { type: String, enum: ["Point"], required: true },
			coordinates: { type: [Number], required: true }, // [longitude, latitude]
		},
		name: { type: String, required: true, trim: true, maxlength: 120 },
		description: { type: String, required: true, trim: true, maxlength: 2000 },
		rating: { type: Number, min: 1, max: 5, required: true }, // e.g., 1-5 stars
		primaryCategory: {
			// Main type of place
			type: String,
			required: true,
			enum: [
				// Define a fixed list of core categories
				"CAMPSITE", // Official campsite
				"AIRE", // Service area, often with overnight parking
				"WILD_SPOT", // Unofficial/wild camping location
				"PARKING", // Daytime or potentially overnight parking (not specifically for camping)
				"RESTAURANT",
				"CAFE",
				"SUPERMARKET",
				"SERVICE_POINT", // Water, waste disposal only
				"LANDMARK", // Viewpoint, historical site, etc.
				"ACTIVITY", // Hike start, beach access, etc.
				"OTHER",
			],
			index: true,
		},
		attributeTags: [
			{
				// Specific features/attributes - allow multiple
				type: String,
				enum: [
					// Define relevant attributes
					"PET_FRIENDLY",
					"FAMILY_FRIENDLY",
					"ACCESSIBLE",
					"FREE",
					"LOW_COST", // Cost indicators
					"SCENIC",
					"QUIET",
					"SECURE", // Ambiance/Safety
					"WATER_FILL",
					"GREY_WATER_DISPOSAL",
					"BLACK_WATER_DISPOSAL",
					"TOILETS",
					"SHOWERS",
					"LAUNDRY",
					"ELECTRICITY",
					"WIFI",
					"PLAYGROUND",
					"POOL",
					"NEAR_BEACH",
					"HIKING_NEARBY",
					"LPG_SWAP",
					// Add more as needed
				],
				index: true,
			},
		],
		photos: [{ type: String }], // Array of photo IDs/references
		associatedTrip: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Trip",
			index: true,
			sparse: true,
		}, // Optional link to the trip if created from a POI
		source: { type: String, enum: ["MANUAL", "POI"], default: "MANUAL" },
	},
	{ timestamps: true }
);

// Geospatial index for location-based searches
recommendationSchema.index({ location: "2dsphere" });
// Text index for searching name/description (optional but useful)
recommendationSchema.index({ name: "text", description: "text" });

const Recommendation = mongoose.model("Recommendation", recommendationSchema);
module.exports = Recommendation;

// filepath: /home/mkmilan/Documents/my/travel-2/server/controllers/searchController.js
const User = require("../models/User");
const Trip = require("../models/Trip");
const Recommendation = require("../models/Recommendation");

/**
 * @desc    Perform search across different models based on type
 * @route   GET /api/search?q=query&type=searchType
 * @access  Public (or Private if personalization needed later)
 */
const performSearch = async (req, res, next) => {
	const { q: query, type } = req.query;
	const loggedInUserId = req.user?._id; // Optional: Get logged-in user ID if authenticated

	// --- Input Validation ---
	if (!query || typeof query !== "string" || query.trim().length < 2) {
		return res.status(400).json({ message: "Search query must be at least 2 characters long." });
	}
	if (!type || !["users", "trips", "recommendations"].includes(type)) {
		return res.status(400).json({ message: "Invalid search type specified." });
	}

	const trimmedQuery = query.trim();
	const searchTermRegex = new RegExp(trimmedQuery, "i");

	try {
		let results = [];

		switch (type) {
			case "users":
				results = await User.find({
					username: searchTermRegex,
					_id: { $ne: loggedInUserId }, // Exclude logged-in user if authenticated
				}).select("_id username profilePictureUrl"); // Select necessary fields
				break;

			case "trips":
				results = await Trip.find({
					$or: [
						{ title: searchTermRegex },
						{ description: searchTermRegex },
						{ startLocationName: searchTermRegex },
						{ endLocationName: searchTermRegex },
					],
				})
					.select("_id title user startDate startLocationName endLocationName") // Select necessary fields
					.populate("user", "_id username"); // Populate user info
				break;

			case "recommendations":
				// **Updated Logic: Search by primaryCategory (case-insensitive exact match)**
				// We use regex for case-insensitivity but anchor it to match the whole string.
				const categoryRegex = new RegExp(`^${trimmedQuery}$`, "i");
				results = await Recommendation.find({
					primaryCategory: categoryRegex,
					// We could add secondary categories later: $or: [{ primaryCategory: categoryRegex }, { secondaryCategories: categoryRegex }]
				})
					.select("_id name user primaryCategory rating location") // Select necessary fields
					.populate("user", "_id username"); // Populate user info
				break;

			default:
				// Should be caught by validation, but good practice
				return res.status(400).json({ message: "Invalid search type." });
		}

		res.status(200).json(results);
	} catch (error) {
		console.error(`Error searching ${type}:`, error);
		next(error); // Pass error to global handler
	}
};

module.exports = {
	performSearch,
};

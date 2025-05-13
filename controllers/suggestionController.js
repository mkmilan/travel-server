const Suggestion = require("../models/Suggestion");
const User = require("../models/User"); // If you need to validate user existence

/**
 * @desc    Submit a new suggestion or bug report
 * @route   POST /api/suggestions
 * @access  Public (or Private if only logged-in users can submit)
 */
const submitSuggestion = async (req, res, next) => {
	const { type, category, subject, description, email } = req.body;
	const userId = req.user?._id; // From 'protectOptional' or 'protect' middleware

	// Basic Validations
	if (!type || !subject || !description) {
		res.status(400);
		return next(new Error("Type, subject, and description are required."));
	}

	if (type === "suggestion" && !category) {
		// If it's a suggestion, category should ideally be provided,
		// but your frontend defaults it, so this might be optional based on strictness.
		// For now, let's allow it to be empty if not explicitly sent.
	}

	try {
		const suggestionData = {
			type,
			subject,
			description,
			...(category && type === "suggestion" && { category }), // Add category only if type is suggestion and category is provided
			...(email && { email }), // Add email if provided
			...(userId && { user: userId }), // Add user if logged in
		};

		const newSuggestion = new Suggestion(suggestionData);
		const savedSuggestion = await newSuggestion.save();

		// TODO: Potentially send an email notification to admin here

		res.status(201).json({
			message: "Feedback submitted successfully. Thank you!",
			suggestion: savedSuggestion,
		});
	} catch (error) {
		if (error.name === "ValidationError") {
			const messages = Object.values(error.errors).map((val) => val.message);
			res.status(400);
			return next(new Error(messages.join(", ")));
		}
		console.error("Error submitting suggestion:", error);
		next(error);
	}
};

module.exports = {
	submitSuggestion,
	// Future: getSuggestions (for admin), updateSuggestionStatus, etc.
};

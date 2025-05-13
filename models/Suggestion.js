const mongoose = require("mongoose");

const suggestionSchema = new mongoose.Schema(
	{
		type: {
			type: String,
			required: [true, "Feedback type is required (suggestion or bug)."],
			enum: ["suggestion", "bug"],
		},
		category: {
			// Only relevant if type is 'suggestion'
			type: String,
			enum: ["feature", "ui_change", "other", ""], // Allow empty if not a suggestion or not categorized
			default: "",
		},
		subject: {
			type: String,
			required: [true, "Subject is required."],
			trim: true,
			minlength: [5, "Subject must be at least 5 characters long."],
			maxlength: [150, "Subject cannot exceed 150 characters."],
		},
		description: {
			type: String,
			required: [true, "Description is required."],
			trim: true,
			minlength: [10, "Description must be at least 10 characters long."],
			maxlength: [2000, "Description cannot exceed 2000 characters."],
		},
		email: {
			// Optional: for non-logged-in users or if they provide a different one
			type: String,
			trim: true,
			lowercase: true,
			match: [
				/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
				"Please fill a valid email address",
			],
		},
		user: {
			// Optional: if submitted by a logged-in user
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
		},
		status: {
			type: String,
			enum: [
				"new",
				"under_review",
				"planned",
				"in_progress",
				"implemented",
				"rejected",
				"closed",
			],
			default: "new",
		},
		// Add other fields as needed, e.g., screenshots, priority, admin notes
	},
	{
		timestamps: true, // Adds createdAt and updatedAt fields automatically
	}
);

// Optional: Add an index if you plan to query by user or status frequently
suggestionSchema.index({ user: 1, status: 1 });
suggestionSchema.index({ type: 1, category: 1, status: 1 });

const Suggestion = mongoose.model("Suggestion", suggestionSchema);

module.exports = Suggestion;

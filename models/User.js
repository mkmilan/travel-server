// server/models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema(
	{
		username: {
			type: String,
			required: [true, "Username is required"],
			unique: true,
			trim: true, // Removes whitespace from start/end
			minlength: [3, "Username must be at least 3 characters long"],
		},
		email: {
			type: String,
			required: [true, "Email is required"],
			unique: true,
			lowercase: true, // Converts email to lowercase
			trim: true,
			match: [
				// Basic email format validation
				/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
				"Please fill a valid email address",
			],
		},
		password: {
			type: String,
			required: [true, "Password is required"],
			minlength: [6, "Password must be at least 6 characters long"],
			select: false, // Password field won't be returned in queries by default
		},
		profilePictureUrl: {
			type: String,
			default: "", // Or path to a default avatar
		},
		bio: {
			type: String,
			maxlength: [160, "Bio cannot be more than 160 characters"],
			default: "",
		},
		// Array of User ObjectIds that this user follows
		following: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "User",
			},
		],
		// Array of User ObjectIds that follow this user
		followers: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "User",
			},
		],
		settings: {
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
				], // Added "" for unset
				default: "motorhome",
			},
			preferredUnits: {
				type: String,
				enum: ["metric", "imperial"],
				default: "metric",
			},
			themePreference: {
				type: String,
				enum: ["light", "dark", "system"],
				default: "system",
			},
			dateFormat: {
				type: String,
				enum: ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"],
				default: "YYYY-MM-DD", // ISO standard
			},
			timeFormat: {
				type: String,
				enum: ["12h", "24h"],
				default: "24h",
			},
		},
		// MongoDB automatically adds createdAt and updatedAt if timestamps: true
	},
	{
		timestamps: true, // Adds createdAt and updatedAt fields automatically
	}
);

// Pre-save middleware to hash password before saving
// Important: Use function() keyword here to access 'this' (the document)
userSchema.pre("save", async function (next) {
	// Only hash the password if it has been modified (or is new)
	if (!this.isModified("password")) {
		return next();
	}

	try {
		// Generate a salt
		const salt = await bcrypt.genSalt(10); // 10 rounds is generally recommended
		// Hash the password using the salt
		this.password = await bcrypt.hash(this.password, salt);
		next();
	} catch (error) {
		next(error); // Pass error to the next middleware/handler
	}
});

// Method to compare entered password with hashed password in DB
// Important: Use function() keyword here to access 'this' (the document)
userSchema.methods.matchPassword = async function (enteredPassword) {
	// 'this.password' refers to the hashed password in the document
	// Since password has 'select: false', it needs to be explicitly selected
	// in the query or accessed via 'this' inside a method like here.
	return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);

module.exports = User;

// server/controllers/authController.js
const User = require("../models/User");
const generateToken = require("../utils/generateToken");

// Helper function to set the token cookie
const sendTokenResponse = (user, statusCode, res) => {
	const token = generateToken(user._id);

	const options = {
		expires: new Date(
			Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000 // e.g., 30 days
		),
		httpOnly: true,
		secure: process.env.NODE_ENV === "production", // Only send over HTTPS in production
		sameSite: "Lax", // Or 'Strict' depending on your needs
		path: "/",
	};

	// Remove password from output
	const userResponse = {
		_id: user._id,
		username: user.username,
		email: user.email,
		profilePictureUrl: user.profilePictureUrl,
		bio: user.bio,
		following: user.following,
		followers: user.followers,
		settings: user.settings,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt, // Ensure updatedAt is included if needed
	};

	res.status(statusCode).cookie("token", token, options).json(userResponse);
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res, next) => {
	const { username, email, password } = req.body;

	// Basic validation (more robust validation can be added)
	if (!username || !email || !password) {
		res.status(400); // Bad Request
		// Use error handling middleware later, for now just send error
		return next(new Error("Please provide username, email, and password"));
	}

	try {
		// Check if user already exists (by email or username)
		const userExists = await User.findOne({ $or: [{ email }, { username }] });

		if (userExists) {
			res.status(400); // Bad Request
			const field = userExists.email === email ? "Email" : "Username";
			return next(new Error(`${field} already exists`));
		}

		// Create new user (password hashing is handled by pre-save hook in model)
		const user = await User.create({
			username,
			email,
			password,
		});

		if (user) {
			sendTokenResponse(user, 201, res);
			// // Generate token
			// const token = generateToken(user._id);

			// // Don't send back the password!
			// res.status(201).json({
			// 	// 201 Created
			// 	_id: user._id,
			// 	username: user.username,
			// 	email: user.email,
			// 	profilePictureUrl: user.profilePictureUrl,
			// 	bio: user.bio,
			// 	following: user.following,
			// 	followers: user.followers,
			// 	settings: user.settings,
			// 	token: token, // Send the token to the client
			// 	createdAt: user.createdAt,
			// });
		} else {
			res.status(400); // Bad Request
			return next(new Error("Invalid user data"));
		}
	} catch (error) {
		// Catch potential errors (e.g., database errors, validation errors from Mongoose)
		res.status(500); // Internal Server Error
		// Mongoose validation errors often have specific structures we could parse
		if (error.name === "ValidationError") {
			const messages = Object.values(error.errors).map((val) => val.message);
			res.status(400); // Override status to 400 for validation errors
			return next(new Error(messages.join(", ")));
		}
		return next(error); // Pass other errors to default error handler
	}
};

const loginUser = async (req, res, next) => {
	const { email, password } = req.body;

	// Basic validation
	if (!email || !password) {
		res.status(400); // Bad Request
		return next(new Error("Please provide email and password"));
	}

	try {
		// Find user by email
		const user = await User.findOne({ email }).select("+password");

		// Check if user exists AND password matches
		if (user && (await user.matchPassword(password))) {
			sendTokenResponse(user, 200, res);
			// const token = generateToken(user._id);

			// res.status(200).json({
			// 	_id: user._id,
			// 	username: user.username,
			// 	email: user.email,
			// 	profilePictureUrl: user.profilePictureUrl,
			// 	bio: user.bio,
			// 	following: user.following,
			// 	followers: user.followers,
			// 	settings: user.settings,
			// 	token: token,
			// 	createdAt: user.createdAt,
			// 	updatedAt: user.updatedAt,
			// });
		} else {
			// Authentication failed (user not found or password incorrect)
			res.status(401); // Unauthorized
			return next(new Error("Invalid email or password"));
		}
	} catch (error) {
		// Log the error for debugging but don't expose details to client
		console.error("Login error:", error);
		res.status(500);
		return next(new Error("An error occurred during login. Please try again."));
	}
};

const logoutUser = (req, res, next) => {
	res.cookie("token", "none", {
		expires: new Date(Date.now() + 10 * 1000), // Expire in 10 seconds
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "Lax",
		path: "/",
	});
	res.status(200).json({ success: true, data: {} });
};

const getMe = async (req, res, next) => {
	// The user object is attached to req by the protect middleware
	// We already fetched the user and excluded the password in the middleware
	const user = req.user;

	if (user) {
		res.status(200).json({
			_id: user._id,
			username: user.username,
			email: user.email,
			profilePictureUrl: user.profilePictureUrl,
			bio: user.bio,
			following: user.following,
			followers: user.followers,
			settings: user.settings,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		});
	} else {
		// This case should technically be handled by the middleware already,
		// but adding a check here provides an extra layer.
		res.status(404); // Not Found
		next(new Error("User not found"));
	}
	// No need for try/catch here typically, as errors (like user not found
	// after token validation) should be caught by the middleware or are programmer errors.
};

module.exports = {
	registerUser,
	loginUser,
	logoutUser,
	getMe,
};

// server/controllers/authController.js
const User = require("../models/User");
const generateToken = require("../utils/generateToken");

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
			// Generate token
			const token = generateToken(user._id);

			// Respond with user data and token
			// Don't send back the password!
			res.status(201).json({
				// 201 Created
				_id: user._id,
				username: user.username,
				email: user.email,
				profilePictureUrl: user.profilePictureUrl,
				bio: user.bio,
				following: user.following,
				followers: user.followers,
				token: token, // Send the token to the client
				createdAt: user.createdAt,
			});
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
		// Explicitly select the password field because it's set to `select: false` in the model
		const user = await User.findOne({ email }).select("+password");

		// Check if user exists AND if password matches
		if (user && (await user.matchPassword(password))) {
			// User authenticated successfully
			const token = generateToken(user._id);

			// Respond with user data and token
			res.status(200).json({
				// 200 OK
				_id: user._id,
				username: user.username,
				email: user.email,
				profilePictureUrl: user.profilePictureUrl,
				bio: user.bio,
				following: user.following,
				followers: user.followers,
				token: token,
				createdAt: user.createdAt,
				updatedAt: user.updatedAt, // Include updatedAt if needed
			});
		} else {
			// Authentication failed (user not found or password incorrect)
			res.status(401); // Unauthorized
			return next(new Error("Invalid email or password"));
		}
	} catch (error) {
		// Catch potential errors
		res.status(500); // Internal Server Error
		return next(error);
	}
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
	getMe,
};

// server/controllers/authController.js
const User = require("../models/User");
const generateToken = require("../utils/generateToken");
const sendEmail = require("../utils/sendEmail");
const crypto = require("crypto");
dotenv = require("dotenv");
dotenv.config();

// Helper function to set the token cookie
const sendTokenResponse = (user, statusCode, res) => {
	const token = generateToken(user._id);

	const cookieOptions = {
		expires: new Date(
			Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000 // e.g., 30 days
		),
		httpOnly: true,
		secure: process.env.NODE_ENV === "production", // true in production
		sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", // Important for cross-domain
		path: "/",
		// domain:
		// 	process.env.NODE_ENV === "production"
		// 		? ".onrender.com" // Adjust if your backend domain is different
		// 		: "localhost",
	};
	// Only set domain for localhost. For production, let the browser default it.
	if (process.env.NODE_ENV !== "production") {
		cookieOptions.domain = "localhost";
	}
	// Remove password from output
	const userResponse = {
		_id: user._id,
		username: user.username,
		email: user.email,
		isEmailVerified: user.isEmailVerified,
		profilePictureUrl: user.profilePictureUrl,
		bio: user.bio,
		following: user.following,
		followers: user.followers,
		settings: user.settings,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt, // Ensure updatedAt is included if needed
	};

	res
		.status(statusCode)
		.cookie("token", token, cookieOptions)
		.json(userResponse);
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res, next) => {
	console.log("Register attempt:", req.body.email);
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
		console.log("Creating user in DB:", username, email);
		const user = await User.create({
			username,
			email,
			password,
		});

		const verificationToken = crypto.randomBytes(32).toString("hex");
		user.emailVerificationToken = crypto
			.createHash("sha256")
			.update(verificationToken)
			.digest("hex");
		user.emailVerificationExpires = Date.now() + 1440 * 60 * 1000; // Token expires in 24 hours

		await user.save({ validateBeforeSave: false });

		// Determine Client URL based on environment
		const clientBaseUrl =
			process.env.NODE_ENV === "production"
				? process.env.PUBLIC_SITE_URL
				: process.env.FRONTEND_URL;
		// Construct verification URL (adjust CLIENT_URL as needed)
		const verificationUrl = `${
			clientBaseUrl || "http://localhost:3000"
		}/verify-email/${verificationToken}`;
		console.log("Verification URL created:", verificationUrl);
		const message = `
   <p>Please verify your email address by clicking the link below:</p>
   <p><a href="${verificationUrl}">Verify Email</a></p>
   <p>If you did not create an account, please ignore this email.</p>
 `;

		try {
			console.log("Attempting to send verification email to:", user.email);
			await sendEmail({
				email: user.email,
				subject: "Email Verification - Your App Name",
				html: message,
				text: `Please verify your email address by copying and pasting this URL into your browser: ${verificationUrl}`,
			});
			console.log("Verification email 'sent' (logged in dev) to:", user.email);
			res.status(201).json({
				success: true,
				message: `An email has been sent to ${user.email} with further instructions. Please verify your email to log in.`,
			});
		} catch (err) {
			console.error("Error sending verification email:", err);
			// Rollback user creation or mark user as unverified if email fails?
			// For now, we'll clear the token fields so it can be resent or handled.
			user.emailVerificationToken = undefined;
			user.emailVerificationExpires = undefined;
			await user.save({ validateBeforeSave: false });
			return next(
				new Error(
					"Email could not be sent. Please try registering again later."
				)
			);
		}
	} catch (error) {
		console.error(
			"Error in registerUser (outer catch):",
			error.message,
			error.stack
		);
		res.status(500);
		if (error.name === "ValidationError") {
			const messages = Object.values(error.errors).map((val) => val.message);
			res.status(400);
			return next(new Error(messages.join(", ")));
		}
		return next(error);
	}
};

// @desc    Verify email address
// @route   GET /api/auth/verifyemail/:token
// @access  Public
const verifyEmail = async (req, res, next) => {
	const { token } = req.params;

	if (!token) {
		res.status(400);
		return next(new Error("Verification token is required."));
	}

	// Hash the incoming token to match the one stored in the DB
	const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

	try {
		const user = await User.findOne({
			emailVerificationToken: hashedToken,
			emailVerificationExpires: { $gt: Date.now() }, // Check if token is not expired
		});

		if (!user) {
			res.status(400);
			return next(new Error("Invalid or expired verification token."));
		}

		// Mark email as verified and clear token fields
		user.isEmailVerified = true;
		user.emailVerificationToken = undefined;
		user.emailVerificationExpires = undefined;
		await user.save({ validateBeforeSave: false });

		// Log the user in by sending a token response
		sendTokenResponse(user, 200, res);
	} catch (error) {
		console.error("Email verification error:", error);
		res.status(500);
		return next(
			new Error(
				"An error occurred during email verification. Please try again."
			)
		);
	}
};

// @desc    Forgot password - Get reset token
// @route   POST /api/auth/forgotpassword
// @access  Public
const forgotPassword = async (req, res, next) => {
	const { email } = req.body;

	if (!email) {
		res.status(400);
		return next(new Error("Please provide an email address."));
	}

	try {
		const user = await User.findOne({ email });

		if (!user) {
			// Important: Don't reveal if the user exists or not for security reasons
			// Send a generic success-like message even if user not found
			res.status(200).json({
				success: true,
				message:
					"If an account with that email exists, a password reset link has been sent.",
			});
			// We return here to prevent further processing but still send a 200
			// This avoids leaking information about which emails are registered.
			return;
		}

		// Generate reset token
		const resetToken = crypto.randomBytes(32).toString("hex");

		// Hash token and set to resetPasswordToken field
		user.passwordResetToken = crypto
			.createHash("sha256")
			.update(resetToken)
			.digest("hex");

		// Set token expire time (e.g., 10 minutes)
		user.passwordResetExpires = Date.now() + 10 * 60 * 1000;

		await user.save({ validateBeforeSave: false });

		// Determine Client URL based on environment
		const clientBaseUrl =
			process.env.NODE_ENV === "production"
				? process.env.PUBLIC_SITE_URL
				: process.env.FRONTEND_URL;

		// Create reset URL
		const resetUrl = `${
			clientBaseUrl || "http://localhost:3000" // Fallback if somehow undefined
		}/reset-password/${resetToken}`;

		const message = `
    <p>You are receiving this email because you (or someone else) has requested the reset of a password for your account.</p>
    <p>Please click on the following link, or paste this into your browser to complete the process within 10 minutes of receiving it:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
  `;

		try {
			await sendEmail({
				email: user.email,
				subject: "Password Reset Request - Your App Name",
				html: message,
				text: `To reset your password, please use the following link within 10 minutes: ${resetUrl}`,
			});

			res.status(200).json({
				success: true,
				message:
					"If an account with that email exists, a password reset link has been sent.",
			});
		} catch (err) {
			console.error("Error sending password reset email:", err);
			// Clear the token fields if email sending fails, so user can try again
			user.passwordResetToken = undefined;
			user.passwordResetExpires = undefined;
			await user.save({ validateBeforeSave: false });

			return next(
				new Error("Email could not be sent. Please try again later.")
			);
		}
	} catch (error) {
		console.error("Forgot password error:", error);
		// Send a generic error to avoid leaking info
		return next(
			new Error(
				"An error occurred while attempting to reset password. Please try again."
			)
		);
	}
};

// @desc    Reset password
// @route   PUT /api/auth/resetpassword/:token
// @access  Public
const resetPassword = async (req, res, next) => {
	const { token } = req.params;
	const { password } = req.body;

	if (!password) {
		res.status(400);
		return next(new Error("Please provide a new password."));
	}
	if (password.length < 6) {
		res.status(400);
		return next(new Error("Password must be at least 6 characters long."));
	}

	// Hash the incoming token to match the one stored in the DB
	const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

	try {
		const user = await User.findOne({
			passwordResetToken: hashedToken,
			passwordResetExpires: { $gt: Date.now() }, // Check if token is not expired
		});

		if (!user) {
			res.status(400);
			return next(new Error("Invalid or expired password reset token."));
		}

		// Set new password (pre-save hook in User model will hash it)
		user.password = password;
		// Clear reset token fields
		user.passwordResetToken = undefined;
		user.passwordResetExpires = undefined;
		// Mark email as verified if it wasn't already (optional, but good if they reset via email)
		// user.isEmailVerified = true;

		await user.save(); // This will trigger the pre-save hook to hash the new password

		// Optionally, log the user in by sending a token response
		// sendTokenResponse(user, 200, res);
		// For now, just send success and let them log in manually
		res.status(200).json({
			success: true,
			message: "Password has been reset successfully. You can now log in.",
		});
	} catch (error) {
		console.error("Reset password error:", error);
		if (error.name === "ValidationError") {
			const messages = Object.values(error.errors).map((val) => val.message);
			res.status(400);
			return next(new Error(messages.join(", ")));
		}
		res.status(500);
		return next(
			new Error(
				"An error occurred while resetting the password. Please try again."
			)
		);
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
		const user = await User.findOne({ email }).select(
			"+password +isEmailVerified"
		); // Also select isEmailVerified

		if (!user) {
			res.status(401);
			return next(new Error("Invalid email or password"));
		}

		// Check if email is verified before allowing login
		if (!user.isEmailVerified) {
			// Optionally, you could resend the verification email here or prompt the user
			// For now, just a generic message.
			res.status(403); // Forbidden
			return next(
				new Error(
					"Email not verified. Please check your email for a verification link."
				)
			);
		}

		if (await user.matchPassword(password)) {
			sendTokenResponse(user, 200, res);
		} else {
			res.status(401);
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
	const cookieOptions = {
		expires: new Date(Date.now() + 10 * 1000), // Expire in 10 seconds
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", // Match sendTokenResponse
		path: "/",
	};
	// Only set domain for localhost. For production, let the browser default it.
	if (process.env.NODE_ENV !== "production") {
		cookieOptions.domain = "localhost";
	}
	res.cookie("token", "none", cookieOptions);
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
	verifyEmail,
	forgotPassword,
	resetPassword,
};

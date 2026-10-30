// server/controllers/authController.js
const User = require("../models/User");
const generateToken = require("../utils/generateToken");
const sendEmail = require("../utils/sendEmail");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { sendVerificationEmail } = require("../services/emailVerification");
const dotenv = require("dotenv");
const { body } = require("express-validator");
const { validate } = require("../middleware/validate");
dotenv.config();

// Helper function to set the token cookie
const sendTokenResponse = (user, statusCode, res) => {
	const token = generateToken(user._id, user.sessionVersion);

	const cookieOptions = {
		expires: new Date(
			Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000 // e.g., 30 days
		),
		httpOnly: true,
		secure: process.env.NODE_ENV === "production", // true in production
		sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
		// sameSite: process.env.NODE_ENV === "production" ? "None" : "None", //if mobile dont work it need to be "None"
		path: "/",
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
		.json({ ...userResponse, token });
	// .json(userResponse);
};

// --- Validation Rules ---

const registerUserValidations = [
	body("username")
		.trim()
		.notEmpty()
		.withMessage("Username is required.")
		.isLength({ min: 3 })
		.withMessage("Username must be at least 3 characters long."),
	// No longer checking for username uniqueness here, as per new requirement
	body("email")
		.trim()
		.notEmpty()
		.withMessage("Email is required.")
		.isEmail()
		.withMessage("Please provide a valid email address.")
		.normalizeEmail()
		.custom(async (value) => {
			const user = await User.findOne({ email: value });
			if (user) {
				return Promise.reject("Email already exists.");
			}
		}),
	body("password")
		.notEmpty()
		.withMessage("Password is required.")
		.isLength({ min: 6 })
		.withMessage("Password must be at least 6 characters long."),
];

const loginUserValidations = [
	body("email")
		.trim()
		.notEmpty()
		.withMessage("Email is required.")
		.isEmail()
		.withMessage("Please provide a valid email address.")
		.normalizeEmail(),
	body("password").notEmpty().withMessage("Password is required."),
];

const forgotPasswordValidations = [
	body("email")
		.trim()
		.notEmpty()
		.withMessage("Email is required.")
		.isEmail()
		.withMessage("Please provide a valid email address.")
		.normalizeEmail(),
];

const resetPasswordValidations = [
	body("password")
		.notEmpty()
		.withMessage("Please provide a new password.")
		.isLength({ min: 6 })
		.withMessage("Password must be at least 6 characters long."),
];

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = [
	validate(registerUserValidations),
	async (req, res, next) => {
		const { username, email, password } = req.body;
		console.log("Register attempt:", req.body.email);
		try {
			// Check if user already exists (by email or username)
			// const userExists = await User.findOne({ $or: [{ email }, { username }] });

			// if (userExists) {
			// 	res.status(400); // Bad Request
			// 	const field = userExists.email === email ? "Email" : "Username";
			// 	return next(new Error(`${field} already exists`));
			// }

			// Create new user (password hashing is handled by pre-save hook in model)
			// console.log("Creating user in DB:", username, email);
			const user = await User.create({
				username,
				email,
				password,
			});

			try {
				await sendVerificationEmail(user);
				res.status(201).json({
					success: true,
					message: `An email has been sent to ${user.email}. Verify your email to log in. If it does not arrive, log in after one minute to send another link.`,
				});
			} catch (err) {
				res.status(503);
				return next(new Error("Your account was created, but the verification email could not be confirmed. Check your inbox, or log in after one minute to send another link."));
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
	},
];
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
		const user = await User.findOneAndUpdate({
			emailVerificationToken: hashedToken,
			emailVerificationExpires: { $gt: Date.now() },
		}, { $set: { isEmailVerified: true }, $unset: { emailVerificationToken: "", emailVerificationExpires: "" } }, { new: true }).select("+sessionVersion");

		if (!user) {
			res.status(400);
			return next(new Error("Invalid or expired verification token."));
		}


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
const forgotPassword = [
	validate(forgotPasswordValidations),
	async (req, res, next) => {
		const { email } = req.body;

		if (!email) {
			res.status(400);
			return next(new Error("Please provide an email address."));
		}

		try {
			const user = await User.findOne({ email });
			console.log("Forgot password attempt:", email);

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
			user.passwordResetExpires =
				Date.now() +
				process.env.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES * 60 * 1000;

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
					subject: "Password Reset Request - Motorhome Mapper",
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
	},
];
// @desc    Reset password
// @route   PUT /api/auth/resetpassword/:token
// @access  Public
const resetPassword = [
	validate(resetPasswordValidations),
	async (req, res, next) => {
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
			// Hash before the conditional write, then consume the token once. Save
			// hooks do not run for update queries, so hashing is explicit here.
			const hashedPassword = await bcrypt.hash(password, 10);
			const user = await User.findOneAndUpdate({
				passwordResetToken: hashedToken,
				passwordResetExpires: { $gt: Date.now() },
			}, {
				$set: { password: hashedPassword, sessionVersion: crypto.randomUUID() },
				$unset: { passwordResetToken: "", passwordResetExpires: "" },
			}, { new: true, runValidators: true });
			if (!user) {
				res.status(400);
				return next(new Error("Invalid or expired password reset token."));
			}

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
	},
];

const loginUser = [
	validate(loginUserValidations),
	async (req, res, next) => {
		const { email, password } = req.body;

		// Basic validation
		if (!email || !password) {
			res.status(400); // Bad Request
			return next(new Error("Please provide email and password"));
		}

		try {
			const user = await User.findOne({ email }).select(
				"+password +isEmailVerified +sessionVersion"
			); // Also select isEmailVerified

			if (!user) {
				res.status(401);
				return next(new Error("Invalid email or password"));
			}

			// Never reveal verification state or trigger email without the password.
			if (!(await user.matchPassword(password))) {
				res.status(401);
				return next(new Error("Invalid email or password"));
			}
			if (!user.isEmailVerified) {
				try {
					const sent = await sendVerificationEmail(user);
					res.status(403);
					return next(new Error(sent
						? "Email not verified. A new verification link has been sent. Check your inbox and spam folder, then log in."
						: "Email not verified. Check your inbox and spam folder. You can log in again after one minute to send another link."));
				} catch (error) {
					res.status(503);
					return next(new Error("The verification email could not be confirmed. Check your inbox, or log in again after one minute to retry."));
				}
			}
			sendTokenResponse(user, 200, res);
		} catch (error) {
			// Log the error for debugging but don't expose details to client
			console.error("Login error:", error);
			res.status(500);
			return next(
				new Error("An error occurred during login. Please try again.")
			);
		}
	},
];

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

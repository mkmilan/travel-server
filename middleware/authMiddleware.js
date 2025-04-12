// server/middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User"); // Adjust path if your models folder is elsewhere

const protect = async (req, res, next) => {
	let token;

	// Check if the Authorization header exists and starts with 'Bearer'
	if (
		req.headers.authorization &&
		req.headers.authorization.startsWith("Bearer")
	) {
		try {
			// Get token from header (split 'Bearer TOKEN' string)
			token = req.headers.authorization.split(" ")[1];

			// Verify token using the secret
			const decoded = jwt.verify(token, process.env.JWT_SECRET);

			// Get user ID from the decoded token payload (we stored it as 'id')
			// Fetch user from DB, excluding the password field
			req.user = await User.findById(decoded.id).select("-password");

			if (!req.user) {
				// Handle case where token is valid but user doesn't exist anymore
				res.status(401);
				throw new Error("Not authorized, user not found");
			}

			// User is authenticated, proceed to the next middleware/route handler
			next();
		} catch (error) {
			console.error("Token verification failed:", error);
			res.status(401); // Unauthorized
			// Handle specific JWT errors (optional)
			if (error.name === "JsonWebTokenError") {
				next(new Error("Not authorized, token failed (invalid)"));
			} else if (error.name === "TokenExpiredError") {
				next(new Error("Not authorized, token expired"));
			} else {
				// General error from try block (e.g., user not found error thrown above)
				next(new Error("Not authorized, token failed"));
			}
		}
	}

	// If no token is found in the header
	if (!token) {
		res.status(401); // Unauthorized
		next(new Error("Not authorized, no token"));
	}
};

module.exports = { protect };

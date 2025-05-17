// server/utils/generateToken.js
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
dotenv.config();

const generateToken = (userId) => {
	return jwt.sign(
		{ id: userId }, // Payload: typically includes user ID
		process.env.JWT_SECRET, // Your secret key from .env
		{ expiresIn: `${process.env.JWT_COOKIE_EXPIRE}d` } // Token expiration time (e.g., 30 days)
	);
};

module.exports = generateToken;

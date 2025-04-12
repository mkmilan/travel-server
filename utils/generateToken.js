// server/utils/generateToken.js
const jwt = require("jsonwebtoken");

const generateToken = (userId) => {
	return jwt.sign(
		{ id: userId }, // Payload: typically includes user ID
		process.env.JWT_SECRET, // Your secret key from .env
		{ expiresIn: "30d" } // Token expiration time (e.g., 30 days)
	);
};

module.exports = generateToken;

const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
dotenv.config();

const generateRefreshToken = (userId) => {
	return jwt.sign({ id: userId }, process.env.REFRESH_TOKEN_SECRET, {
		expiresIn: `${process.env.REFRESH_TOKEN_COOKIE_EXPIRE_DAYS}d`,
	});
};

module.exports = generateRefreshToken;

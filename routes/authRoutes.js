// server/routes/authRoutes.js
const express = require("express");
const {
	registerUser,
	loginUser,
	getMe,
} = require("../controllers/authController"); // Import controller functions
const { protect } = require("../middleware/authMiddleware"); // Import auth middleware

const router = express.Router();

// Define the registration route
// POST /api/auth/register
router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", protect, getMe); // Protect runs first, then getMe
// We'll add login and getMe routes here later
// router.get('/me', protect, getMe); // 'protect' will be our auth middleware

module.exports = router;

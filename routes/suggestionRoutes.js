const express = require("express");
const { submitSuggestion } = require("../controllers/suggestionController");
const { protectOptional, protected } = require("../middleware/authMiddleware"); // Use protectOptional if guests can submit

const router = express.Router();

// Route for submitting new suggestions/bugs
// protectOptional allows guests to submit, but req.user will be populated if logged in.
// If only logged-in users can submit, use 'protect' middleware instead.
router.post("/", protectOptional, submitSuggestion);

// Future routes for admin:
// router.get("/", protect, adminOnly, getAllSuggestions);
// router.put("/:id/status", protect, adminOnly, updateSuggestionStatus);

module.exports = router;

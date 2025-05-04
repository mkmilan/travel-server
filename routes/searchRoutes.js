// filepath: /home/mkmilan/Documents/my/travel-2/server/routes/searchRoutes.js
const express = require("express");
const { performSearch } = require("../controllers/searchController");
const { protectOptional } = require("../middleware/authMiddleware"); // Use optional auth

const router = express.Router();

// GET /api/search?q=...&type=...
// Use optional protection in case we want to personalize results later (e.g., hide own content)
// or check follow status server-side. For now, it just adds req.user if logged in.
router.get("/", protectOptional, performSearch);

module.exports = router;

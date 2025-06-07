const express = require("express");
const { protect, protectOptional } = require("../middleware/authMiddleware");

const { performSearchJson, searchUsers } = require("../controllers/searchJsonController");
const router = express.Router();

// Public endpoint.  Add `protect` middleware if you want it gated later.
router.get("/", performSearchJson);
router.get("/users", protectOptional, searchUsers);

module.exports = router;

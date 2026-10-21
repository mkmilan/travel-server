// server/routes/photoRoutes.js
const express = require("express");
const { getPhotoById } = require("../controllers/photoController");

const router = express.Router();

// GET /api/photos/:photoId - Stream photo content
// router.get("/photos/:photoId", getPhotoById);
const { protectOptional } = require("../middleware/authMiddleware");
const mediaAccess = require("../middleware/mediaAccess").defaultMediaAccess();
router.get("/:photoId", protectOptional, mediaAccess.photo, getPhotoById);

module.exports = router;

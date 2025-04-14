// server/routes/photoRoutes.js
const express = require("express");
const { getPhotoById } = require("../controllers/photoController");

const router = express.Router();

// GET /api/photos/:photoId - Stream photo content
router.get("/:photoId", getPhotoById);

module.exports = router;

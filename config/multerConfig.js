// filepath: /home/mkmilan/Documents/my/travel-2/server/config/multerConfig.js
const multer = require("multer");
const path = require("path");

// --- Storage Configuration ---
const storage = multer.memoryStorage();

// --- File Filter ---

const imageFileFilter = (req, file, cb) => {
	const filetypes = /jpeg|jpg|png|gif|webp/;
	const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
	const mimetype = filetypes.test(file.mimetype);

	if (mimetype && extname) {
		return cb(null, true);
	} else {
		cb(new Error("Error: Images Only! (jpeg, jpg, png, gif, webp)"), false);
	}
};

// --- Multer Upload Instance ---
const upload = multer({
	storage: storage, // Use memory storage
	limits: {
		fileSize: 1024 * 1024 * 10,
	},
	fileFilter: imageFileFilter,
});

const uploadSinglePhoto = upload.single("photo");
const uploadMultiplePhotos = upload.array("photos", 5);

module.exports = {
	uploadSinglePhoto,
	uploadMultiplePhotos,
};

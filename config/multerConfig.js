// server/config/multerConfig.js
const multer = require("multer");
const path = require("path");
const fs = require("fs"); // File system module

// Define upload directory (make sure it exists)
const uploadDir = path.join(__dirname, "../uploads"); // Create an 'uploads' folder in server root
if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir);
	console.log(`Created upload directory: ${uploadDir}`);
}

// --- Storage Configuration ---
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, uploadDir); // Save files to the 'uploads/' directory
	},
	filename: function (req, file, cb) {
		// Create a unique filename: fieldname-timestamp.extension
		const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
		cb(
			null,
			file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
		);
	},
});

// --- File Filter ---
// Only allow specific image types
const imageFileFilter = (req, file, cb) => {
	// Allowed ext
	const filetypes = /jpeg|jpg|png|gif|webp/;
	// Check ext
	const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
	// Check mime type
	const mimetype = filetypes.test(file.mimetype);

	if (mimetype && extname) {
		return cb(null, true); // Accept file
	} else {
		cb(new Error("Error: Images Only! (jpeg, jpg, png, gif, webp)"), false); // Reject file
	}
};

// --- Multer Upload Instance ---
const upload = multer({
	storage: storage,
	limits: {
		fileSize: 1024 * 1024 * 10, // Limit file size (e.g., 10MB)
	},
	fileFilter: imageFileFilter,
});

// Middleware function to handle single file upload named 'photo'
// Adjust 'photo' if your form field name is different
const uploadSinglePhoto = upload.single("photo");

// Middleware function to handle multiple files upload named 'photos' (e.g., up to 5)
// Adjust 'photos' if your form field name is different
const uploadMultiplePhotos = upload.array("photos", 5); // Example: max 5 photos

module.exports = {
	uploadSinglePhoto,
	uploadMultiplePhotos,
	uploadDir, // Export directory path if needed elsewhere (e.g., for cleanup)
};

// server/controllers/photoController.js
const mongoose = require("mongoose");
const storageService = require("../services/storageService");
const { GridFSBucket, ObjectId } = require("mongodb");

let gfs; // Reuse gfs instance if initialized elsewhere (like in storageService or server.js)
// Ensure GFS is initialized after DB connection
mongoose.connection.once("open", () => {
	if (!gfs) {
		gfs = new GridFSBucket(mongoose.connection.db, {
			bucketName: "gpxUploads", // Ensure this matches storageService bucket name
		});
		console.log("[Photo Controller] GridFSBucket initialized.");
	}
});
mongoose.connection.on("error", (err) => {
	console.error("[Photo Controller] MongoDB connection error:", err);
	gfs = null; // Reset gfs on connection error
});

/**
 * @desc    Get a photo file by its GridFS ID
 * @route   GET /api/photos/:photoId
 * @access  Public
 */
const getPhotoById = async (req, res, next) => {
	const { photoId } = req.params;
	let fileId;
	console.log("Photo ID from request:", photoId);

	// Validate ObjectId format
	try {
		fileId = new ObjectId(photoId);
	} catch (formatError) {
		res.status(400);
		return next(new Error(`Invalid Photo ID format: ${photoId}`));
	}

	if (!gfs) {
		// Check if gfs is initialized
		console.error("[Photo Controller] GridFSBucket not available.");
		return next(new Error("Storage service is not ready."));
	}

	try {
		// --- Check file existence and get metadata (including contentType) ---
		console.log(`[Photo Controller] Searching for file with ID: ${fileId}`);
		const files = await gfs.find({ _id: fileId }).limit(1).toArray();

		if (!files || files.length === 0) {
			console.warn(`[Photo Controller] File not found: ${photoId}`);
			const error = new Error(`Photo not found: ${photoId}`);
			error.statusCode = 404;
			return next(error); // Use next for error handling
		}

		const fileInfo = files[0];
		// Use contentType from metadata, default if missing
		const contentType = fileInfo.contentType || "application/octet-stream";

		console.log(
			`[Photo Controller] Found file ${fileInfo.filename} (${contentType}). Streaming...`
		);

		// --- Set Headers ---
		res.setHeader("Content-Type", contentType);
		// Optional: Caching headers (adjust max-age as needed)
		res.setHeader("Cache-Control", "public, max-age=604800"); // Cache for 1 week

		// --- Get Stream and Pipe ---
		// Use storageService.getFileStream which should internally use gfs.openDownloadStream
		const downloadStream = storageService.getFileStream(photoId);

		// Error handling for the stream itself
		downloadStream.on("error", (streamError) => {
			console.error(
				`[Photo Controller] Error during stream pipe for ${photoId}:`,
				streamError
			);
			// If headers aren't sent, let the global handler deal with it
			if (!res.headersSent) {
				const error = new Error(
					`Error streaming photo: ${streamError.message}`
				);
				error.statusCode = 500;
				next(error);
			} else {
				// If headers are sent, we can only try to end the connection
				console.warn(
					`[Photo Controller] Headers sent, ending response for ${photoId} due to stream error.`
				);
				res.end();
			}
		});

		// Pipe the stream to the response
		downloadStream.pipe(res);

		downloadStream.on("end", () => {
			console.log(`[Photo Controller] Finished streaming ${photoId}`);
		});
		downloadStream.on("close", () => {
			console.log(`[Photo Controller] Stream closed for ${photoId}`);
		});
	} catch (error) {
		// Catch errors from gfs.find or storageService.getFileStream setup
		console.error(
			`[Photo Controller] Error preparing photo download for ID ${photoId}:`,
			error
		);
		// Ensure status code is set if possible
		if (!error.statusCode) {
			error.statusCode = 500;
		}
		next(error); // Pass to global handler
	}
};

module.exports = { getPhotoById };

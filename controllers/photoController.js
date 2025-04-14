// server/controllers/photoController.js
const mongoose = require("mongoose");
const storageService = require("../services/storageService");

/**
 * @desc    Get a photo file by its GridFS ID
 * @route   GET /api/photos/:photoId
 * @access  Public
 */
const getPhotoById = async (req, res, next) => {
	const { photoId } = req.params;

	if (!photoId || photoId.length < 12) {
		// Basic check
		res.status(400);
		return next(new Error(`Invalid Photo ID format: ${photoId}`));
	}

	try {
		console.log(
			`[Photo Controller] Attempting to get stream for photo ID: ${photoId}`
		);
		const downloadStream = storageService.getFileStream(photoId);

		// --- Set up error handling FIRST ---
		let streamErrorOccurred = false; // Flag to track if error handler ran

		downloadStream.on("error", (streamError) => {
			streamErrorOccurred = true; // Set the flag
			console.error(
				`[Photo Controller] Error event on download stream for ${photoId}:`,
				streamError.message
			);

			// Don't try to send a response if headers are already sent (e.g., by a rapid pipe)
			if (res.headersSent) {
				console.warn(
					`[Photo Controller] Headers already sent for ${photoId}, cannot send error response.`
				);
				// Abort the response if possible/necessary
				res.socket?.destroy(); // Forcefully close connection if headers sent
				return;
			}

			// Determine appropriate status code based on the error
			let statusCode = 500;
			let errorMessage = `Could not retrieve photo: ${streamError.message}`;

			if (
				streamError.message &&
				(streamError.message.includes("GridFS file not found") ||
					streamError.message.includes("FileNotFound") ||
					streamError.code === "ENOENT")
			) {
				statusCode = 404;
				errorMessage = `Photo not found: ${photoId}`;
			}

			// Pass the error to the global error handler *with* the status code
			const error = new Error(errorMessage);
			error.statusCode = statusCode; // Attach status code to the error object
			next(error);
		});

		// --- Set Headers and Pipe AFTER attaching error handler ---
		// Assume success initially, the error handler will intervene if needed
		console.log(`[Photo Controller] Setting headers for ${photoId}`);
		// TODO: Fetch metadata to get correct Content-Type if possible/needed
		// const metadata = await getFileMetadata(photoId); // Hypothetical function
		// res.setHeader('Content-Type', metadata.contentType || 'image/jpeg');
		res.setHeader("Content-Type", "image/jpeg"); // Set a default for now
		// Optional: Content-Disposition for download behavior (remove if just displaying)
		// res.setHeader('Content-Disposition', `inline; filename="photo_${photoId}.jpg"`); // Suggest display inline

		console.log(`[Photo Controller] Piping stream to response for ${photoId}`);
		downloadStream.pipe(res);

		// Handle the 'end' event for logging success (optional)
		downloadStream.on("end", () => {
			console.log(
				`[Photo Controller] Successfully streamed photo file ${photoId}`
			);
		});

		// Handle the 'close' event (optional, indicates stream finished/closed)
		downloadStream.on("close", () => {
			console.log(`[Photo Controller] Download stream closed for ${photoId}`);
		});
	} catch (error) {
		// Catch errors from getFileStream itself (e.g., invalid ID format)
		console.error(
			`[Photo Controller] Error preparing photo download for ID ${photoId}:`,
			error
		);
		next(error); // Pass to global handler
	}
};

module.exports = { getPhotoById };

// server/services/storageService.js
const mongoose = require("mongoose");
// Ensure ObjectId is required from mongodb, not mongoose directly for GridFS operations
const { GridFSBucket, ObjectId } = require("mongodb");
const { Readable } = require("stream");

let gfs; // GridFSBucket instance

// Initialize GridFSBucket once the mongoose connection is open
mongoose.connection.once("open", () => {
	console.log("MongoDB connection open, initializing GridFSBucket...");
	try {
		gfs = new GridFSBucket(mongoose.connection.db, {
			bucketName: "gpxUploads", // Or your preferred bucket name
		});
		console.log("GridFSBucket initialized.");
	} catch (error) {
		console.error("Failed to initialize GridFSBucket:", error);
		// Set gfs to null or handle error appropriately
		gfs = null;
	}
});

// Handle potential errors after initial connection
mongoose.connection.on("error", (err) => {
	console.error("MongoDB connection error impacting GridFS:", err);
	gfs = null; // GridFS might become unusable
});

/**
 * Uploads file content (string or buffer) to MongoDB GridFS.
 * @param {string|Buffer} fileContent - The content of the file.
 * @param {string} filename - The desired filename for storage.
 * @param {object} [metadata={}] - Optional metadata to store with the file.
 * @returns {Promise<string>} - Promise resolving with the file ID (as a string).
 */
const uploadFile = (fileContent, filename, metadata = {}) => {
	return new Promise((resolve, reject) => {
		if (!gfs) {
			console.error("GridFSBucket not initialized during uploadFile.");
			return reject(new Error("Storage service not ready."));
		}

		const readableStream = new Readable();
		readableStream.push(fileContent);
		readableStream.push(null);

		console.log(`GridFS: Starting upload for filename: ${filename}`);
		const uploadStream = gfs.openUploadStream(filename, { metadata });

		uploadStream.once("finish", () => {
			const fileId = uploadStream.id;
			if (fileId) {
				console.log(
					`GridFS: Upload finished for ${filename}, File ID: ${fileId}`
				);
				resolve(fileId.toString());
			} else {
				console.error(
					`GridFS: Upload finished for ${filename}, but stream ID is missing.`
				);
				reject(new Error(`GridFS upload finished but file ID is missing.`));
			}
		});

		uploadStream.once("error", (err) => {
			console.error(`GridFS: Upload error for ${filename}:`, err);
			readableStream.unpipe(uploadStream); // Attempt to stop piping on error
			reject(new Error(`Failed to upload file to GridFS: ${err.message}`));
		});

		console.log(`GridFS: Piping content to upload stream for ${filename}`);
		readableStream.pipe(uploadStream);
	});
};

/**
 * Retrieves a file from GridFS as a readable stream.
 * @param {string} fileIdString - The GridFS file ID (as a string).
 * @returns {stream.Readable} - A readable stream for the file content.
 * @throws {Error} If storage service not ready, invalid ID, or file check fails.
 */
const getFileStream = (fileIdString) => {
	if (!gfs) {
		console.error("GridFSBucket not initialized during getFileStream.");
		throw new Error("Storage service not ready.");
	}

	let fileId;
	try {
		// Convert the string ID back to a MongoDB ObjectId
		fileId = new ObjectId(fileIdString);
	} catch (formatError) {
		console.error(
			`GridFS: Invalid ObjectId format during getFileStream for ID string ${fileIdString}:`,
			formatError
		);
		throw new Error(`Invalid file ID format: ${fileIdString}`);
	}

	console.log(
		`GridFS: Attempting to open download stream for file ID: ${fileIdString}`
	);
	// Create a download stream
	const downloadStream = gfs.openDownloadStream(fileId);

	// Attach error handler immediately to catch stream-related issues
	downloadStream.on("error", (err) => {
		// Handle errors during download (e.g., file chunk missing)
		console.error(
			`GridFS: Error event on download stream for ID ${fileIdString}:`,
			err
		);
		// Note: This might be emitted after the stream has been returned.
		// The calling function should also handle potential errors.
	});

	// Optional: Check file existence asynchronously before returning the stream
	// This helps catch "file not found" earlier in some cases.
	gfs
		.find({ _id: fileId })
		.limit(1)
		.toArray()
		.then((files) => {
			if (!files || files.length === 0) {
				console.error(
					`GridFS: File check - File not found for ID: ${fileIdString}`
				);
				// Emit an error on the stream if file not found during check
				downloadStream.emit(
					"error",
					new Error(`GridFS file not found: ${fileIdString}`)
				);
			} else {
				console.log(
					`GridFS: File check - Found file ${files[0].filename}, proceeding with download stream.`
				);
			}
		})
		.catch((findErr) => {
			console.error(
				`GridFS: Error during file existence check for ID ${fileIdString}:`,
				findErr
			);
			downloadStream.emit(
				"error",
				new Error(`Error checking GridFS file existence: ${fileIdString}`)
			);
		});

	return downloadStream;
};

/**
 * Deletes a file from GridFS by its ID.
 * Handles synchronous 'File not found' errors from the driver gracefully.
 * @param {string} fileIdString - The GridFS file ID (as a string).
 * @returns {Promise<void>}
 */
// FINAL ATTEMPT version for server/services/storageService.js -> deleteFile

const deleteFile = async (fileIdString) => {
	// Make the function async
	if (!gfs) {
		console.error("[DeleteFile] GridFSBucket not initialized.");
		throw new Error("Storage service not ready."); // Throw instead of reject for async/await
	}

	let fileId;
	try {
		fileId = new ObjectId(fileIdString);
	} catch (formatError) {
		console.error(
			`[DeleteFile] Invalid ObjectId format for ID string ${fileIdString}:`,
			formatError
		);
		throw new Error(`Invalid file ID format for deletion: ${fileIdString}`);
	}

	console.log(`[DeleteFile] Checking existence for ObjectId: ${fileId}`);

	try {
		// --- STEP 1: Check if the file exists FIRST ---
		const files = await gfs.find({ _id: fileId }).limit(1).toArray();

		if (!files || files.length === 0) {
			// File doesn't exist - this is success for a delete operation
			console.warn(
				`[DeleteFile] File not found for ID ${fileIdString}. Treating as successful deletion.`
			);
			return; // Return successfully (Promise resolves with undefined)
		}

		// --- STEP 2: File exists, attempt deletion ---
		console.log(
			`[DeleteFile] File found. Attempting gfs.delete for ID: ${fileIdString}`
		);
		// The GridFSBucket.delete method in some driver versions might not return a useful promise directly,
		// or might still rely on callbacks internally. Let's wrap it in a promise manually
		// if direct await doesn't work reliably across versions.

		// Attempt 1: Direct await (cleanest if driver supports it well)
		try {
			// Note: The exact return value or promise behavior of gfs.delete might vary.
			// We primarily care if it throws an error OTHER THAN "File not found" (which we already checked).
			await gfs.delete(fileId);
			console.log(
				`[DeleteFile] Successfully deleted file ID: ${fileIdString} (gfs.delete completed).`
			);
			// Promise resolves implicitly with undefined here
		} catch (deleteError) {
			// Catch errors specifically from gfs.delete
			console.error(
				`[DeleteFile] Error during gfs.delete for ID ${fileIdString}:`,
				deleteError
			);
			// We already know the file existed, so this is likely a real error
			throw new Error(
				`GridFS delete operation failed: ${
					deleteError.message || "Unknown delete error"
				}`
			);
		}
	} catch (error) {
		// Catch errors from the initial gfs.find or the delete attempt's promise/await
		console.error(`[DeleteFile] General error for ID ${fileIdString}:`, error);
		// Re-throw the error to be handled by the calling controller
		throw error; // Let the controller decide how to handle it
	}
};

module.exports = {
	uploadFile,
	getFileStream,
	deleteFile,
};

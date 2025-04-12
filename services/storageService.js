// server/services/storageService.js
const mongoose = require("mongoose");
const { GridFSBucket, ObjectId } = require("mongodb"); // Import GridFSBucket and ObjectId from the driver
const { Readable } = require("stream"); // Required to stream string data

let gfs; // GridFSBucket instance

// Initialize GridFSBucket once the connection is open
// We access the native MongoDB driver's connection via mongoose.connection
mongoose.connection.once("open", () => {
	console.log("MongoDB connection open, initializing GridFSBucket...");
	// The database object is accessed via mongoose.connection.db
	gfs = new GridFSBucket(mongoose.connection.db, {
		bucketName: "gpxUploads", // Collection name prefix for GridFS files/chunks
	});
	console.log("GridFSBucket initialized.");
});

mongoose.connection.on("error", (err) => {
	console.error("MongoDB connection error during GridFS setup:", err);
	// Handle potential loss of connection if needed
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
			// Handle case where connection isn't open yet or failed
			console.error("GridFSBucket not initialized. MongoDB connection issue?");
			return reject(new Error("Storage service not ready."));
		}

		// Create a readable stream from the string or buffer
		const readableStream = new Readable();
		readableStream.push(fileContent);
		readableStream.push(null); // Signal end of data

		console.log(`GridFS: Starting upload for filename: ${filename}`);
		const uploadStream = gfs.openUploadStream(filename, { metadata });

		// Handle events on the upload stream
		uploadStream.once("finish", () => {
			// The 'finish' event often doesn't pass the file object directly reliably
			console.log('GridFS: Upload stream "finish" event triggered.');

			// Access the file ID directly from the upload stream object's 'id' property
			const fileId = uploadStream.id;

			if (fileId) {
				console.log(
					`GridFS: Upload finished for ${filename}, File ID: ${fileId}`
				);
				resolve(fileId.toString()); // Resolve with the file ID as a string
			} else {
				// This should generally not happen if the upload truly finished without error,
				// but add logging just in case.
				console.error(
					`GridFS: Upload finished for ${filename}, but stream ID is missing.`
				);
				reject(new Error(`GridFS upload finished but file ID is missing.`));
			}
		});

		uploadStream.once("error", (err) => {
			console.error(`GridFS: Upload error for ${filename}:`, err);
			// Attempt to unpipe to prevent further data flow on error
			readableStream.unpipe(uploadStream);
			reject(new Error(`Failed to upload file to GridFS: ${err.message}`));
		});

		// Pipe the readable stream containing the file content into the GridFS upload stream
		readableStream.pipe(uploadStream);
	});
};

/**
 * Retrieves a file from GridFS as a readable stream.
 * @param {string} fileIdString - The GridFS file ID (as a string).
 * @returns {stream.Readable} - A readable stream for the file content.
 * @throws {Error} If file not found or invalid ID.
 */
const getFileStream = (fileIdString) => {
	if (!gfs) {
		console.error("GridFSBucket not initialized. MongoDB connection issue?");
		throw new Error("Storage service not ready.");
	}

	try {
		// Convert the string ID back to a MongoDB ObjectId
		const fileId = new ObjectId(fileIdString);
		console.log(`GridFS: Attempting to download file ID: ${fileIdString}`);

		// Create a download stream
		// Note: openDownloadStream *by name* is also possible, but ID is safer
		const downloadStream = gfs.openDownloadStream(fileId);

		downloadStream.on("error", (err) => {
			// Handle errors during download (e.g., file deleted after check)
			console.error(`GridFS: Error downloading file ID ${fileIdString}:`, err);
			// Note: This error event might not cover 'file not found' initially,
			// depending on driver version. The check below is safer.
			// The stream will emit an error if it can't find the file chunks.
		});

		// It's also good practice to check if the file exists before returning the stream
		// (though openDownloadStream will error eventually if it doesn't)
		gfs
			.find({ _id: fileId })
			.limit(1)
			.toArray()
			.then((files) => {
				if (!files || files.length === 0) {
					console.error(`GridFS: File not found for ID: ${fileIdString}`);
					// Emit an error on the stream *before* returning it if file not found
					downloadStream.emit(
						"error",
						new Error(`GridFS file not found: ${fileIdString}`)
					);
				} else {
					console.log(
						`GridFS: Found file ${files[0].filename}, creating download stream.`
					);
				}
			})
			.catch((findErr) => {
				console.error(
					`GridFS: Error checking file existence for ID ${fileIdString}:`,
					findErr
				);
				downloadStream.emit(
					"error",
					new Error(`Error checking GridFS file: ${fileIdString}`)
				);
			});

		return downloadStream;
	} catch (error) {
		// Catch errors like invalid ObjectId format
		console.error(
			`GridFS: Invalid file ID format or other error for ID ${fileIdString}:`,
			error
		);
		throw new Error(`Invalid file ID format or GridFS error: ${fileIdString}`);
	}
};

/**
 * Deletes a file from GridFS by its ID.
 * @param {string} fileIdString - The GridFS file ID (as a string).
 * @returns {Promise<void>}
 */
const deleteFile = async (fileIdString) => {
	return new Promise((resolve, reject) => {
		if (!gfs) {
			return reject(new Error("Storage service not ready."));
		}

		let fileId;
		try {
			fileId = new ObjectId(fileIdString);
		} catch (formatError) {
			return reject(new Error(`Invalid file ID format: ${fileIdString}`));
		}

		gfs
			.find({ _id: fileId })
			.limit(1)
			.toArray()
			.then((files) => {
				if (!files || files.length === 0) {
					// File doesn't exist, resolve successfully
					resolve();
					return;
				}

				gfs.delete(fileId, (deleteError) => {
					if (deleteError) {
						reject(new Error(`Failed to delete file: ${deleteError.message}`));
					} else {
						resolve();
					}
				});
			})
			.catch((findError) => {
				reject(
					new Error(`Error checking file existence: ${findError.message}`)
				);
			});
	});
};

module.exports = {
	uploadFile,
	getFileStream,
	deleteFile,
};

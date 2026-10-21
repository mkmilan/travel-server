// Never trust a caller-controlled document's file reference as proof of ownership.
function assertFileOwner(file, userId) {
	if (!userId || !file?.metadata?.userId || String(file.metadata.userId) !== String(userId)) {
		const error = new Error("File is not owned by this account");
		error.statusCode = 403;
		throw error;
	}
}
function createPhotoOwnership({ findFile, isValidId }) {
	return async function assertOwnedPhotos(ids, userId) {
		if (!Array.isArray(ids)) {
			const error = new Error("Photo IDs must be an array"); error.statusCode = 400; throw error;
		}
		for (const id of new Set(ids.map(String))) {
			if (!isValidId(id)) { const error = new Error("Invalid photo ID"); error.statusCode = 400; throw error; }
			const file = await findFile(id);
			assertFileOwner(file, userId);
			if (!String(file.contentType || file.metadata?.mimetype || "").startsWith("image/")) {
				const error = new Error("Referenced file is not a photo"); error.statusCode = 400; throw error;
			}
		}
	};
}
async function assertOwnedPhotos(ids, userId) {
	const mongoose = require("mongoose");
	return createPhotoOwnership({
		isValidId: mongoose.isObjectIdOrHexString,
		findFile(id) {
			if (!mongoose.connection.db) throw new Error("Storage service is not ready");
			return mongoose.connection.db.collection("gpxUploads.files").findOne({ _id: new mongoose.Types.ObjectId(id) });
		},
	})(ids, userId);
}
module.exports = { assertFileOwner, createPhotoOwnership, assertOwnedPhotos };

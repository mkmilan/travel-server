// File access must follow the owning trip's visibility, not merely a GridFS ID.
const sameId = (left, right) => left != null && right != null && String(left._id ?? left) === String(right._id ?? right);

function canReadTrip(trip, user) {
	if (!trip) return false;
	if (sameId(trip.user, user)) return true;
	if (trip.defaultTripVisibility === "public") return true;
	return trip.defaultTripVisibility === "followers_only" && !!user &&
		Array.isArray(trip.user?.followers) && trip.user.followers.some(id => sameId(id, user));
}

function createMediaAccess({ Trip, Recommendation, User, isValidId, getFileMetadata }) {
	const reject = res => res.status(404).json({ message: "File not found" });
	const tripQuery = query => query.select("user defaultTripVisibility gpxFileRef title")
		.populate("user", "followers");

	return {
		async tripGpx(req, res, next) {
			try {
				if (!isValidId(req.params.tripId)) return res.status(400).json({ message: "Invalid trip ID" });
				const trip = await tripQuery(Trip.findById(req.params.tripId));
				if (!trip?.gpxFileRef || !canReadTrip(trip, req.user)) return reject(res);
				req.mediaTrip = trip;
				res.setHeader("Cache-Control", "private, no-store");
				return next();
			} catch (error) { return next(error); }
		},
		async photo(req, res, next) {
			try {
				const id = req.params.photoId;
				if (!isValidId(id)) return res.status(400).json({ message: "Invalid photo ID" });
				// Trip photos, recommendation photos and public avatars use the same bucket.
				// Never expose orphan files or rely on potentially stale upload metadata.
				const metadata = await getFileMetadata(id);
				if (!metadata?.userId) return reject(res);
				// Storage metadata is server-written. A client-supplied recommendation
				// reference must never reclassify another user's private upload.
				const trips = await tripQuery(Trip.find({ photos: id, user: metadata.userId }));
				if (metadata.tripId) {
					const sourceTrip = trips.find(trip => sameId(trip, metadata.tripId));
					if (!sourceTrip || !canReadTrip(sourceTrip, req.user)) return reject(res);
					res.setHeader("Cache-Control", "private, no-store");
					return next();
				}
				let allowed = trips.some(trip => canReadTrip(trip, req.user));
				if (!allowed) {
					const recommendations = await Recommendation.find({ photos: id, user: metadata.userId }).select("associatedTrip");
					for (const recommendation of recommendations) {
						// Standalone recommendations are publicly readable in this app.
						if (!recommendation.associatedTrip) { allowed = true; break; }
						const trip = await tripQuery(Trip.findById(recommendation.associatedTrip));
						if (canReadTrip(trip, req.user)) { allowed = true; break; }
					}
				}
				if (!allowed) allowed = !!(await User.exists({ _id: metadata.userId, profilePictureUrl: id }));
				if (!allowed) return reject(res);
				// Visibility can change after upload. Do not leave formerly public media in caches.
				res.setHeader("Cache-Control", "private, no-store");
				return next();
			} catch (error) { return next(error); }
		},
	};
}

function defaultMediaAccess() {
	return createMediaAccess({
		Trip: require("../models/Trip"),
		Recommendation: require("../models/Recommendation"),
		User: require("../models/User"),
		isValidId: require("mongoose").isObjectIdOrHexString,
		async getFileMetadata(id) {
			const mongoose = require("mongoose");
			if (!mongoose.connection.db) throw new Error("Storage service is not ready");
			const file = await mongoose.connection.db.collection("gpxUploads.files").findOne(
				{ _id: new mongoose.Types.ObjectId(id) }, { projection: { metadata: 1 } }
			);
			return file?.metadata;
		},
	});
}

module.exports = { canReadTrip, createMediaAccess, defaultMediaAccess };

const turf = require("@turf/turf");
const Trip = require("../models/Trip");

/* POST  /api/v2/trips/json   (protected) */
exports.createTripJson = async (req, res, next) => {
	try {
		const userId = req.user._id;
		const {
			tripId,
			startTime,
			segments = [],
			pois = [],
			recommendations = [],
		} = req.body;

		if (!startTime || !segments.length)
			return res
				.status(400)
				.json({ message: "startTime & segments are required" });

		/* ─── flatten all track points ─── */
		const allPts = segments.flatMap((s) => s.track);
		if (allPts.length < 2)
			return res.status(400).json({ message: "not enough track points" });

		/* geo calculations */
		const line = turf.lineString(allPts.map((p) => [p.lon, p.lat]));
		const distanceMeters = turf.length(line, { units: "meters" });
		const startDate = new Date(startTime);
		const endDate = new Date(
			segments[segments.length - 1].endTime || allPts[allPts.length - 1].t
		);
		const durationMillis = endDate - startDate;
		const simplified = turf.simplify(line, {
			tolerance: 0.0001,
			highQuality: true,
		});

		/* map POIs coming from mobile */
		const pointsOfInterest = (pois || []).map((p) => ({
			lat: p.lat,
			lon: p.lon,
			timestamp: p.timestamp || new Date(),
			name: p.name || null,
			description: p.note || null,
		}));

		const newTrip = await Trip.create({
			format: "json",
			user: userId,
			title: `Trip on ${startDate.toLocaleDateString()}`,
			startDate,
			endDate,
			durationMillis,
			distanceMeters,
			segments,
			pointsOfInterest,
			recommendations,
			simplifiedRoute: {
				type: "LineString",
				coordinates: simplified.geometry.coordinates,
			},
			defaultTripVisibility: req.user.settings?.defaultTripVisibility,
			defaultTravelMode: req.user.settings?.defaultTravelMode,
			mapCenter: { lat: allPts[0].lat, lon: allPts[0].lon },
		});
		console.log("newTrip", newTrip);
		res.status(201).json(newTrip);
	} catch (err) {
		console.error("createTripJson error:", err);
		next(err);
	}
};
exports.getTripJsonById = async (req, res, next) => {
	const { tripId } = req.params;

	if (!mongoose.Types.ObjectId.isValid(tripId)) {
		return res.status(400).json({ message: "Invalid Trip ID" });
	}

	try {
		const trip = await Trip.findById(tripId)
			.populate("user", "username profilePictureUrl followers")
			.lean();

		if (!trip || trip.format !== "json") {
			return res
				.status(404)
				.json({ message: "Trip not found or not JSON format" });
		}

		const isOwner = req.user?._id?.toString() === trip.user._id.toString();
		const isFollower = trip.user.followers?.some(
			(f) => f.toString() === req.user?._id?.toString()
		);

		if (
			trip.defaultTripVisibility === "public" ||
			isOwner ||
			(trip.defaultTripVisibility === "followers_only" && isFollower)
		) {
			return res.status(200).json(trip);
		}

		res
			.status(403)
			.json({ message: "You don't have permission to view this trip" });
	} catch (error) {
		console.error("getTripJsonById error:", error);
		next(error);
	}
};

exports.getMyJsonTrips = async (req, res, next) => {
	const userId = req.user._id;

	try {
		const trips = await Trip.aggregate([
			{ $match: { user: userId, format: "json" } },
			{ $sort: { startDate: -1 } },
			{
				$project: {
					_id: 1,
					title: 1,
					startDate: 1,
					description: { $substrCP: ["$description", 0, 150] },
					defaultTravelMode: 1,
					defaultTripVisibility: 1,
					simplifiedRoute: 1,
					likesCount: { $size: "$likes" },
					commentsCount: { $size: "$comments" },
					createdAt: 1,
				},
			},
		]);

		res.status(200).json(trips);
	} catch (error) {
		console.error("getMyJsonTrips error:", error);
		next(error);
	}
};

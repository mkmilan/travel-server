function createCorsOptions(env = process.env) {
	const developmentOrigins = env.NODE_ENV === "production" ? [] : [
		"http://localhost:3000", "http://localhost:8081", "http://localhost:19006",
	];
	const origins = [...developmentOrigins, env.FRONTEND_URL, env.PUBLIC_SITE_URL, env.EXPO_URL]
		.filter(Boolean).map(origin => origin.replace(/\/$/, ""));
	return {
		origin(origin, callback) {
			// Native clients have no Origin. Authentication remains mandatory on protected routes.
			if (!origin || origins.includes(origin)) return callback(null, true);
			return callback(new Error("Not allowed by CORS"));
		},
		credentials: true,
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
		exposedHeaders: ["Set-Cookie"],
		optionsSuccessStatus: 200,
	};
}
module.exports = { createCorsOptions };

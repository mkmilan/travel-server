// server/server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const csrf = require("csurf");
require("dotenv").config();
const connectDB = require("./config/db"); // Ensure path is correct

// --- Database Connection ---
// Establish connection early
connectDB();

// --- Initialize Services (like Storage) ---
// Import the service file to ensure its initialization code runs (e.g., attaching DB listeners)
require("./services/storageService"); // Ensure path is correct

// --- Create Express App ---
const app = express();
// --- Trust Proxy ---
// If your app is behind a proxy (like on Render), this helps Express correctly determine protocol (http/https)
// and is important for 'Secure' cookies to work.
app.set("trust proxy", 1); // Trust first proxy

const allowedOrigins = [
	"http://localhost:3000",
	"https://travel-client-tau.vercel.app",
	"http://localhost:8081", // Expo web dev
	"http://192.168.1.193:8081", // direct IP web dev
	"http://localhost:19006", // another Expo web port
	"exp://192.168.1.193:19006", // Expo Go (optional)
	process.env.FRONTEND_URL,
	process.env.PUBLIC_SITE_URL,
	process.env.EXPO_URL,
].filter(Boolean); // Remove any undefined values

// console.log("Allowed Origins:", allowedOrigins);

// CORS Configuration
const corsOptions = {
	origin: function (origin, callback) {
		// console.log("Request Origin:", origin);

		// Allow requests with no origin (like mobile apps or curl requests)
		if (!origin) return callback(null, true);

		// Normalize and check origin
		// Ensure allowedOrigin doesn't have a trailing slash for startsWith comparison
		const isAllowed = allowedOrigins.some((allowedOrigin) => {
			const normalizedAllowedOrigin = allowedOrigin.replace(/\/$/, ""); // Remove trailing slash if any
			return origin.startsWith(normalizedAllowedOrigin);
		});

		if (isAllowed) {
			callback(null, true);
		} else {
			console.log("Origin blocked by CORS:", origin);
			callback(new Error("Not allowed by CORS"));
		}
	},
	credentials: true,
	methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
	exposedHeaders: ["Set-Cookie"],
	optionsSuccessStatus: 200,
};
// --- Core Middleware ---
// Enable CORS - Configure origins as needed for production
app.use(cors(corsOptions));
// Enable pre-flight requests for all routes
// app.options("*", cors(corsOptions));

// Enable JSON body parsing
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// CSRF Protection Setup
// Option 1: Store secret in cookie (double submit cookie pattern)
// const csrfProtection = csrf({ cookie: true });
// CSRF Protection Setup
const csrfProtection = csrf({
	cookie: {
		key: "_csrf",
		path: "/",
		httpOnly: true,
		secure: process.env.NODE_ENV === "production", // Ensure 'Secure' in production
		sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", // 'None' for cross-site, 'Lax' for same-site /none for mobile
		// secure: true,
		// sameSite: "None",
	},
});
// Option 2: Store secret in session (if you were using express-session)
// const csrfProtection = csrf(); // Requires session middleware

app.use(csrfProtection);

// Middleware to make CSRF token available to your routes/frontend
// For APIs, you might send it on a specific endpoint or on initial page load.
// For SPAs, often a dedicated endpoint is used to fetch the token.
app.get("/api/csrf-token", (req, res) => {
	res.json({ csrfToken: req.csrfToken() });
});

// --- API Routes ---
// Define a simple root route for health check/API status
app.get("/api", (req, res) => {
	res.json({ message: "Motorhome Mapper API is running!" });
});

// Mount specific routers
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/trips", require("./routes/tripRoutes"));
app.use("/api/photos", require("./routes/photoRoutes"));
app.use("/api/recommendations", require("./routes/recommendationRoutes"));
app.use("/api/search", require("./routes/searchRoutes"));
app.use("/api/suggestions", require("./routes/suggestionRoutes"));
app.use("/api/v2/trips", require("./routes/tripJsonRoutes")); // New route for JSON trips

// --- Custom Error Handling Middleware ---
const errorHandler = (err, req, res, next) => {
	console.error("Global Error Handler Caught:", {
		error: err.message,
		// stack: err.stack,
		url: req.url,
		method: req.method,
		// headers: req.headers,
		origin: req.headers.origin,
	});
	if (process.env.NODE_ENV === "development") {
		console.error(err.stack);
	}
	const statusCode = err.statusCode || 500;
	// Specific check for CORS errors passed from the cors middleware
	if (err.message === "Not allowed by CORS" && !res.headersSent) {
		return res.status(403).json({
			// 403 Forbidden is more appropriate for CORS denial
			success: false,
			message: err.message,
		});
	}

	res.status(statusCode).json({
		success: false,
		message: err.message || "Internal Server Error",
		stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
	});
};
// Error handling for CSRF
// app.use((err, req, res, next) => {
// 	if (err.code === "EBADCSRFTOKEN") {
// 		console.error("CSRF token error:", err);
// 		res.status(403).json({ message: "Invalid CSRF token" });
// 	} else {
// 		next(err);
// 	}
// });
// Error handling for CSRF
app.use((err, req, res, next) => {
	if (err.code === "EBADCSRFTOKEN") {
		console.error("CSRF token error details:", {
			// Enhanced logging
			message: err.message,
			code: err.code,
			url: req.originalUrl,
			method: req.method,
			origin: req.headers.origin,
			referer: req.headers.referer,
			cookiesSent: req.cookies, // Cookies received by server
			csrfTokenInHeader:
				req.headers["x-csrf-token"] ||
				req.headers["xsrf-token"] ||
				req.headers["x-xsrf-token"],
			bodyCsrfToken: req.body && req.body._csrf, // If sent in body
		});
		res.status(403).json({
			message: "Invalid CSRF token. Please refresh the page and try again.",
		});
	} else {
		next(err);
	}
});
app.use(errorHandler);

// --- Start Server ---
const PORT = process.env.PORT || 5001; // Use PORT from .env or default

app.listen(PORT, () =>
	console.log(
		`Server running in ${
			process.env.NODE_ENV || "development"
		} mode on port ${PORT}`
	)
);

// --- Handle Unhandled Promise Rejections ---
process.on("unhandledRejection", (err, promise) => {
	console.error(`Unhandled Rejection: ${err.message}`, err);
	// Optional: Close server gracefully
	// server.close(() => process.exit(1));
});

// --- Handle Uncaught Exceptions ---
process.on("uncaughtException", (err) => {
	console.error(`Uncaught Exception: ${err.message}`, err);
	// Optional: Close server gracefully
	// server.close(() => process.exit(1));
});

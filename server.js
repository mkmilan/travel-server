// server/server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
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

// console.log("Environment Variables:", {
// 	NODE_ENV: process.env.NODE_ENV,
// 	FRONTEND_URL: process.env.FRONTEND_URL,
// 	PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
// 	PORT: process.env.PORT,
// 	DEV_API_URL: process.env.DEV_API_URL,
// });

const allowedOrigins = [
	"http://localhost:3000",
	"https://travel-client-tau.vercel.app",
	process.env.FRONTEND_URL,
	process.env.PUBLIC_SITE_URL,
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
	allowedHeaders: ["Content-Type", "Authorization"],
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
// Optional: URL-encoded body parsing
// app.use(express.urlencoded({ extended: false }));

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

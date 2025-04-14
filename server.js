// server/server.js
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db"); // Ensure path is correct

// Load environment variables from .env file
// Make sure this runs before any code that needs process.env
dotenv.config();

// --- Database Connection ---
// Establish connection early
connectDB();

// --- Initialize Services (like Storage) ---
// Import the service file to ensure its initialization code runs (e.g., attaching DB listeners)
require("./services/storageService"); // Ensure path is correct

// --- Create Express App ---
const app = express();

// --- Core Middleware ---
// Enable CORS - Configure origins as needed for production
app.use(
	cors({
		origin: process.env.FRONTEND_URL || "http://localhost:3000", // Use env variable or default
		credentials: true, // Allow cookies/auth headers if needed
	})
);

// Enable JSON body parsing
app.use(express.json({ limit: "10mb" }));
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

// --- Custom Error Handling Middleware ---
// Place this *after* all route definitions
// Example basic error handler (can be moved to middleware file)
const errorHandler = (err, req, res, next) => {
	// Log the error stack trace for debugging (consider more sophisticated logging in production)
	console.error("Global Error Handler Caught:", err.stack);

	// Determine status code - use error's status code if set, otherwise default to 500
	const statusCode =
		err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode) || 500;

	res.status(statusCode).json({
		message: err.message || "Internal Server Error",
		// Optionally include stack trace only in development environment
		stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
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

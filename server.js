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
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigin = isProduction
	? process.env.FRONTEND_URL // Use FRONTEND_URL from Render env vars in production
	: "http://localhost:3000"; // Default to localhost for development

console.log(
	`CORS Allowed Origin: ${allowedOrigin} (NODE_ENV: ${process.env.NODE_ENV})`
);
console.log("isProduction", isProduction);

// --- Core Middleware ---
// Enable CORS - Configure origins as needed for production
app.use(
	cors({
		origin: allowedOrigin,
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
app.use("/api/recommendations", require("./routes/recommendationRoutes"));
app.use("/api/search", require("./routes/searchRoutes"));

// --- Custom Error Handling Middleware ---
const errorHandler = (err, req, res, next) => {
	console.error("Global Error Handler Caught:", err.stack);
	const statusCode = err.statusCode || 500;
	res.status(statusCode).json({
		message: err.message || "Internal Server Error",
		stack: isProduction ? undefined : err.stack, // Show stack only in dev
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

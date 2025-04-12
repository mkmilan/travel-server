// server/server.js
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");

// Load environment variables from .env file
dotenv.config();

// Connect to Database
connectDB();
require("./services/storageService");

const app = express();

// Middleware
app.use(
	cors({
		origin: "http://localhost:3000", // Allow frontend origin in development
		credentials: true, // If you need to handle cookies/sessions later
	})
);
app.use(express.json()); // To parse JSON request bodies
app.use("/api/auth", require("./routes/authRoutes")); // Auth routes
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/trips", require("./routes/tripRoutes"));

// Basic Test Route
app.get("/", (req, res) => {
	res.send("API is running...");
});

// --- Define other routes later ---
// Example: app.use('/api/users', require('./routes/userRoutes'));
// Example: app.use('/api/auth', require('./routes/authRoutes'));

app.use((err, req, res, next) => {
	console.error("Error Middleware Caught:", err.stack); // Log the error stack trace
	const statusCode = res.statusCode === 200 ? 500 : res.statusCode; // Use existing status code or default to 500
	res.status(statusCode);
	res.json({
		message: err.message,
		// Optionally include stack trace in development mode
		stack: process.env.NODE_ENV === "production" ? null : err.stack,
	});
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

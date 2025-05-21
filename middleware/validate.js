const { validationResult } = require("express-validator");

/**
 * Middleware to validate request data using express-validator.
 * @param {Array} validations - An array of express-validator validation chains.
 * @returns {Function} Express middleware function.
 */
const validate = (validations) => {
	return async (req, res, next) => {
		// Run all validation chains
		await Promise.all(validations.map((validation) => validation.run(req)));

		const errors = validationResult(req);
		if (errors.isEmpty()) {
			return next(); // No errors, proceed to the next middleware/handler
		}

		// Collect error messages
		const errorMessages = errors.array().map((err) => err.msg);
		res.status(400); // Bad Request
		// Pass errors to the global error handler
		return next(new Error(errorMessages.join(", ")));
	};
};

module.exports = { validate };

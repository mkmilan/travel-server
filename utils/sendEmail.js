const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
	if (process.env.NODE_ENV === "development") {
		console.log("--- Sending Email (Development Mode) ---");
		console.log("To:", options.email);
		console.log("Subject:", options.subject);
		console.log("Text:", options.text);
		console.log("HTML:", options.html); // Log the HTML which would contain the link
		// For easier testing, you might want to extract and log the direct link:
		const linkMatch = options.html?.match(/href="([^"]*)"/);
		if (linkMatch && linkMatch[1]) {
			console.log("Test Link:", linkMatch[1]);
		}
		return; // In dev, we don't actually send.
	}

	// In production, configure your email transport
	// This is an example using nodemailer with SMTP.
	// You'll need to install nodemailer: npm install nodemailer
	// And set up environment variables like EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM
	const transporter = nodemailer.createTransport({
		host: process.env.EMAIL_HOST,
		port: process.env.EMAIL_PORT,
		auth: {
			user: process.env.EMAIL_USER,
			pass: process.env.EMAIL_PASS,
		},
	});

	const mailOptions = {
		from: `"${process.env.APP_NAME || "Your App Name"}" <${
			process.env.EMAIL_FROM
		}>`,
		to: options.email,
		subject: options.subject,
		text: options.text,
		html: options.html,
	};

	try {
		await transporter.sendMail(mailOptions);
		console.log("Email sent successfully");
	} catch (error) {
		console.error("Error sending email:", error);
		// Depending on your error handling strategy, you might want to throw this error
		// or handle it gracefully. For now, we'll log it.
	}
};

module.exports = sendEmail;

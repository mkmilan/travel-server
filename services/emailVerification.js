const crypto = require('node:crypto');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const COOLDOWN_MS = 60_000;

// Claim the send atomically, including on SMTP failure. A transport error may
// occur after delivery, so retain the valid token and throttle retries.
async function sendVerificationEmail(user) {
  const now = Date.now();
  const token = crypto.randomBytes(32).toString('hex');
  const minutes = Number(process.env.EMAIL_VERIFICATION_TOKEN_EXPIRE_MINUTES);
  const expires = now + (Number.isFinite(minutes) && minutes > 0 ? minutes : 1440) * 60_000;
  const claimed = await User.findOneAndUpdate({
    _id: user._id, isEmailVerified: false,
    $or: [
      { emailVerificationLastSentAt: { $exists: false } },
      { emailVerificationLastSentAt: null },
      { emailVerificationLastSentAt: { $lte: new Date(now - COOLDOWN_MS) } },
    ],
  }, { $set: {
    emailVerificationToken: crypto.createHash('sha256').update(token).digest('hex'),
    emailVerificationExpires: new Date(expires), emailVerificationLastSentAt: new Date(now),
  } }, { new: true });
  if (!claimed) return false;
  const base = process.env.NODE_ENV === 'production' ? process.env.PUBLIC_SITE_URL : process.env.FRONTEND_URL;
  const url = `${base || 'http://localhost:3000'}/verify-email/${token}`;
  await sendEmail({ email: user.email, subject: 'Email Verification',
    html: `<p>Please verify your email address:</p><p><a href="${url}">Verify Email</a></p><p>If you did not create an account, ignore this email.</p>`,
    text: `Please verify your email address by opening this link: ${url}` });
  return true;
}
module.exports = { sendVerificationEmail, COOLDOWN_MS };

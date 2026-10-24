const router = require('express').Router();
const { protect } = require('../middleware/authMiddleware');
const deletion = require('../services/mobileTripDeletion');

// Owner-driven discovery only: no background worker or cross-account IDs.
router.get('/trip-deletions', protect, async (req, res, next) => {
  if (process.env.MOBILE_TRIP_DELETION_ENABLED !== 'true') {
    return res.status(503).json({ message: 'Permanent trip deletion is not enabled yet.' });
  }
  try {
    const pending = await require('../models/MobileTripDeletion').find({
      user: req.user._id, 'pendingFiles.0': { $exists: true },
    }).select('_id').lean();
    res.json({ pending: pending.map(receipt => ({ tripId: String(receipt._id) })) });
  } catch (err) { next(err); }
});

// Deliberately distinct from the unsafe legacy DELETE route. Never fall back.
router.delete('/trips/:tripId/permanent', protect, async (req, res, next) => {
  if (process.env.MOBILE_TRIP_DELETION_ENABLED !== 'true') {
    return res.status(503).json({ message: 'Permanent trip deletion is not enabled yet.' });
  }
  try {
    const result = await deletion.deleteTrip(req.params.tripId, req.user._id);
    res.status(result.cleanupPending ? 202 : 200).json(result);
  } catch (err) { next(err); }
});
module.exports = router;

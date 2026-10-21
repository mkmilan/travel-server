// Profile metadata must follow the same trip visibility as the trip/media APIs.
function createProfileVisibility({ User, Trip, toObjectId }) {
  return async function profileVisibility(ownerId, viewer) {
    const user = toObjectId(ownerId);
    const isOwner = !!viewer?._id && String(viewer._id) === String(ownerId);
    const isFollower = !isOwner && !!viewer?._id && !!(await User.exists({ _id: user, followers: viewer._id }));
    const allowed = isFollower ? ['public', 'followers_only'] : ['public'];
    const tripMatch = { user, ...(isOwner ? {} : { defaultTripVisibility: { $in: allowed } }) };
    // Constrain associated trips to this owner too: a forged cross-account
    // associatedTrip reference must not expose another account's metadata.
    const visibleTripIds = await Trip.distinct('_id', tripMatch);
    const recommendationMatch = {
      user,
      $or: [{ associatedTrip: null }, { associatedTrip: { $in: visibleTripIds } }],
    };
    return { tripMatch, recommendationMatch, isOwner, allowed };
  };
}
function profileVisibility(ownerId, viewer) {
  const mongoose = require('mongoose');
  return createProfileVisibility({ User: require('../models/User'), Trip: require('../models/Trip'), toObjectId: id => new mongoose.Types.ObjectId(id) })(ownerId, viewer);
}
module.exports = { createProfileVisibility, profileVisibility };

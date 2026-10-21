const { canReadTrip } = require('../middleware/mediaAccess');
const id = value => value?._id ?? value;
function createRecommendationVisibility({ Trip }) {
  return async function canReadRecommendation(recommendation, viewer) {
    if (!recommendation) return false;
    // Legacy API treats standalone recommendations as public. Associated
    // recommendations inherit the trip, and may not claim a foreign trip.
    if (!recommendation.associatedTrip) return true;
    const trip = await Trip.findById(recommendation.associatedTrip)
      .select('user defaultTripVisibility').populate('user','followers');
    if (!trip || String(id(trip.user)) !== String(id(recommendation.user))) return false;
    return canReadTrip(trip, viewer);
  };
}
const canReadRecommendation = (recommendation, viewer) => createRecommendationVisibility({Trip:require('../models/Trip')})(recommendation,viewer);
async function filterReadableRecommendations(recommendations,viewer) {
  const allowed=await Promise.all(recommendations.map(rec=>canReadRecommendation(rec,viewer)));
  return recommendations.filter((rec,index)=>allowed[index]);
}
module.exports={createRecommendationVisibility,canReadRecommendation,filterReadableRecommendations};

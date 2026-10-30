// Upload receipts are an internal replay record, not part of a displayed trip.
// In particular, they retain historical Place names after the owner deletes them.
// Do not mutate the canonical receipt: owner upload acknowledgments still need it.
function tripForDisplay(trip) {
  if (!trip) return trip;
  const result = { ...trip };
  for (const key of ['clientUploadId', 'uploadFingerprint', 'uploadComplete', 'uploadWriteVersion', 'uploadReceipt']) {
    delete result[key];
  }
  return result;
}

module.exports = { tripForDisplay };

const error = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const same = (a, b) => String(a) === String(b);

// Shared exact-ID cleanup: references and uploader ownership remain authoritative.
function createManifestCleanup({ Trip, Recommendation, User, storage, findFile, hasChunks, isValidId }) {
  return async function cleanup(receipt, Receipt) {
    const owner = receipt.user;
    for (const fileId of receipt.pendingFiles || []) {
      try {
        // Explicit references can reuse an ID; identical uploaded bytes do not.
        // Preserve actual surviving references, including foreign recommendations.
        const referenced = await Trip.exists({ $or: [{ photos: fileId }, { gpxFileRef: fileId }] })
          || await Recommendation.exists({ photos: fileId })
          || await User.exists({ profilePictureUrl: fileId });
        if (!referenced && isValidId(fileId)) {
          const file = await findFile(fileId);
          // A missing file document is not proof that its chunks are gone.
          // Without uploader metadata we cannot safely remove ambiguous chunks.
          if (!file && await hasChunks(fileId)) throw error(503, 'Exact file chunks remain; storage review is required.');
          // Legacy/malformed/foreign ownership is deliberately not deletion authority.
          if (file && same(file.metadata?.userId, owner)) {
            await storage.deleteFile(fileId, owner);
            // An overlapping retry can see missing metadata and resolve while
            // another delete failed to remove chunks. Keep the exact ID pending.
            if (await hasChunks(fileId)) throw error(503, 'Exact file chunks remain; storage review is required.');
          }
        }
        // Retained shared/foreign files are not failed cleanup: they remain in use
        // or are outside this owner's deletion authority.
        await Receipt.updateOne({ _id: receipt._id, user: owner }, { $pull: { pendingFiles: fileId } });
      } catch (_) {
        // The durable ID remains pending. A caller can retry this same endpoint.
      }
    }
    await Receipt.updateOne({ _id: receipt._id, user: owner, pendingFiles: { $size: 0 } }, { $set: { phase: 'complete' } });
    const current = await Receipt.findOne({ _id: receipt._id, user: owner }).lean();
    if (!current) throw error(503, 'Deletion receipt is unavailable; retry to check cleanup.');
    return current;
  };
}
module.exports = { createManifestCleanup };

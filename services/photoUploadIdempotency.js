const crypto = require('node:crypto');
const mongoose = require('mongoose');
const sharp = require('sharp');
const Receipt = require('../models/PhotoUploadReceipt');
const Attempt = require('../models/PhotoUploadAttempt');
const Trip = require('../models/Trip');
const Recommendation = require('../models/Recommendation');
const TripDeletion = require('../models/MobileTripDeletion');
const RecommendationDeletion = require('../models/RecommendationDeletion');
const storage = require('./storageService');
const { cleanupUnattachedPhotos } = require('./mobileTripWriteGuard');
const { validKey, httpError } = require('./uploadIdempotency');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const receiptId = (userId, kind, targetId, key) => hash(JSON.stringify([String(userId), kind, String(targetId), key]));
const fileInfo = id => mongoose.connection.db.collection('gpxUploads.files').findOne({ _id: new mongoose.Types.ObjectId(id) });

async function requireTransactions() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') throw httpError(503, 'Reliable photo uploads require the server database update. Please retry later.');
}
function readPhotoUploadKey(req) {
  const key = req.headers['x-photo-upload-id'];
  if (key === undefined) return null; // Older clients retain their existing path.
  if (!validKey(key)) throw httpError(400, 'Invalid photo upload identity');
  if (req.files?.length !== 1) throw httpError(400, 'Reliable photo uploads require exactly one photo');
  return key;
}
async function assertTarget(kind, targetId, userId, session) {
  const model = kind === 'trip' ? Trip : Recommendation;
  let query = model.findOne({ _id: targetId, user: userId });
  if (session) query = query.session(session);
  const target = await query.lean();
  if (!target) throw httpError(410, 'Photo upload target is no longer available');
  const tripId = kind === 'trip' ? targetId : target.associatedTrip;
  let tombstone = TripDeletion.exists({ _id: tripId, user: userId });
  if (session) tombstone = tombstone.session(session);
  if (tripId && await tombstone) throw httpError(410, 'This trip has been deleted');
  if (kind === 'recommendation') {
    let deleted = RecommendationDeletion.exists({ _id: targetId, user: userId });
    if (session) deleted = deleted.session(session);
    if (await deleted) throw httpError(410, 'This place has been deleted');
    if (tripId) {
      let parent = Trip.exists({ _id: tripId, user: userId });
      if (session) parent = parent.session(session);
      if (!await parent) throw httpError(410, 'The associated trip is no longer available');
    }
  }
  return { model, target, tripId };
}
async function cleanupFinishedLosers(receipt, tripId, kind, targetId, userId) {
  // Only completed GridFS files are eligible. An active stream without its final
  // files document remains untouched. A complete receipt can never choose a new
  // canonical ID, so these noncanonical candidates cannot become attached later.
  for await (const attempt of Attempt.find({ receipt: receipt._id, user: userId }).cursor()) {
    const candidate = String(attempt._id);
    if (candidate === receipt.photoId) { await Attempt.deleteOne({ _id: candidate, receipt: receipt._id }); continue; }
    if (!await fileInfo(candidate)) continue;
    try {
      await cleanupUnattachedPhotos(tripId, userId, [candidate], kind === 'recommendation' ? { recommendationId: targetId } : {});
      await Attempt.deleteOne({ _id: candidate, receipt: receipt._id });
    } catch (_) { /* Keep exact candidate durable; canonical success is valid. */ }
  }
}
async function replay(receipt, kind, targetId, userId, key) {
  receipt = await Receipt.findById(receipt._id).lean();
  if (!receipt) throw httpError(503, 'Photo upload receipt could not be confirmed');
  if (receipt.state === 'deleted') throw httpError(410, 'This uploaded photo has been removed');
  const { target, tripId } = await assertTarget(kind, targetId, userId);
  if (!target.photos?.some(id => String(id) === receipt.photoId) || !await fileInfo(receipt.photoId)) {
    // Permanent refusal, never recreate a photo removed after a lost response.
    await Receipt.updateOne({ _id: receipt._id, state: 'complete' }, { $set: { state: 'deleted' } });
    throw httpError(410, 'This uploaded photo is no longer attached');
  }
  await cleanupFinishedLosers(receipt, tripId, kind, targetId, userId);
  return { photoIds: [receipt.photoId], photoUploadId: key, photoUploadProtocol: 1 };
}
async function commitCandidate(id, photoId, kind, targetId, userId) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await Receipt.findById(id).session(session).lean();
      if (!result || result.state === 'deleted') throw httpError(410, 'This uploaded photo has been removed');
      if (result.state === 'complete') return;
      const { model, target, tripId } = await assertTarget(kind, targetId, userId, session);
      if (kind === 'recommendation' && tripId) {
        const parent = await Trip.updateOne({ _id: tripId, user: userId }, { $inc: { uploadWriteVersion: 1 } }, { session });
        if (parent.matchedCount !== 1) throw httpError(410, 'The associated trip was deleted');
      }
      const filter = { _id: targetId, user: userId };
      if (kind === 'recommendation') filter.associatedTrip = target.associatedTrip || null;
      const attached = await model.updateOne(filter, { $addToSet: { photos: photoId } }, { session });
      if (attached.matchedCount !== 1) throw httpError(410, 'Photo upload target changed');
      await Receipt.updateOne({ _id: id, state: 'pending' }, { $set: { state: 'complete', photoId } }, { session });
      result = { ...result, state: 'complete', photoId };
    });
    return result;
  } finally { await session.endSession(); }
}
async function uploadPhoto({ kind, targetId, userId, key, file }) {
  if (!validKey(key) || !file?.buffer) throw httpError(400, 'Invalid reliable photo upload');
  await requireTransactions();
  const { tripId } = await assertTarget(kind, targetId, userId);
  const id = receiptId(userId, kind, targetId, key);
  const fingerprint = hash(file.buffer);
  let receipt;
  try {
    receipt = await Receipt.findOneAndUpdate({ _id: id }, { $setOnInsert: {
      user: userId, target: targetId, kind, fingerprint, state: 'pending',
    } }, { upsert: true, new: true }).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    receipt = await Receipt.findById(id).lean();
  }
  if (!receipt || receipt.fingerprint !== fingerprint) throw httpError(409, 'This photo upload identity belongs to different photo contents');
  if (receipt.state !== 'pending') return replay(receipt, kind, targetId, userId, key);
  // Recover a fully stored file after process/response loss before attachment.
  // Never delete another request's candidate: it may still be streaming.
  let candidate;
  for await (const attempt of Attempt.find({ receipt: id, user: userId }).sort({ createdAt: 1 }).cursor()) {
    const info = await fileInfo(attempt._id);
    if (info?.metadata?.photoReceipt === id && info.metadata.photoFingerprint === fingerprint) {
      candidate = String(attempt._id); break;
    }
  }
  let ownCandidate = false;
  if (!candidate) {
    const pipeline = sharp(file.buffer, { failOn: 'truncated' }).rotate().resize({ width: 1920, height: 1920, fit: sharp.fit.inside, withoutEnlargement: true });
    let processed = await pipeline.webp({ quality: kind === 'trip' ? 80 : 75, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (kind === 'trip' && processed.data.length > 1024 * 1024) processed = await pipeline.webp({ quality: 65, effort: 4 }).toBuffer({ resolveWithObject: true });
    candidate = String(new mongoose.Types.ObjectId());
    await Attempt.create({ _id: candidate, receipt: id, user: userId });
    ownCandidate = true;
    await storage.uploadFile(processed.data, `${kind}_${targetId}_${candidate}.webp`, 'image/webp', {
      userId: String(userId), ...(kind === 'trip' ? { tripId: String(targetId) } : { recId: String(targetId) }),
      photoReceipt: id, photoFingerprint: fingerprint, mimetype: 'image/webp',
      size: processed.info.size, width: processed.info.width, height: processed.info.height,
    }, candidate);
  }
  let result;
  try { result = await commitCandidate(id, candidate, kind, targetId, userId); }
  catch (error) {
    // Unknown commit outcome must not delete a possibly attached candidate.
    // Leave its durable attempt ID for retry rather than guessing.
    if (error.statusCode === 410) {
      await Receipt.updateOne({ _id: id, state: 'pending' }, { $set: { state: 'deleted' } });
      if (ownCandidate) {
        await cleanupUnattachedPhotos(tripId, userId, [candidate], kind === 'recommendation' ? { recommendationId: targetId } : {});
        await Attempt.deleteOne({ _id: candidate, receipt: id });
      }
    }
    throw error;
  }
  if (result.photoId !== candidate && ownCandidate) {
    await cleanupUnattachedPhotos(tripId, userId, [candidate], kind === 'recommendation' ? { recommendationId: targetId } : {});
  }
  if (result.photoId === candidate || ownCandidate) await Attempt.deleteOne({ _id: candidate, receipt: id });
  return replay(result, kind, targetId, userId, key);
}
async function markPhotoRemoved({ kind, targetId, userId, photoId }) {
  await Receipt.updateMany({ user: userId, target: targetId, kind, photoId, state: 'complete' }, { $set: { state: 'deleted' } });
}
module.exports = { readPhotoUploadKey, uploadPhoto, markPhotoRemoved, receiptId };

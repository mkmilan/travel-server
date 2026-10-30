'use strict';
// Actual MongoDB transactions/GridFS regression runner; synthetic data only.
// Default root is parent of scripts; TEST_BACKEND_ROOT selects a local checkout.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { once } = require('node:events');
const root = path.resolve(process.env.TEST_BACKEND_ROOT || path.join(__dirname, '..'));
assert(existsSync(path.join(root, 'package.json')), 'Select a local backend checkout with TEST_BACKEND_ROOT');
assert(!existsSync(path.join(root, '.env')), 'No environment file allowed');
const req = createRequire(path.join(root, 'package.json'));
const mongoose = req('mongoose');
const storage = req('./services/storageService');
const Trip = req('./models/Trip'), Recommendation = req('./models/Recommendation'), User = req('./models/User');
const RecReceipt = req('./models/RecommendationDeletion'), TripReceipt = req('./models/MobileTripDeletion');
const { createRecommendationDeletionService } = req('./services/recommendationDeletion');
const { createTripDeletionService } = req('./services/mobileTripDeletion');
const { createTripWriteGuard } = req('./services/mobileTripWriteGuard');
const { removePhoto } = req('./services/photoRemoval');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function gate() {
  let arrive, open;
  const entered = new Promise(resolve => { arrive = resolve; });
  const resumed = new Promise(resolve => { open = resolve; });
  return { entered, open, pause: async () => { arrive(); await resumed; } };
}
async function awaitGate(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Gate timed out: ${label}`)), 15000); })]); }
  finally { clearTimeout(timer); }
}
async function freePort() {
  const s = net.createServer();
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}

async function main() {
  assert.equal(process.argv.length, 2, 'No arguments or external URI accepted');
  const binary = process.env.MONGOD_BINARY;
  assert(binary && path.isAbsolute(binary), 'Provide previously verified official MONGOD_BINARY');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'disposable-place-mongo-'));
  const port = await freePort();
  let child, boot, spawnError, logs = '', passed = 0;
  const ok = message => console.log(`PLACE_RACE_PASS ${++passed}: ${message}`);
  try {
    child = spawn(binary, ['--dbpath', dir, '--bind_ip', '127.0.0.1', '--port', String(port), '--nounixsocket', '--replSet', 'placeRaceFixture', '--wiredTigerCacheSizeGB', '0.25'], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', error => { spawnError = error; });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs += chunk; });
    for (let n = 0; n < 150 && !logs.includes('Waiting for connections'); n++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw Error(logs);
      await sleep(100);
    }
    boot = new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
    await boot.connect();
    await boot.db('admin').command({ replSetInitiate: { _id: 'placeRaceFixture', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    let primary = false;
    for (let n = 0; n < 150; n++) { if ((await boot.db('admin').command({ hello: 1 })).isWritablePrimary) { primary = true; break; } await sleep(100); }
    assert(primary); await boot.close(); boot = null;
    await mongoose.connect(`mongodb://127.0.0.1:${port}/place_race_fixture?replicaSet=placeRaceFixture`, { serverSelectionTimeoutMS: 5000 });
    const version = (await mongoose.connection.db.admin().command({ buildInfo: 1 })).version;
    console.log(`REAL_MONGO ${version}; backend=${root}; fresh loopback replicaSet; no live data`);
    await Promise.all([Trip.init(), Recommendation.init(), User.init(), RecReceipt.init(), TripReceipt.init()]);
    const owner = await User.create({ username: 'Synthetic Place Race Owner', email: 'synthetic-place-owner@example.com', password: 'Synthetic-only-password', isEmailVerified: true });
    const stranger = await User.create({ username: 'Synthetic Place Race Stranger', email: 'synthetic-place-stranger@example.com', password: 'Synthetic-only-password', isEmailVerified: true });
    const files = mongoose.connection.db.collection('gpxUploads.files'), chunks = mongoose.connection.db.collection('gpxUploads.chunks');
    const O = mongoose.Types.ObjectId;
    const failIds = new Set();
    const localStorage = { deleteFile: async (id, user) => { if (failIds.has(String(id))) throw Error('Synthetic GridFS outage'); return storage.deleteFile(id, user); } };
    const deps = { Trip, Recommendation, User, connection: mongoose.connection, storage: localStorage,
      isValidId: mongoose.isObjectIdOrHexString,
      findFile: id => files.findOne({ _id: new O(id) }),
      hasChunks: async id => !!await chunks.findOne({ files_id: new O(id) }, { projection: { _id: 1 } }) };
    const recService = createRecommendationDeletionService({ ...deps, Receipt: RecReceipt, TripDeletion: TripReceipt });
    const tripService = createTripDeletionService({ ...deps, Receipt: TripReceipt, RecommendationDeletion: RecReceipt });
    const guard = createTripWriteGuard({ Trip, Recommendation, User, Deletion: TripReceipt, isValidId: mongoose.isObjectIdOrHexString,
      deleteFile: localStorage.deleteFile, addPendingFiles: tripService.addPendingFiles, addRecommendationPendingFiles: recService.addPendingFiles });
    const makeTrip = () => Trip.create({ user: owner._id, title: 'Synthetic race trip', format: 'json', durationMillis: 1000, distanceMeters: 1, defaultTripVisibility: 'private' });
    const makeRec = (tripId = null, photos = [], extra = {}) => Recommendation.create({ user: owner._id, name: 'Synthetic race place', description: 'Disposable fixture', rating: 3, primaryCategory: 'OTHER', location: { type: 'Point', coordinates: [0, 0] }, associatedTrip: tripId, photos, ...extra });
    const file = () => storage.uploadFile(Buffer.from('synthetic disposable photo bytes'), 'fixture.webp', 'image/webp', { userId: owner.id });
    const assertFile = async (id, count) => { assert.equal(await files.countDocuments({ _id: new O(id) }), count, `file ${id}`); assert.equal(await chunks.countDocuments({ files_id: new O(id) }), count, `chunks ${id}`); };
    const append = (rec, ids) => guard.appendUploadedPhotos({ model: Recommendation, targetId: rec._id, userId: owner._id, tripId: rec.associatedTrip, ids, recommendation: true });
    const pending = async (model, id, fileId) => { const receipt = await model.findById(id).lean(); assert(receipt); assert(receipt.pendingFiles.includes(fileId)); assert.equal(receipt.phase, 'records-deleted'); return receipt; };

    // Actual atomic photo-removal service must not overwrite an independently
    // committed append while awaiting storage cleanup of the old exact ID.
    for (const kind of ['trip', 'recommendation']) {
      const trip = await makeTrip();
      const old = await file(), unrelated = await file(), late = await file();
      const model = kind === 'trip' ? Trip : Recommendation;
      let target;
      if (kind === 'trip') { await Trip.updateOne({ _id: trip._id }, { $set: { photos: [old, unrelated] } }); target = trip; }
      else target = await makeRec(trip._id, [old, unrelated]);
      const paused = gate(); let operation;
      const ignore = kind === 'trip' ? { ignoreTripId: target.id } : { ignoreRecommendationId: target.id };
      try {
        operation = removePhoto({ model, targetId: target._id, userId: owner._id, photoId: old,
          cleanup: async () => { await paused.pause(); await guard.cleanupUnattachedPhotos(trip.id, owner._id, [old], ignore); } });
        await awaitGate(paused.entered, `${kind} photo removal waiting for cleanup`);
        await guard.appendUploadedPhotos({ model, targetId: target._id, userId: owner._id, tripId: trip.id, ids: [late], recommendation: kind === 'recommendation' });
        assert.deepEqual((await model.findById(target.id)).photos, [old, unrelated, late]);
        paused.open(); assert.equal(await operation, 2);
        assert.deepEqual((await model.findById(target.id)).photos, [unrelated, late]);
        await assertFile(old, 0); await assertFile(unrelated, 1); await assertFile(late, 1);
        if (kind === 'trip') await tripService.deleteTrip(trip.id, owner._id);
        else await recService.deleteRecommendation(target.id, owner._id);
        await assertFile(unrelated, 0); await assertFile(late, 0);
        ok(`${kind} exact-photo removal paused in cleanup retains concurrent append and unrelated ID/bytes, removes only old file, returns correct count 2`);
      } finally { paused.open(); if (operation) await operation.catch(() => {}); }
    }

    // Failed storage cleanup is not permission to drop the last retryable
    // reference. The same exact photo removal succeeds when storage returns.
    for (const kind of ['trip', 'recommendation']) {
      const trip = await makeTrip(), old = await file();
      const model = kind === 'trip' ? Trip : Recommendation;
      let target;
      if (kind === 'trip') { await Trip.updateOne({ _id: trip._id }, { $set: { photos: [old] } }); target = trip; }
      else target = await makeRec(trip._id, [old]);
      const ignore = kind === 'trip' ? { ignoreTripId: target.id } : { ignoreRecommendationId: target.id };
      const remove = () => removePhoto({ model, targetId: target._id, userId: owner._id, photoId: old,
        cleanup: () => guard.cleanupUnattachedPhotos(trip.id, owner._id, [old], ignore) });
      failIds.add(old);
      await assert.rejects(remove(), /Synthetic GridFS outage/);
      assert.deepEqual((await model.findById(target.id)).photos, [old]); await assertFile(old, 1);
      failIds.delete(old); assert.equal(await remove(), 0);
      assert.deepEqual((await model.findById(target.id)).photos, []); await assertFile(old, 0);
      ok(`${kind} storage failure preserves exact photo reference and GridFS bytes; retry removes both and returns count 0`);
    }

    // A delete transaction has already read its old photo list. The append must
    // win before deleteOne, forcing actual MongoDB write-conflict callback retry.
    for (const linked of [false, true]) {
      const trip = linked ? await makeTrip() : null;
      const first = await file(), late = await file(), rec = await makeRec(trip?._id, [first]);
      const paused = gate(), original = Recommendation.deleteOne;
      let attempts = 0, operation;
      Recommendation.deleteOne = async function (filter, options) {
        if (String(filter._id) === rec.id && options?.session) { attempts++; if (attempts === 1) await paused.pause(); }
        return original.call(this, filter, options);
      };
      try {
        operation = recService.deleteRecommendation(rec.id, owner._id);
        await awaitGate(paused.entered, 'recommendation delete after snapshot');
        await append(rec, [late]);
        assert.deepEqual((await Recommendation.findById(rec.id)).photos, [first, late]);
        paused.open();
        const result = await operation;
        assert.equal(result.deletedPhotosCount, 2);
        assert(attempts >= 2, 'Actual MongoDB transaction callback retried');
        assert.equal(await Recommendation.countDocuments({ _id: rec._id }), 0);
        assert.equal((await RecReceipt.findById(rec._id)).photoCount, 2);
        await assertFile(first, 0); await assertFile(late, 0);
        ok(`${linked ? 'linked' : 'standalone'} append committed after old delete snapshot; actual transaction retried ${attempts} times and captured/deleted both GridFS files and chunks`);
      } finally { paused.open(); if (operation) await operation.catch(() => {}); Recommendation.deleteOne = original; }
    }

    // An already committed deletion prevents a late append; a healthy storage
    // backend removes its exact fresh file without recreating the recommendation.
    for (const linked of [false, true]) {
      const trip = linked ? await makeTrip() : null, rec = await makeRec(trip?._id);
      await recService.deleteRecommendation(rec.id, owner._id);
      const late = await file();
      await assert.rejects(append(rec, [late]), { statusCode: 410 });
      await assertFile(late, 0);
      assert.equal(await Recommendation.countDocuments({ _id: rec._id }), 0);
      assert.deepEqual((await RecReceipt.findById(rec._id)).pendingFiles, []);
      ok(`${linked ? 'linked' : 'standalone'} delete-before-append rejects with 410, cleans exact late file/chunks and never recreates place`);
    }

    // If cleanup is unavailable, late IDs must be durably discoverable before
    // reporting failure, and the same owner delete can subsequently finish it.
    for (const linked of [false, true]) {
      const trip = linked ? await makeTrip() : null, rec = await makeRec(trip?._id);
      await recService.deleteRecommendation(rec.id, owner._id);
      const late = await file(); failIds.add(late);
      await assert.rejects(append(rec, [late]), { statusCode: 503 });
      await pending(RecReceipt, rec.id, late); await assertFile(late, 1);
      await assert.rejects(recService.deleteRecommendation(rec.id, stranger._id), { statusCode: 403 });
      await pending(RecReceipt, rec.id, late);
      failIds.delete(late);
      assert.equal((await recService.deleteRecommendation(rec.id, owner._id)).deletedPhotosCount, 0);
      await assertFile(late, 0);
      assert.equal((await RecReceipt.findById(rec.id)).phase, 'complete');
      ok(`${linked ? 'linked' : 'standalone'} late upload storage outage retains owner-scoped exact-ID receipt; unauthorized retry forbidden; owner retry clears real file/chunks`);
    }

    // A failure after Mongo actually deletes a recommendation rolls back the
    // metadata + receipt together and never starts GridFS deletion.
    {
      const first = await file(), rec = await makeRec(null, [first]);
      const original = Recommendation.deleteOne;
      Recommendation.deleteOne = async function (filter, options) {
        const result = await original.call(this, filter, options);
        if (String(filter._id) === rec.id && options?.session) throw Error('Synthetic post-delete transaction failure');
        return result;
      };
      try { await assert.rejects(recService.deleteRecommendation(rec.id, owner._id), /Synthetic post-delete transaction failure/); }
      finally { Recommendation.deleteOne = original; }
      assert(await Recommendation.exists({ _id: rec._id }));
      assert.equal(await RecReceipt.countDocuments({ _id: rec._id }), 0); await assertFile(first, 1);
      await recService.deleteRecommendation(rec.id, owner._id); await assertFile(first, 0);
      ok('injected failure after real transactional recommendation delete rolls back record and receipt; GridFS remains until successful retry');
    }

    // Prior recommendation failures are incorporated into whole-trip deletion,
    // including when the recommendation record itself no longer exists.
    {
      const trip = await makeTrip(), first = await file(), rec = await makeRec(trip._id, [first]);
      failIds.add(first);
      await assert.rejects(recService.deleteRecommendation(rec.id, owner._id), { statusCode: 503 });
      await pending(RecReceipt, rec.id, first);
      assert.equal((await tripService.deleteTrip(trip.id, owner._id)).cleanupPending, true);
      await pending(TripReceipt, trip.id, first); await assertFile(first, 1);
      failIds.delete(first);
      assert.equal((await tripService.deleteTrip(trip.id, owner._id)).cleanupPending, false); await assertFile(first, 0);
      await recService.deleteRecommendation(rec.id, owner._id);
      assert.deepEqual((await RecReceipt.findById(rec.id)).pendingFiles, []);
      ok('whole-trip deletion captures pending files from already deleted recommendation receipt; owner trip retry settles GridFS cleanup');
    }

    // Pause the trip transaction after reading an empty recommendation receipt,
    // then add a late ID before its receipt fence write. A write conflict must
    // cause a fresh snapshot including that late ID, not lose the pending work.
    {
      const trip = await makeTrip(), rec = await makeRec(trip._id);
      await recService.deleteRecommendation(rec.id, owner._id);
      const late = await file(); failIds.add(late);
      const paused = gate(), original = RecReceipt.updateMany;
      let attempts = 0, operation;
      RecReceipt.updateMany = async function (filter, update, options) {
        if (String(filter.associatedTrip) === trip.id && options?.session) { attempts++; if (attempts === 1) await paused.pause(); }
        return original.call(this, filter, update, options);
      };
      try {
        operation = tripService.deleteTrip(trip.id, owner._id);
        await awaitGate(paused.entered, 'trip receipt fence after snapshot');
        await assert.rejects(recService.addPendingFiles(rec.id, owner._id, [late]), { statusCode: 503 });
        await pending(RecReceipt, rec.id, late);
        assert.equal(await TripReceipt.countDocuments({ _id: trip._id }), 0);
        paused.open(); assert.equal((await operation).cleanupPending, true);
        assert(attempts >= 2, 'Trip transaction retried after receipt write conflict');
        await pending(TripReceipt, trip.id, late); await assertFile(late, 1);
        failIds.delete(late);
        assert.equal((await tripService.deleteTrip(trip.id, owner._id)).cleanupPending, false);
        await assertFile(late, 0);
        await recService.deleteRecommendation(rec.id, owner._id);
        ok(`late ID arriving after trip snapshot forces ${attempts} transaction attempts, enters durable trip receipt and is removed on owner retry`);
      } finally { paused.open(); if (operation) await operation.catch(() => {}); RecReceipt.updateMany = original; failIds.delete(late); }
    }

    // If the trip committed first, a late recommendation-receipt writer forwards
    // its new exact ID into the existing trip queue before attempting cleanup.
    {
      const trip = await makeTrip(), rec = await makeRec(trip._id);
      await recService.deleteRecommendation(rec.id, owner._id);
      assert.equal((await tripService.deleteTrip(trip.id, owner._id)).cleanupPending, false);
      const late = await file(); failIds.add(late);
      await assert.rejects(recService.addPendingFiles(rec.id, owner._id, [late]), { statusCode: 503 });
      await pending(RecReceipt, rec.id, late); await pending(TripReceipt, trip.id, late); await assertFile(late, 1);
      failIds.delete(late);
      assert.equal((await tripService.deleteTrip(trip.id, owner._id)).cleanupPending, false); await assertFile(late, 0);
      await recService.deleteRecommendation(rec.id, owner._id);
      const guardLate = await file();
      await assert.rejects(append(rec, [guardLate]), { statusCode: 404 });
      await pending(TripReceipt, trip.id, guardLate); await assertFile(guardLate, 1);
      assert.equal((await tripService.deleteTrip(trip.id, owner._id)).cleanupPending, false); await assertFile(guardLate, 0);
      ok('post-trip-delete late receipt IDs forward to owner trip queue; upload guard also durably queues late GridFS file without resurrecting records');
    }

    // Simulate a process interruption after the durable child receipt write but
    // before its forwarding write. This is a precise state fixture, not a claim
    // that the test killed a process at that instant.
    {
      const trip = await makeTrip(), rec = await makeRec(trip._id);
      await recService.deleteRecommendation(rec.id, owner._id);
      assert.equal((await tripService.deleteTrip(trip.id, owner._id)).cleanupPending, false);
      const late = await file(); failIds.add(late);
      await RecReceipt.updateOne({ _id: rec._id, user: owner._id }, { $addToSet: { pendingFiles: late }, $set: { phase: 'records-deleted' } });
      assert.deepEqual((await TripReceipt.findById(trip.id)).pendingFiles, []);
      await pending(RecReceipt, rec.id, late);
      await assert.rejects(tripService.deleteTrip(trip.id, stranger._id), { statusCode: 404 });
      assert.deepEqual((await TripReceipt.findById(trip.id)).pendingFiles, []);
      assert.equal((await tripService.deleteTrip(trip.id, owner._id)).cleanupPending, true);
      await pending(TripReceipt, trip.id, late); await assertFile(late, 1);
      failIds.delete(late);
      assert.equal((await tripService.deleteTrip(trip.id, owner._id)).cleanupPending, false); await assertFile(late, 0);
      await recService.deleteRecommendation(rec.id, owner._id);
      assert.equal(await Trip.countDocuments({ _id: trip._id }), 0);
      assert.equal(await Recommendation.countDocuments({ _id: rec._id }), 0);
      ok('owner trip retry repairs interrupted child-to-trip late-ID forwarding, retains outage as durable pending, then cleans file/chunks without restoring records');
    }

    assert.equal(await files.countDocuments(), 0, 'No synthetic GridFS file orphan remains');
    assert.equal(await chunks.countDocuments(), 0, 'No synthetic GridFS chunk orphan remains');
    console.log(`PLACE_RACES_RESULT ${passed} grouped real-Mongo checks passed; version=${version}; no source changes or production access`);
  } finally {
    if (boot) await boot.close();
    await mongoose.disconnect();
    if (child?.pid && child.exitCode === null) {
      const closed = once(child, 'exit'); child.kill('SIGTERM');
      await Promise.race([closed, sleep(5000)]);
      if (child.exitCode === null) { child.kill('SIGKILL'); await closed; }
    }
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`DISPOSABLE_DATABASE_REMOVED ${dir}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

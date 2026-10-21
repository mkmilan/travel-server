const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createPhotoOwnership } = require('../services/fileOwnership');
const owner = 'a'.repeat(24), attacker = 'b'.repeat(24), photo = 'c'.repeat(24);
const silent = { log() {}, warn() {}, error() {} };
function load(file, stubs) {
 const filename = path.resolve(file), realRequire = createRequire(filename);
 const module = { exports: {} };
 vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  module, exports: module.exports, require: id => Object.hasOwn(stubs, id) ? stubs[id] : realRequire(id), console: silent, Buffer, process,
 }, { filename });
 return module.exports;
}
test('actual GridFS delete function rejects another user and legacy metadata before delete', async () => {
 const connection = new EventEmitter(); connection.db = {};
 const removed = []; let file = { metadata: { userId: owner } };
 class Bucket { find() { return { limit() { return { toArray: async () => [file] }; } }; } async delete(id) { removed.push(String(id)); } }
 const storage = load('services/storageService.js', { mongoose: { connection }, mongodb: { GridFSBucket: Bucket, ObjectId: require('mongodb').ObjectId } });
 connection.emit('open');
 await assert.rejects(storage.deleteFile(photo, attacker), { statusCode: 403 }); assert.equal(removed.length, 0);
 await assert.rejects(storage.deleteFile(photo), { statusCode: 403 }); assert.equal(removed.length, 0);
 file = {}; await assert.rejects(storage.deleteFile(photo, owner), { statusCode: 403 }); assert.equal(removed.length, 0);
 file = { metadata: { userId: owner } }; await storage.deleteFile(photo, owner); assert.deepEqual(removed, [photo]);
});
test('recommendation create rejects another user photo before document creation', async () => {
 const created = [];
 const assertOwnedPhotos = createPhotoOwnership({ isValidId: () => true, findFile: async () => ({ metadata: { userId: owner }, contentType: 'image/webp' }) });
 const controller = load('controllers/recommendationJsonController.js', {
  '../models/Recommendation': { schema: { path: () => ({ enumValues: ['CAMPSITE'] }) }, create: async data => { created.push(data); return { _id: 'test' }; } },
  '../models/User': {}, '../models/Trip': {}, '../services/storageService': {}, sharp: {},
  '../services/fileOwnership': { assertOwnedPhotos },
 });
 const data = { name: 'Fixture', latitude: 1, longitude: 2, primaryCategory: 'CAMPSITE', photoIds: [photo] };
 let result = await controller.processPendingRecommendations([data], attacker, null);
 assert.equal(result[0].status, 'failed'); assert.equal(created.length, 0);
 result = await controller.processPendingRecommendations([data], owner, null);
 assert.equal(result[0].status, 'created'); assert.equal(created.length, 1);
});
test('recommendation update rejects forged attach without saving or deleting', async () => {
 let saved = 0; const rec = { user: attacker, photos: [], save: async () => saved++ };
 const assertOwnedPhotos = createPhotoOwnership({ isValidId: () => true, findFile: async () => ({ metadata: { userId: owner }, contentType: 'image/webp' }) });
 const controller = load('controllers/recommendationJsonController.js', {
  '../models/Recommendation': { findById: async () => rec }, '../models/User': {}, '../models/Trip': {}, '../services/storageService': {}, sharp: {},
  '../services/fileOwnership': { assertOwnedPhotos },
 });
 let status; const res = { status(value) { status = value; return this; }, json() {} };
 let failure;
 await controller.updateRecommendationJson({ params: { recommendationId: photo }, user: { _id: attacker }, body: { photoIds: [photo] } }, res, error => { failure = error; });
 assert.equal(saved, 0); assert.ok(failure || status >= 400);
});

test('legitimate recommendation update preserves the saved JSON response', async () => {
 const rec = { user: owner, photos: [], save: async function () { return this; } };
 const assertOwnedPhotos = createPhotoOwnership({ isValidId: () => true, findFile: async () => ({ metadata: { userId: owner }, contentType: 'image/webp' }) });
 const controller = load('controllers/recommendationJsonController.js', {
  '../models/Recommendation': { findById: async () => rec }, '../models/User': {}, '../models/Trip': {}, '../services/storageService': {}, sharp: {},
  '../services/fileOwnership': { assertOwnedPhotos },
 });
 let status, body; const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
 await controller.updateRecommendationJson({ params: { recommendationId: photo }, user: { _id: owner }, body: { photoIds: [photo] } }, res, error => { throw error; });
 assert.equal(status, 200); assert.equal(body, rec); assert.equal(body.photos[0], photo);
});

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
// Fixture repository only: never opens MongoDB or loads native password bindings.
const userPath = require.resolve('../models/User');
const prior = require.cache[userPath];
const id = 'a'.repeat(24);
let sessionVersion;
require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: { findById(value) { return { select: async () => value === id ? { _id: id, sessionVersion } : null }; } } };
const { protect, protectOptional } = require('../middleware/authMiddleware');
const priorSecret = process.env.JWT_SECRET;
// Public, synthetic in-memory test fixture, never a development/production credential.
process.env.JWT_SECRET = 'public-unit-test-fixture-not-a-real-secret';
after(() => { if (prior) require.cache[userPath] = prior; else delete require.cache[userPath]; if (priorSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = priorSecret; });
const token = () => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1m' });
async function call(middleware, request) {
 const req = { cookies: {}, headers: {}, ...request }; let error, status = 200, called = false;
 await middleware(req, { status(code) { status = code; return this; } }, err => { error = err; called = true; });
 return { req, error, status, called };
}
test('cookie and bearer auth both resolve fixture user', async () => {
 for (const req of [{ cookies: { token: token() } }, { headers: { authorization: `Bearer ${token()}` } }]) {
  const result = await call(protect, req); assert.equal(result.error, undefined); assert.equal(result.req.user._id, id);
 }
});
test('optional authentication keeps anonymous requests anonymous and honors bearer', async () => {
 assert.equal((await call(protectOptional, {})).req.user, null);
 assert.equal((await call(protectOptional, { headers: { authorization: `Bearer ${token()}` } })).req.user._id, id);
 const stale = await call(protectOptional, { cookies: { token: 'invalid-fixture' } });
 assert.equal(stale.req.user, null); assert.equal(stale.error, undefined);
});
test('protected route without token fails rather than authorizing', async () => {
 const result = await call(protect, {}); assert.equal(result.status, 401); assert.ok(result.error);
});

test('reset session version revokes old cookie/bearer auth and optional identity', async () => {
 const old = token();
 sessionVersion = 'synthetic-version-after-reset';
 try {
  for (const request of [{cookies:{token:old}}, {headers:{authorization:`Bearer ${old}`}}]) {
   assert.equal((await call(protect, request)).status, 401);
   assert.equal((await call(protectOptional, request)).req.user, null);
  }
  const current = jwt.sign({id, sessionVersion}, process.env.JWT_SECRET, {expiresIn:'1m'});
  assert.equal((await call(protect, {headers:{authorization:`Bearer ${current}`}})).status, 200);
  assert.equal((await call(protectOptional, {cookies:{token:current}})).req.user._id, id);
 } finally { sessionVersion = undefined; }
});

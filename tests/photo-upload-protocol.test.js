const test = require('node:test');
const assert = require('node:assert/strict');
const { readPhotoUploadKey, receiptId } = require('../services/photoUploadIdempotency');

test('photo receipt identities are stable and independently scope owner, kind, target and key', () => {
  const base = ['owner', 'trip', 'target', 'key'];
  assert.equal(receiptId(...base), receiptId(...base));
  assert.match(receiptId(...base), /^[a-f0-9]{64}$/);
  for (let i = 0; i < base.length; i++) { const changed = [...base]; changed[i] += 'changed'; assert.notEqual(receiptId(...base), receiptId(...changed)); }
  assert.notEqual(receiptId('a','trip','bc','d'), receiptId('ab','trip','c','d'));
});
test('key reader permits legacy absence but rejects empty, malformed and multiple header values', () => {
  assert.equal(readPhotoUploadKey({ headers: {}, files: [{}] }), null);
  for (const value of ['', 'bad key', 'a/b', 'é', 'x'.repeat(129), ['first','second']]) {
    assert.throws(() => readPhotoUploadKey({ headers: {'x-photo-upload-id': value}, files: [{}] }), error => error.statusCode === 400);
  }
});
test('reliable protocol requires exactly one file and accepts bounded safe identities', () => {
  assert.equal(readPhotoUploadKey({ headers: {'x-photo-upload-id':'photo_ABC-123'}, files:[{}] }), 'photo_ABC-123');
  for (const files of [undefined, [], [{},{}]]) assert.throws(() => readPhotoUploadKey({ headers: {'x-photo-upload-id':'key'}, files }), error => error.statusCode === 400);
});

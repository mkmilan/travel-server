const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
for (const email of ['traveller@example.com', 'traveller+trip@example.travel', 'first.last@example.technology']) {
 test(`user model accepts valid email ${email}`, () => {
  const user = new User({ username: 'Traveller', email, password: 'fixture-password' });
  assert.equal(user.validateSync(), undefined);
 });
}
for (const email of ['invalid', 'a@@example.com', 'a@', 'a b@example.com']) {
 test(`user model rejects malformed email ${email}`, () => {
  const user = new User({ username: 'Traveller', email, password: 'fixture-password' });
  assert.ok(user.validateSync().errors.email);
 });
}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const sendEmail = require('../utils/sendEmail');

// Every transport and console method is mocked; no SMTP connection or token log.
const message = {
  email: 'synthetic@example.invalid', subject: 'Fixture verification',
  text: 'fixture-reset-token', html: '<a href="https://example.invalid/fixture-verification-token">Verify</a>',
};
function setup(t, env, mode) {
  const prior = { NODE_ENV: process.env.NODE_ENV, EMAIL_MODE: process.env.EMAIL_MODE };
  process.env.NODE_ENV = env;
  if (mode === undefined) delete process.env.EMAIL_MODE; else process.env.EMAIL_MODE = mode;
  t.after(() => { for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const logs = ['log', 'error', 'warn', 'info', 'debug'].map(method => t.mock.method(console, method, () => {}));
  const send = t.mock.fn(async () => ({ messageId: 'fixture' }));
  const transport = t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: send }));
  return { logs, send, transport };
}
for (const env of ['production', 'development', 'test']) {
  test(`disabled email in ${env} never creates transport or logs contents`, async t => {
    const { logs, transport, send } = setup(t, env, 'disabled');
    assert.equal(await sendEmail(message), undefined);
    assert.equal(transport.mock.callCount(), 0);
    assert.equal(send.mock.callCount(), 0);
    for (const log of logs) assert.equal(log.mock.callCount(), 0);
  });
}
test('unset email mode retains production SMTP delivery', async t => {
  const { transport, send } = setup(t, 'production');
  assert.deepEqual(await sendEmail(message), { success: true });
  assert.equal(transport.mock.callCount(), 1);
  assert.equal(send.mock.callCount(), 1);
  assert.equal(send.mock.calls[0].arguments[0].html, message.html);
});
test('unset email mode retains local development no-send logging', async t => {
  const { transport, logs } = setup(t, 'development');
  await sendEmail(message);
  assert.equal(transport.mock.callCount(), 0);
  assert(logs[0].mock.callCount() > 0);
});
test('mistyped email mode fails closed without transport or content logging', async t => {
  const { transport, logs } = setup(t, 'production', 'disabeld');
  await assert.rejects(sendEmail(message), /Unsupported EMAIL_MODE/);
  assert.equal(transport.mock.callCount(), 0);
  for (const log of logs) assert.equal(log.mock.callCount(), 0);
});
test('empty email mode retains SMTP behavior and propagates transport failure', async t => {
  const { send } = setup(t, 'production', '');
  const failure = new Error('Synthetic SMTP failure');
  send.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(sendEmail(message), error => error === failure);
});

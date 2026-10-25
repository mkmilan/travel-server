const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');

let child, port, logs = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
before(async () => {
  child = fork(path.join(__dirname, 'fixtures/json-parser-server.cjs'), [], {
    env: { PATH: process.env.PATH }, silent: true,
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs += data; });
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
  port = message.port;
  assert(Number.isInteger(port));
});
after(async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'exit');
  child.send('stop');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await closed; } finally { clearTimeout(timeout); }
});

async function available() {
  assert.equal(child.exitCode, null, logs);
  assert.equal(child.signalCode, null, logs);
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: true });
}
async function post(body, headers = {}, route = '/echo') {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body, signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}

test('Express resolves patched body-parser and retains the production JSON parser options', () => {
  const resolved = require.resolve('body-parser/package.json', { paths: [require.resolve('express')] });
  const version = require(resolved).version.split('.').map(Number);
  assert(version[0] === 2 && version[1] >= 4, 'Express must resolve body-parser >=2.4.0 <3');
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(source, /app\.use\(express\.json\(\{ limit: "50mb" \}\)\)/);
});

test('normal JSON retains Unicode, arrays, numbers and empty-body behavior', async () => {
  for (const body of [{ title: 'Synthetic café 山', segments: [1, 2], active: true }, [{ lat: 1.25 }]]) {
    assert.deepEqual(await post(JSON.stringify(body)), { status: 200, body: { body } });
  }
  assert.deepEqual(await post(''), { status: 200, body: { body: {} } });
  await available();
});

test('malformed JSON and strict scalar bodies return 400 without disabling later requests', async () => {
  for (const body of ['{"unfinished":', 'null', '123', '"scalar"', '   ']) {
    assert.deepEqual(await post(body), { status: 400, body: { type: 'entity.parse.failed' } });
  }
  await available();
});

const compressors = [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]];
if (zlib.zstdCompressSync) compressors.push(['zstd', zlib.zstdCompressSync]);
for (const [encoding, compress] of compressors) {
  test(`${encoding} JSON supports consecutive requests and rejects invalid compressed bytes`, async () => {
    const body = { title: 'Synthetic compressed trip', count: 2 };
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(await post(compress(Buffer.from(JSON.stringify(body))), { 'Content-Encoding': encoding }), { status: 200, body: { body } });
      assert.equal((await post('not-a-compressed-stream', { 'Content-Encoding': encoding })).status, 400);
    }
    const truncated = compress(Buffer.from(JSON.stringify(body))).subarray(0, 8);
    assert.equal((await post(truncated, { 'Content-Encoding': encoding })).status, 400);
    await available();
  });
}

test('unsupported encodings and charsets remain rejected, including compressed bodies', async () => {
  assert.deepEqual(await post('{}', { 'Content-Encoding': 'fixture-unsupported' }), { status: 415, body: { type: 'encoding.unsupported' } });
  for (const charset of ['iso-8859-1', 'utf-999']) {
    assert.deepEqual(await post(zlib.gzipSync(Buffer.from('{}')), {
      'Content-Type': `application/json; charset=${charset}`, 'Content-Encoding': 'gzip',
    }), { status: 415, body: { type: 'charset.unsupported' } });
  }
  await available();
});

test('the existing 50 MiB JSON limit rejects oversized plain and decompressed bodies', async () => {
  // Bounded local fixture (50 MiB + JSON delimiters), never sent to a deployed API.
  const oversized = Buffer.alloc(50 * 1024 * 1024 + 2, 0x20);
  oversized[0] = 0x5b; oversized[oversized.length - 1] = 0x5d;
  for (const [body, headers] of [[oversized, {}], [zlib.gzipSync(oversized), { 'Content-Encoding': 'gzip' }]]) {
    assert.deepEqual(await post(body, headers), { status: 413, body: { type: 'entity.too.large' } });
  }
  await available();
});

test('GHSA-27r3-jxmh-p828: gzip trailing bytes cannot crash the isolated parser process', async () => {
  // Small, one-shot local regression; separate process makes uncaught decoder errors fatal.
  const payload = Buffer.concat([zlib.gzipSync(Buffer.from('{"fixture":true}')), Buffer.from([0]), Buffer.alloc(96 * 1024, 0x41)]);
  assert.deepEqual(await post(payload, { 'Content-Encoding': 'gzip' }), { status: 200, body: { body: { fixture: true } } });
  await pause(200); // Allow queued decoder errors to surface before checking process health.
  await available();
});

test('an early-finished deflate stream drains trailing bytes so downstream request-end work finishes', async () => {
  const first = Buffer.concat([zlib.deflateSync(Buffer.from('{"fixture":"drain"}')), Buffer.from([0])]);
  const trailing = Buffer.alloc(512, 0x41);
  const response = await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/wait-for-end', method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'deflate', 'Content-Length': first.length + trailing.length },
    }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
    });
    const parsed = message => { if (message.parsed) request.end(trailing); };
    child.on('message', parsed);
    request.on('close', () => child.off('message', parsed));
    request.on('error', reject);
    request.setTimeout(3000, () => request.destroy(new Error('Parser did not drain the local request')));
    request.write(first);
  });
  assert.deepEqual(response, { status: 200, body: { body: { fixture: 'drain' } } });
  await available();
});

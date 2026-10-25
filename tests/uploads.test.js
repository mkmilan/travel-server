const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { uploadSinglePhoto, uploadMultiplePhotos } = require('../config/multerConfig');
let server, base;
before(async () => {
	const app = express();
	app.post('/single', uploadSinglePhoto, (req, res) => res.json({ name: req.file?.originalname, bytes: req.file?.size }));
	app.post('/multiple', uploadMultiplePhotos, (req, res) => res.json({ count: req.files.length }));
	app.use((err, req, res, next) => res.status(400).json({ error: err.code || err.message }));
	await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
const image = () => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
test('Multer 2 memory storage accepts single and multiple image uploads', async () => {
	const single = new FormData(); single.append('photo', image(), 'trip.jpg');
	let response = await fetch(base + '/single', { method: 'POST', body: single });
	assert.equal(response.status, 200); assert.equal((await response.json()).bytes, 4);
	const multiple = new FormData(); multiple.append('photos', image(), 'one.jpg'); multiple.append('photos', image(), 'two.jpg');
	response = await fetch(base + '/multiple', { method: 'POST', body: multiple });
	assert.equal(response.status, 200); assert.equal((await response.json()).count, 2);
});
test('wrong fields and excess photos are rejected', async () => {
	const wrong = new FormData(); wrong.append('wrong', image(), 'trip.jpg');
	assert.equal((await fetch(base + '/single', { method: 'POST', body: wrong })).status, 400);
	const excess = new FormData(); for (let i = 0; i < 6; i++) excess.append('photos', image(), `${i}.jpg`);
	assert.equal((await fetch(base + '/multiple', { method: 'POST', body: excess })).status, 400);
});
test('non-image and misleading image extension/MIME are rejected', async () => {
	for (const [name, type] of [['script.txt', 'text/plain'], ['script.jpg.exe', 'image/jpeg'], ['trip.jpg', 'application/notjpeg']]) {
		const form = new FormData(); form.append('photo', new Blob(['invalid'], { type }), name);
		assert.equal((await fetch(base + '/single', { method: 'POST', body: form })).status, 400);
	}
});
test('malformed multipart is rejected and server remains available', async () => {
	const response = await fetch(base + '/single', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, body: '--test\r\nContent-Disposition: form-data; name="photo"; filename="x.jpg"\r\nContent-Type: image/jpeg\r\n\r\ntruncated', signal: AbortSignal.timeout(5000) });
	assert.equal(response.status, 400);
	const form = new FormData(); form.append('photo', image(), 'ok.jpg');
	assert.equal((await fetch(base + '/single', { method: 'POST', body: form })).status, 200);
});

test('the actual image filter completes synchronously for accept and reject paths', () => {
	// Guard the assumption that makes GHSA-q7qp-rjg7-q26m inapplicable here.
	const fs = require('node:fs'), vm = require('node:vm');
	let options;
	vm.runInNewContext(fs.readFileSync(require.resolve('../config/multerConfig'), 'utf8'), {
		module: { exports: {} },
		require(name) {
			if (name !== 'multer') return require(name);
			return Object.assign(config => { options = config; return { single() {}, array() {} }; }, { memoryStorage() { return {}; } });
		},
	});
	for (const [originalname, mimetype, accepted] of [
		['trip.JPEG', 'image/jpeg', true], ['trip.png', 'image/png', true],
		['trip.gif', 'image/gif', true], ['trip.webp', 'image/webp', true],
		['trip.jpg.exe', 'image/jpeg', false], ['trip.jpg', 'text/plain', false],
	]) {
		let called = 0;
		options.fileFilter({}, { originalname, mimetype }, (error, result) => {
			called++; assert.equal(result, accepted); assert.equal(Boolean(error), !accepted);
		});
		assert.equal(called, 1, 'fileFilter must finish before returning; async filters need a patched Multer');
	}
});

test('the configured 50 MiB per-file limit rejects oversized uploads and permits a later valid upload', async () => {
	const form = new FormData();
	form.append('photo', new Blob([Buffer.alloc(50 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), 'oversized.jpg');
	const response = await fetch(base + '/single', { method: 'POST', body: form, signal: AbortSignal.timeout(10000) });
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'LIMIT_FILE_SIZE' });
	const valid = new FormData(); valid.append('photo', image(), 'ok.jpg');
	assert.equal((await fetch(base + '/single', { method: 'POST', body: valid })).status, 200);
});

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

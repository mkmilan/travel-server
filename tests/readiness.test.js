const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReadinessHandler } = require('../config/readiness');
for (const state of [0, 1, 2, 3, 99]) {
	for (const storage of [false, true]) {
		test(`readiness state=${state} storage=${storage}`, () => {
			const result = {};
			const res = {
				setHeader(key, value) { result[key] = value; },
				status(code) { result.code = code; return this; },
				json(body) { result.body = body; return this; },
			};
			createReadinessHandler({ readyState: state }, () => storage)({}, res);
			const ready = state === 1 && storage;
			assert.equal(result.code, ready ? 200 : 503);
			assert.deepEqual(result.body, { status: ready ? 'ready' : 'unavailable' });
			assert.equal(result['Cache-Control'], 'no-store');
		});
	}
}

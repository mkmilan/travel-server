# Focused request-parser security update

## Scope and package delta

Only the `body-parser` lockfile entry changes: **2.3.0 → 2.4.0**, within the
existing Express 5.3.0 dependency range `^2.3.0`. `package.json`, Express,
Multer, authentication, request/upload limits, feed logic and application code
are unchanged. The new package's declared dependency ranges also change, but
all are already satisfied by the existing locked packages. No other package
version or integrity changes.

The [upstream advisory](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828)
describes an unhandled decompression-stream error when trailing bytes follow a
compressed body. Our JSON middleware enables decompression and runs before
authentication. Upstream identifies 2.4.0 as fixed. Its
[release notes](https://github.com/expressjs/body-parser/releases/tag/v2.4.0)
also include parser refactoring and Zstandard support; tests cover the supported
compression formats rather than assuming this is a source-level one-line fix.

The existing production `uncaughtException` logger is not considered a fix or a
test substitute. The regression fixture runs without such a handler, so an
uncaught decoder error terminates its isolated child and fails the test.

## Reproduction and verification

On Node **24.22.1**, npm **11.9.0**, official MongoDB **7.0.28**:

```sh
npm ci --ignore-scripts
npm test
MONGOD_BINARY=/path/to/verified/mongod npm run test:integration
MONGOD_BINARY=/path/to/verified/mongod node scripts/discover-feed-integration.cjs
MONGOD_BINARY=/path/to/verified/mongod node scripts/mobile-trip-deletion-integration.cjs
MONGOD_BINARY=/path/to/verified/mongod node scripts/recording-upload-integration.cjs
npm audit --omit=dev
git diff --check
```

All network fixtures bind to loopback; Mongo harnesses create and remove their
own disposable databases. No existing database URI, SMTP delivery, geocoder,
deployed API or real account is required. Run only without a real `.env`.

- Baseline: **154/154** tests passed before the update.
- Updated suite: **167/167** tests passed, including **11 parser tests** and two
  added Multer tests. Coverage includes normal/Unicode/empty/strict JSON,
  malformed JSON, supported compressed bodies, invalid/truncated encodings,
  unsupported charsets, the unchanged 50 MiB JSON limit before/after inflation,
  delayed trailing bytes, request draining and continued process health.
- The one-shot gzip regression **failed against a separate local copy of
  2.3.0** with an uncaught decoder error and **passed with 2.4.0**. It uses only
  a tiny synthetic JSON document and 96 KiB of trailing data; never run it
  against a deployed service. Limit tests allocate bounded 50 MiB fixtures.
- **46 actual API/Mongo/GridFS checks** passed, including gzip login with real
  CSRF/authentication, malformed JSON, real PNG/JPEG/WebP processing, invalid
  and mixed image cleanup, photo permissions, registration/logout, GPX,
  startup/readiness and disabled-email production settings.
- **10 Discover/Following HTTP groups**, **13 deletion proofs**, and recording
  concurrency (12 simultaneous uploads), replay, owner isolation, conflicts,
  partial-child retry and deterministic rejection all passed against MongoDB.
- Multipart tests retain field/count/type rejection and malformed-body recovery,
  add the actual 50 MiB per-file rejection/recovery, and verify that the actual
  configured filter invokes its callback synchronously for accept/reject paths.

## Remaining warning and boundaries

`npm audit --omit=dev` now reports **one high advisory**, down from two:
Multer 2.4.0, [GHSA-q7qp-rjg7-q26m](https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m).
Upstream explicitly excludes synchronous `fileFilter` configurations; this
repository has one Multer configuration and its filter is synchronous. Multer
is deliberately unchanged to keep this fix narrow. Reassess before introducing
async filtering; upstream's patched version is 2.5.0. A nonzero audit exit is
therefore expected, not an all-clear or a failed installation.

Existing invalid-image decode failures return HTTP **500**, not 400. Regression
checks preserve that behavior while proving neither attachments nor GridFS
orphans remain after single-invalid or mixed-valid/invalid uploads. HTTP error
classification is a separate cleanup, not changed in this dependency fix.

These are local automated checks, not a complete security audit, native-device
or browser-policy test, SMTP test, load test, or proof of every resource limit.
No APK, deployment, push or live data mutation is part of this change.

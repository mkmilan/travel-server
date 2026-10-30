# Reliable recording upload rollout (MOB-039 / MOB-040)

Code and fixture tests do not authorize deployment or live database changes.

## Required order

1. Independently review and test the server and mobile changes together. Run disposable Mongo concurrency integration as well as unit/SQLite tests. Verify replica-set or sharded MongoDB transaction support before deploying this revision; standalone MongoDB returns a retryable 503 before recording writes. No live topology/index change is authorized by this source change.
2. Obtain approval for the test-server deployment and two additive unique partial indexes in `travel_test`. No existing trip or recommendation is rewritten/deleted. Index construction can consume database resources; no production setup is included.
3. In the authorized test-server environment, run `node scripts/setup-recording-upload-indexes.cjs --apply-test-only` with its existing protected `MONGO_URI` configuration. Never print/copy credentials into chat or the repository. The script refuses a database name other than `travel_test`, never drops/replaces an index, and is not invoked at server startup.
4. Deploy the reviewed server branch to the isolated test service. Verify the indexes and `/api/v2/trips/recording-upload` using explicitly authorized synthetic data. The endpoint fails closed before writes when either unique index is missing. Legacy `/json` callers retain their existing behavior.
5. Only then build the next test APK after separate approval. Old servers return an update-required error instead of silently falling back to unprotected uploads.

## Protocol and preservation

- Existing SQLite trip UUID is the upload identity, scoped to authenticated owner. Local recommendation row IDs are child keys, scoped to owner and saved trip.
- Before network dispatch, a nullable `upload_payload` column freezes the first request. Additional nullable `upload_server_id` and `upload_result` fields retain receipts. Additive migration leaves existing rows, route points, POIs, metadata and uploaded states unchanged.
- Once upload has started, local metadata/POI editing is blocked to prevent reuse of a key with different contents. Retry the frozen upload, then edit the online trip. A server fingerprint conflict never silently overwrites either copy.
- Unique indexes arbitrate concurrent creation. Server returns the existing trip/children on retries. Only absent children are attempted. A completed durable receipt is returned unchanged on later retries, so later user deletion of a child does not cause its recreation.
- Partial `failed`/`skipped` recommendation outcomes remain visibly incomplete on the phone. Only a validated complete receipt marks the local row uploaded. Unknown responses and local-marker failures retain the recording for safe retry.
- Each reliable child insert uses a short metadata transaction that writes the owned parent as a concurrency fence. Completion writes that same parent and preserves the first completed receipt. An overlapping stale request therefore cannot recreate a child deleted after completion. GridFS is not part of these transactions. Interruption after trip creation or some child commits creates recoverable partial state. An interruption before receipt persistence is recovered by identity lookup. Deterministic schema/core-field failures are rejected before the first trip insert; only that explicit matching rejection releases the local snapshot for correction. A malformed legacy local child may still require a repair UI/support because not every old field is editable. After a server trip exists, transient child failures retain the frozen snapshot for safe retry. No silent truncation or automatic whole-trip restart is performed.
- Previously created server trips have no upload identities. The new protocol cannot safely reconcile a legacy recording that was already uploaded but remained locally pending. Do not re-upload known already-online legacy copies blindly. Existing duplicates and their comments/likes/recommendations stay untouched; cleanup requires separate approval.

## Acceptance gates

Simultaneous same-owner requests; lost response followed by retry; restart after frozen snapshot; mixed successful/failed recommendations; retry only missing children; local uploaded-marker write failure; wrong/missing receipt; owner isolation; different payload/key conflict; missing indexes; legacy client compatibility; unchanged route calculations/GPX; real phone offline/pause/save/reopen acceptance.

## Verified source checkpoint

- Server suite: 88/88 passing; integrated mobile suite: 321/321 passing.
- Disposable official MongoDB 7.0.28 integration passed: actual unique partial indexes, 12 simultaneous same-owner requests producing one trip/child, response-loss replay, owner isolation, payload conflict, missing-index refusal, partial-child retry and preinsert rejection. No Atlas/live database was accessed. MongoDB 8.0.16 could not start in this container (CPU-discovery allocator failure); this is not a MongoDB 8 compatibility claim.
- No deployment, live index creation or APK build performed. Native phone lifecycle/network acceptance remains a release gate.
- Rolling back the server leaves legacy `/json` behavior available, but new reliable-upload clients will keep recordings pending and require the updated server; do not add an unsafe fallback. Additive columns/fields/indexes need not be removed for rollback.

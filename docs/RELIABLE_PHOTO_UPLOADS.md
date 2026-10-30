# Reliable single-photo uploads

New clients POST exactly one `photos` multipart file to:

- `/api/trips/:tripId/photos/reliable`
- `/api/v2/recommendations/:recommendationId/photos/reliable`

`X-Photo-Upload-Id` is required (1–128 ASCII letters, digits, `_` or `-`). Keep
this identity for retries of the same selected local file and target. The mobile
client derives it from owner, target kind, target ID and immutable local URI. A
new deliberate selection gets a new URI/key; this is not image-content deduping.

Success is `{ photoUploadProtocol: 1, photoUploadId: <same key>, photoIds: [id] }`.
Clients must verify the receipt and never fall back to the legacy endpoint.
The dedicated endpoint makes an old server fail closed before writing. Legacy
unkeyed endpoints remain compatible but do not gain reliable retry guarantees.

## Invariants

A deterministic receipt `_id` scopes a key to owner and target, using MongoDB's
built-in unique `_id` index. SHA256 of uploaded bytes rejects changed payloads
with 409. Receipt and target photo reference commit together in a transaction.
An associated place also writes its parent trip, fencing parent deletion. A
completed receipt never selects another canonical file. Replay only succeeds
while the canonical photo remains attached and its GridFS file exists.
Individual photo deletion first makes the receipt permanently non-replayable,
then uses existing storage-first cleanup. Failed cleanup retains its visible
reference for explicit delete retry. Receipt tombstones must not expire.

GridFS streaming is outside the transaction. Each candidate ID is recorded in a
separate attempt document before streaming. Only a final GridFS files document
with matching receipt/fingerprint metadata is recoverable. Partial chunks alone
are never attached. Concurrent requests may temporarily store different files,
but one canonical ID can be attached. Finished losers are cleaned on successful
replay; cleanup failures preserve their attempt records. Delayed writes during
trip/place deletion feed exact IDs into existing deletion cleanup receipts.

This is not universal crash-atomic GridFS cleanup. A process that dies before
its final files document can leave partial chunks and a durable attempt record.
Such incomplete attempts are not automatically deleted because another process
may still be writing them. They require a separately supervised cleanup after
confirming no writer is active. There is no automatic lease-expiry deletion.
The protocol prevents duplicate attachment even when such cleanup is pending.

## Rollout

Deploy backend before the client; no credential or account migration is needed.
The database must support transactions (replica set or sharded cluster) and the
application needs normal CRUD/collection rights for PhotoUploadReceipt and
PhotoUploadAttempt. The receipt requires no separately provisioned unique
secondary index. Standalone MongoDB fails closed with 503 before writing files.
Drain old handlers when rolling out deletion fences. Do not roll back deletion
handlers to versions that ignore receipts while reliable uploads are in use.

Existing completed uploads without keys cannot be retroactively reconciled.
The mobile change does not add durable photo drafts or protect cache files from
OS eviction; it preserves a key whenever the existing selected URI survives.
Profile picture replacement is unchanged.

## Regression checks

`npm test` includes identity/validation tests. Run the disposable integration
runner using a verified official local mongod executable:

```
MONGOD_BINARY=/absolute/path/to/mongod node scripts/photo-upload-retry-integration.cjs
MONGOD_BINARY=/absolute/path/to/mongod PHOTO_RETRY_STANDALONE=true node scripts/photo-upload-retry-integration.cjs
```

The runner rejects a local `.env`, starts its own loopback database and uses
synthetic accounts/photos only. No external database URI is accepted.

# App photo/upload/deletion integrity fixes — 2026-10-29

These changes are source-only. They do not authorize deployment, live database
operations, index setup, or an app build.

## Concurrency contracts

- **Single-photo deletion:** keep storage-first ordering and a retryable reference
  on storage failure, preserve surviving trip/recommendation/profile references,
  then owner-scope an atomic `$pull`. Never save the stale projected photo array.
  Recommendation `photosCount` describes the atomic removal's returned state.
- **Recording retries:** each new child has a short metadata transaction with a
  real write to the exact owned parent. Completed receipt persistence writes that
  same document conditionally and never replaces an already-completed receipt.
  A paused creator must either commit before completion or retry and return its
  historical receipt. The entire upload is not one transaction: successfully
  committed children survive other child failures and missing children can retry.
- **Whole v2 place deletion:** a metadata transaction reads the current photo IDs,
  creates a minimal exact-ID receipt, and deletes the exact owned place. A photo
  append either precedes this transaction and is captured (transaction retry on
  conflict), or cannot match the deleted target and compensates/records its IDs.
  GridFS cleanup starts only after commit; storage failures retain exact IDs.
- **Partial-upload place deletion:** receipt stores the original child ID and its
  upload identity, not name/description/location. Deletion writes the same owned
  parent fence. A later frozen-payload retry returns a historical `created`
  acknowledgment with the original ID rather than undoing the owner's deletion.
  Other missing children still retry. Foreign/dangling-linked owned places remain
  deletable, and a foreign parent's metadata is never modified.
- **Permanent trip deletion:** includes pending exact IDs from previous owned
  place deletions. Its transaction writes those receipts so late ID additions
  cannot escape both manifests. Late writers forward into a committed trip receipt;
  parent deletion retries also reconcile place manifests if forwarding was interrupted.

## API and rollout

Successful place deletion remains HTTP 200 with
`{message:"Recommendation deleted successfully",deletedPhotosCount}`. A never-known
missing place remains HTTP 204; a repeated deletion with a retained receipt can
return the original HTTP 200 count. Cleanup failure returns retryable HTTP 503,
not a misleading successful/202 result. Same-ID owner retry resumes cleanup.
Recording protocol, owner identity, child keys, and successful response shapes are
unchanged. Permanent deletion still returns the explicit `TRIP_DELETED` receipt
when it races recording completion.

**Verify replica-set/sharded transaction support before deploying.** Reliable
recording upload rejects unsupported standalone topology before record creation.
Place deletion translates unsupported transactions into a retryable 503 without
metadata/storage deletion. No new unique/application indexes or data rewrite are
required. The new `RecommendationDeletion` collection uses MongoDB's `_id` key;
check collection-creation permissions/topology with controlled staging fixtures.
Existing reliable-upload unique indexes remain prerequisites.

## Remaining boundaries

- This is not global GridFS/reference transactional isolation. Explicit concurrent
  reuse of a file ID and legacy write paths retain their documented boundaries.
- A process crash after creating GridFS bytes but before recording the resulting ID
  can still leave an unrecorded file. No account-wide orphan scan/worker is added.
- The app keeps a failed-delete row for immediate retry after HTTP 503, but it has
  no dedicated pending-place-cleanup discovery screen. After refocus/relaunch,
  metadata is already gone; the exact receipt remains retryable by known place ID.
  Linked receipts also join permanent-trip cleanup/retry. Standalone pending cleanup
  may need an explicitly authorized support retry if the app no longer has its ID.
- Receipts deliberately persist; they contain IDs, ownership, phase/count/timestamps,
  not deleted place content. Existing completed recording receipt disclosure policy
  is unchanged.

## Verification

Run `npm test`, the replica-set `scripts/recording-upload-integration.cjs`, the
existing permanent-trip/HTTP integration suites, and the deterministic real-Mongo
race regressions:

```sh
MONGOD_BINARY=/path/to/verified/mongod node scripts/app-recording-races.cjs
MONGOD_BINARY=/path/to/verified/mongod node scripts/app-place-deletion-races.cjs
MONGOD_BINARY=/path/to/verified/mongod node scripts/app-standalone-fail-closed.cjs
```

The scripts reject external database URI arguments and do not load dotenv. Only disposable loopback databases
and synthetic GridFS bytes are authorized by these runners. Source tests do not
establish production failover, native lifecycle behavior, or deployment readiness.

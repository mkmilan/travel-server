# Mobile trip deletion: technical contract

## Feature gates and endpoints

Enable `MOBILE_TRIP_DELETION_ENABLED` only after validating deployment prerequisites.
The mobile client has a separate deletion UI gate. Existing authentication and CSRF
middleware apply to both endpoints:

- `DELETE /api/mobile/trips/:tripId/permanent`: owner-only JSON trip deletion.
  Returns `200 {tripId,deleted:true,cleanupPending:false}` or
  `202 {tripId,deleted:true,cleanupPending:true}`.
- `GET /api/mobile/trip-deletions`: owner-only pending trip IDs for explicit retry.

The client must not fall back to the legacy DELETE endpoint. GPX trips are refused
by this endpoint. Incomplete reliable recording uploads must finish first.

## Deletion and retry behavior

A MongoDB metadata transaction captures exact photo IDs and deletes the owned trip
and only its owner's recommendations associated with that exact trip. Foreign-owned
recommendations are retained. Embedded comments, likes and POIs disappear with their
parent. A minimal receipt stores IDs, cleanup state and timestamps, not trip content.
The receipt also prevents later recording-upload replay for that owner and identity.

GridFS cleanup follows the metadata commit and is not transactional. Exact failed
file IDs remain pending for owner-driven retry. Existing uploader metadata and
surviving trip, recommendation or profile references are checked before deletion.
Unverifiable or foreign files are not deletion authority. If a file document is
missing but exact-ID chunks remain, cleanup stays pending rather than deleting
ambiguous chunks or reporting success. Known late upload failures can reopen a receipt.

The client retains an owner-scoped durable retry identity and reconciles local copies
only after a verified deletion response. There is no unattended cleanup worker or
account-wide orphan scan. Pending cleanup may require separately authorized storage
review if repeated owner retries cannot establish safe deletion authority.

## Limitations

- Metadata transactions require a supported MongoDB deployment topology.
- GridFS streaming and reference checks do not provide global cross-client atomicity.
- A crash between file creation and recording its ID can leave an orphan.
- Legacy concurrent writers and explicit concurrent photo reuse remain race boundaries.
- Recording replay compensation is not a universal process-crash guarantee.
- Receipts remain without expiry to recognize later offline retries.

## Verification and rollout requirements

Reviewed source passed 131 server unit tests, 13 disposable real-MongoDB integration
checks and 42 HTTP smoke checks. These counts describe the reviewed source revision,
not proof of a live deployment or real-device acceptance.

The integration harness runs against a new temporary loopback replica and exercises
exact ownership/association, rollback, storage failures, pending cleanup, replay,
write guards and GPX refusal. Run it with an independently verified MongoDB binary:

```sh
MONGOD_BINARY=/path/to/verified/mongod node scripts/mobile-trip-deletion-integration.cjs
```

Before enabling: verify deployment transaction support, required recording-upload
indexes, server/client compatibility and authenticated endpoint behavior. Validate
owner-only deletion, retained unrelated data and cleanup retries with controlled test
accounts, then perform Android UI and interrupted-network acceptance checks.
Disposable single-node integration tests do not establish production failover,
process-kill safety, native UI behavior or universal cross-client crash atomicity.

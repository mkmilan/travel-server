# Discover feed

## Contract

`GET /api/v2/trips/json/discover?page=1&limit=10` requires the existing cookie or
bearer authentication. It returns the existing feed envelope:

```json
{ "items": [], "page": 1, "limit": 10, "totalPages": 0, "totalCount": 0 }
```

- Only `format: "json"`, `defaultTripVisibility: "public"` trips qualify. Both
  the aggregation and count use that filter before pagination. Followed authors,
  strangers and the viewer's own public trips are included; a follow list is not
  required. Followers-only/private trips and GPX trips are excluded.
- Order is `createdAt DESC, _id DESC`: newest upload first, not recording date.
  Existing timestamps are used; no fields, backfill or data migration were added.
- `page` is a positive integer; `limit` is an integer from 1 through 100. Omitted
  values default to 1 and 10. Malformed/duplicate values, unsafe integers and
  unsafe computed offsets return 400 before trip queries. Anonymous or invalid
  sessions return 401 through the unchanged authentication middleware.
- Items keep the existing feed card fields, author projection, 150-code-point
  description snippet, map preview, social counts and viewer-specific like state.
  Responses use `Cache-Control: private, no-store`.
- Pagination is deliberately the existing page/limit style, not snapshot/cursor
  pagination. `_id` makes timestamp ties deterministic; concurrent inserts or
  visibility changes can still move offset boundaries. Refresh starts at page 1.
- `/api/v2/trips/json/feed` and its Following controller are unchanged, including
  follow restrictions, followers-only visibility and recording-date ordering.
  There are no changes to writes, recording, deletion, GPX or search.

## Index

The additive schema index `{ format: 1, defaultTripVisibility: 1, createdAt: -1,
_id: -1 }` places Discover's equality filters before its sort keys. The disposable
MongoDB query plan uses an `IXSCAN` without a blocking `SORT`. No index was applied
to any live database. Deployment must account for index creation/verification:
Mongoose's existing default auto-index behavior is not changed, so a later
deployment can build the new index during initialization. Do not mistake the
schema declaration for evidence that a deployed database has the index.

## Verification (2026-10-25)

Tested locally with Node 24.22.1, locked Express 5.3.0 / Mongoose 8.24.6 and
official MongoDB 7.0.28. The downloaded vendor archive was checked against its
official SHA-256 file. No external database URI is accepted by the new harness;
it refuses `.env`, uses synthetic authors/trips, disables email, binds Mongo/API
to loopback, and stops processes/removes its temporary database afterward.

```sh
npm test
MONGOD_BINARY=/path/to/verified/official/mongod node scripts/discover-feed-integration.cjs
MONGOD_BINARY=/path/to/verified/official/mongod npm run test:integration
MONGOD_BINARY=/path/to/verified/official/mongod node scripts/mobile-trip-deletion-integration.cjs
MONGOD_BINARY=/path/to/verified/official/mongod node scripts/recording-upload-integration.cjs
```

- **154/154 unit tests** passed, including 23 new Discover/Following regression
  tests and controller query validation/error propagation checks.
- **10 grouped Discover HTTP/Mongo checks** passed: authentication; empty data;
  public-only filtering across followed/stranger/self authors; upload-date and
  `_id` tie ordering/page boundaries/totals; exact card equality with Following
  and existing detail route; no-follow and account-like state; unchanged
  Following visibility/order; visibility changes and cache header; malformed
  HTTP pagination; real index/query plan.
- Existing **42 HTTP smoke checks**, **13 real-Mongo deletion checks** and the
  recording-upload real-Mongo concurrency/replay/retry suite passed unchanged.

This verifies the local backend, not a deployed API, native phone/emulator, UI
layout or a release build. No push, deployment, production mutation or real user
data was involved.

## Official references reviewed before implementation

- [MongoDB sort consistency and unique tie-break keys](https://www.mongodb.com/docs/manual/reference/operator/aggregation/sort/)
- [MongoDB equality-prefix indexes and sort support](https://www.mongodb.com/docs/manual/tutorial/sort-results-with-indexes/)
- [Mongoose 8 aggregation casting and sorting](https://mongoosejs.com/docs/8.x/docs/queries.html)
- [Mongoose schema indexes and autoIndex](https://mongoosejs.com/docs/8.x/docs/guide.html#indexes)
- [Express 5 query input is untrusted](https://expressjs.com/en/5x/api/request/#req.query)

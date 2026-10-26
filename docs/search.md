# Simple search API

Local implementation, 2026-10-25. No deployment, native build, production database
mutation or change to Discover, Following, recording/upload, GPX or deletion code.

## Mobile contract

`GET /api/v2/search?q=coast&type=trips&page=1&limit=20&envelope=true`

- `type`: `trips`, `recommendations`, or `users` (the People tab).
- `q`: required literal text, trimmed length 2–120. Case-insensitive matching;
  no fuzzy/accent-folded search, ranking, external maps or geocoding.
- Trips search JSON-trip title, description, start location and end location.
- Recommendations search name and description. Optional `category` must be one
  of the existing Recommendation `primaryCategory` enum values, e.g. `WILD_SPOT`.
  It narrows the text search; blank text never returns a whole category/catalog.
- People search username substrings; the signed-in account is excluded, matching
  the pre-existing generic search contract. No private profile fields are sent.
- `page`: positive integer, default 1. `limit`: integer 1–50, default 20. Duplicate,
  malformed, nonfinite and unsafe pagination values return 400.
- `envelope=true` requires a valid account (401 if absent/expired). It returns:

```json
{"results": [], "page": 1, "limit": 20, "total": 0, "hasMore": false}
```

`total` and `hasMore` describe only visible matches. Authorization precedes both
pagination and counting in one aggregate/facet. Trips sort by `startDate` and
`_id` descending; recommendations and people sort by `createdAt` and `_id`
descending. The unique tie-breaker gives deterministic pages for unchanged data;
this is offset pagination, not a snapshot across concurrent inserts/deletions.

All successful results use `Cache-Control: private, no-store`. Fresh searches
consult the author's current `followers`, not the viewer's cached `following`.

## Visibility and card payloads

Trips: owner sees own trips; others see public trips and followers-only trips
when the author currently lists them as a follower. Missing authors are excluded.

Recommendation search intentionally has a narrower standalone policy than the
legacy global API: only the owner sees a standalone recommendation in search.
Every linked recommendation must have an existing trip owned by its creator,
and the viewer must be able to read that trip. Orphan/foreign associations are
excluded even for the recommendation owner. This does **not** alter the global
recommendation visibility helper or public standalone detail policy. Mobile
envelope results additionally require linked trips to be JSON, because the
existing mobile linked-trip detail screen does not support GPX. Bare-array
callers retain readable GPX-linked recommendations; no GPX code/data is changed.

Trip cards include author location, travel mode, map/route, authoritative social
counts and viewer like state, plus a count of same-owner trip recommendations.
Recommendation cards retain `photos`, `associatedTrip`, location and attributes,
so existing cards/detail navigation need no extra detail request per result.
One necessary adjacent read-side privacy fix also limits `getTripJsonById`'s
recommendation list to the trip creator. Without it, a forged foreign-author
association excluded by search/counts reappeared in the reused recommendation
sheet. Valid same-owner detail results are unchanged; no records are migrated
or deleted.
`photos` and the legacy `coverPhotoUrl` value contain media IDs, not public URLs;
existing authorized photo routes still check access on every fetch.

## Compatibility

Omitting `envelope` (or `envelope=false`) keeps the existing bare-array response
and optional authentication. The corrected visibility and pagination apply to
these calls too. Bare-array recommendation calls also retain their old exact
category-as-text match, in addition to name/description matching. The legacy
`/api/search` controller is unchanged.

`/api/v2/search/users` retains its old array response and word-start token search,
adds strict input/pagination validation and deterministic sorting, and rejects
queries whose short tokens would otherwise all disappear. The new mobile screen
uses the generic envelope endpoint instead.

## Verification

Installed runtime inspected: Node 24, Express 5.3.0, Mongoose 8.24.6. Disposable
integration uses the existing verified official MongoDB 7.0.28 executable.

```sh
npm test
MONGOD_BINARY=/absolute/path/to/mongod node scripts/search-integration.cjs
MONGOD_BINARY=/absolute/path/to/mongod node scripts/integration-smoke.cjs
MONGOD_BINARY=/absolute/path/to/mongod node scripts/discover-feed-integration.cjs
MONGOD_BINARY=/absolute/path/to/mongod node scripts/mobile-trip-deletion-integration.cjs
MONGOD_BINARY=/absolute/path/to/mongod node scripts/recording-upload-integration.cjs
```

The search integration harness refuses `.env` and external URI arguments. It
starts Mongo and the real API on temporary loopback ports with synthetic users,
trips, recommendations and GridFS bytes, then removes its temporary database.
Its 16 grouped checks cover privacy-before-pagination/counts, all viewer roles,
standalone/orphan/foreign associations, mobile-only GPX exclusion with legacy
compatibility, deterministic ties, all text types,
categories, Unicode/regex literals, bad parameters, card fields/detail routes,
protected thumbnails and changed privacy/follow access. Image bytes are synthetic
transport fixtures, not a native image-rendering test.

No production-sized load test or native-device UI/TalkBack test is implied.
Substring regex remains the existing simple database-text approach; large-data
performance may later justify a separately approved indexed search design.

Official implementation references:
- [MongoDB consistent sorting and unique tie-breakers](https://www.mongodb.com/docs/manual/reference/method/cursor.sort/)
- [MongoDB 7.0 lookup](https://www.mongodb.com/docs/v7.0/reference/operator/aggregation/lookup/)
- [MongoDB 7.0 facet and its limits](https://www.mongodb.com/docs/v7.0/reference/operator/aggregation/facet/)
- [Mongoose 8 aggregates and explicit ID casting](https://mongoosejs.com/docs/8.x/docs/api/aggregate.html)

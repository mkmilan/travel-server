# Travel API: isolated development

This branch is a security baseline, not a deployment. Keep production MongoDB,
SMTP credentials, live GPS/user data and production clients out of development.

## Reproducible checks (no database or secrets needed)

Use Node 24 (`.nvmrc`) and npm. From this repository:

```sh
npm ci --ignore-scripts
npm test
```

The tests use synthetic users/trips and loopback-only HTTP upload fixtures. They
exercise file visibility, exact CORS matching and Multer parsing/rejection. No
application server, external geocoder, email sender or production database runs.
Install scripts remain disabled for the baseline. Bcrypt 6 ships platform prebuilds; Sharp uses platform packages. Full native compatibility is covered separately by the disposable integration check, not inferred from unit tests.

## Disposable Mongo integration smoke

With an official local MongoDB binary and the reviewed bcrypt native binding installed:

```sh
# Run only in a checkout without a real .env file.
MONGOD_BINARY=/absolute/path/to/mongod npm run test:integration
```

The harness refuses a checkout containing `.env`; it does not accept an existing
Mongo URI. It starts MongoDB and the actual API on loopback-only temporary ports,
uses a temporary database and explicit throwaway fixture signing value, captures
development email output privately, then stops both processes and removes its
own temporary database. It never imports SMTP or production settings.

Verified on 2026-10-21 with Node 24 and MongoDB 7.0.24: **41 integration checks
passed**, covering actual bcrypt login, registration/email verification in
no-send development mode, cookie/bearer auth, logout cookies, CSRF/CORS,
Multer/Sharp/GridFS uploads, public/private/follower photo access, private GPX,
forged attachment rejection and storage ownership on deletion. The test also
checks that authentication failures retain HTTP 401 instead of becoming 500.
Five additional checks exercise disabled email with production settings, including
no SMTP, no logged links, retained secure CSRF cookies and blocked unverified login.

This is HTTP integration, not browser cookie-policy or native-device testing.
The fixture does not cover GPS hardware, foreground/background transitions,
external maps or a complete product regression suite. No real data is needed.

## Before running the full application

The additive protected Discover endpoint and its isolated verification are
documented in [docs/discover-feed.md](docs/discover-feed.md). The existing
Following endpoint remains unchanged. No deployed service or live database was
modified by this feature's local implementation/tests.

1. Provision a **local, disposable MongoDB** instance, bound to loopback, with an
   empty `travel_development` database. GridFS uses that same database. Do not use
   an existing production URI or copy real user data.
2. Copy `.env.example` to the ignored `.env`. Configure a separate local-only
   JWT signing secret through the approved secret workflow, never in Git or chat.
   There is deliberately no usable secret in the example.
3. Configure the web client for `http://localhost:5001/api` and its site URL for
   `http://localhost:3000`. For mobile, use a development-only reachable endpoint;
   don't reuse the existing production EAS profiles.
4. Run `npm run dev`, **not `npm start`**. The latter explicitly selects production.
   In development the email helper prints a test link instead of sending mail.
   Keep that local console private: links are authentication tokens.
5. Use synthetic accounts and routes. Stub external OSM/Nominatim calls before
   exercising recommendation/geocoding paths.

MongoDB, app startup, real DB authentication, native device builds, actual email
and external geocoders are **not** covered by the unit/HTTP-fixture test suite.

## Security changes and compatibility gates

- Photo and GPX reads now require the owning trip to be public, owned by the
  requester, or followers-only with an authorized follower. Orphan files and old uploads without server-written owner metadata fail
  closed; verify/migrate such legacy files before release, never guess ownership. Standalone recommendation photos and public profile avatars remain
  public. Recommendation photos attached to trips inherit trip visibility.
- File reads use optional authentication so anonymous public views remain possible.
  Private images require cookies or a bearer token. Verify web cross-origin image
  loading and mobile authenticated image requests before release.
- Media responses use `private, no-store`, because a trip can change visibility.
  This cannot retroactively evict files already cached by earlier releases.
- Production CORS now accepts **exact** configured `FRONTEND_URL`, `PUBLIC_SITE_URL`
  and `EXPO_URL` origins. Set all legitimate origins explicitly before deployment.
  Old hardcoded production/LAN origins and prefix matching were removed. Native
  clients without Origin remain supported; CORS is not authentication.
- CSRF error logs no longer include cookie/token values. CSRF protection now uses maintained `@dr.pogodin/csurf`, preserving the `/api/csrf-token` and `X-CSRF-Token` contract. Tokens are accepted only from that header; production uses a `__Host-` cookie. Existing clients should refresh their CSRF token after upgrading.
- Multer is upgraded to the patched 2.x line with upload regression tests. Image
  extension and MIME checks are exact, but are not a substitute for image decoding.

Next gate: exercise login/logout, feed, private/public/follower media, recording
and uploads against the disposable database before any device build or release.

## Remaining review work

This is not a complete security audit or an all-clear. The locked dependency tree returned zero `npm audit` findings on 2026-10-21, but new advisories were published afterward. The [focused 2026-10-25 parser update and regression report](docs/dependency-security-2026-10-25.md) records the patched `body-parser`, tests and remaining configuration-inapplicable Multer warning. Recommendation JSON attachments and all storage deletions now validate
server-written file ownership, including copied references. Public profile counts, photo galleries, recommendations and POIs now follow trip visibility; settings are owner-only. These fixes do not
claim to solve every privacy endpoint. Do not deploy this partial
phase until those findings and the integration gates above are resolved.

File deletion also fails closed for legacy uploads lacking uploader metadata.
Their database references may be removed while the stored file is retained,
rather than guessing ownership and risking another user's data. Review legacy
orphans explicitly. New GPX uploads now write content type and owner metadata
with the correct storage-service argument order.
Existing recommendations with unverifiable legacy photo references also fail
ownership validation on edit (including title-only edits). Repair the ownership
metadata from trustworthy records, or explicitly remove those photo references,
before editing; do not automatically assign legacy files to the signed-in user.

## Dependency migration notes (phase two)

- Targeted upgrades retain Express 5, Mongoose 8 and JSON Web Token 9; the lockfile pins patched transitive dependencies.
- Bcrypt 6, Nodemailer 10 and Sharp 0.35 are intentional security migrations. Password/authentication, image processing and development mail flows are regression-tested. Actual SMTP delivery remains untested and must be verified using an approved staging account before release.
- `gpx-parse` has no upstream patched XML dependency range. A scoped `xml2js` 0.6.2 override removes the vulnerable parser; track, waypoint, timestamp, malformed XML and prototype-safety fixtures cover compatibility. A future parser replacement should be separately planned.
- Development uses Node's built-in `--watch`, removing nodemon's obsolete glob dependencies. Use current Node 24 as in `.nvmrc`; Node 22 requires at least 22.12 for CommonJS/ESM interoperability.
- GPX reads verify both uploader and original trip metadata. Legacy/misattributed file references remain fail-closed pending a trustworthy inventory/migration.


## Isolated staging email safety (configuration only; not deployed)

For an independently approved, isolated HTTPS staging environment, keep
`NODE_ENV=production` so production cookie and error-handling protections remain
enabled, and explicitly set `EMAIL_MODE=disabled`. This suppresses all SMTP
transport creation/sending and email content/token logging. No SMTP credentials
are needed. Do not deploy the local development example unchanged.

When `EMAIL_MODE` is unset or empty, existing behavior is retained: development
logs email content locally without sending, while other environments use SMTP.
The only supported nonempty value is exactly `disabled`; other values reject
email attempts instead of accidentally falling through to SMTP. Never set
disabled mode on a live service that needs verification or password-reset emails.

Disabled delivery does not auto-verify users, expose tokens through responses,
or bypass login checks. Registration/reset responses retain their existing
wording even though no message is delivered. Newly registered users remain
unverified and cannot log in. Use separately prepared **synthetic verified
fixtures in the isolated database** for ordinary UI testing; never modify real
users or seed a production database. End-to-end email-link testing still needs
the private local harness or a separately approved test-only mail system.
Do not extract authentication links from staging logs. No cloud resources,
secrets, deployment, or production-data access is authorized by this configuration.

## Readiness checks

The listener starts only after MongoDB connects. Configure hosting HTTP health
checks to `/healthz`: it returns 200 only while the Mongo connection is open and
GridFS is initialized, otherwise 503. Responses are non-cacheable, contain no
connection details, and do not create cookies. This reflects driver connection
state, not a database write/read probe. `/api` remains the compatibility status
route and is not a database readiness check.

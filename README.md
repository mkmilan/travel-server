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
Native dependency installation scripts are deliberately disabled during this
baseline. Full application startup may need a separately reviewed native bcrypt
installation; passing these tests is not proof that native dependencies or the
full app work.

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

Verified on 2026-10-21 with Node 24 and MongoDB 7.0.24: **22 integration checks
passed**, covering actual bcrypt login, registration/email verification in
no-send development mode, cookie/bearer auth, logout cookies, CSRF/CORS,
Multer/Sharp/GridFS uploads, public/private/follower photo access, private GPX,
forged attachment rejection and storage ownership on deletion. The test also
checks that authentication failures retain HTTP 401 instead of becoming 500.

This is HTTP integration, not browser cookie-policy or native-device testing.
The fixture does not cover GPS hardware, foreground/background transitions,
external maps or a complete product regression suite. No real data is needed.

## Before running the full application

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
- CSRF error logs no longer include cookie/token values. Existing CSRF protection
  is retained; replacing the archived csurf library is a separate reviewed change.
- Multer is upgraded to the patched 2.x line with upload regression tests. Image
  extension and MIME checks are exact, but are not a substitute for image decoding.

Next gate: exercise login/logout, feed, private/public/follower media, recording
and uploads against the disposable database before any device build or release.

## Remaining review work

This is not a complete security audit or an all-clear. The baseline registry audit
still reports other dependencies to triage. Recommendation JSON attachments and all storage deletions now validate
server-written file ownership, including copied references. Public profile
media/POI metadata still needs a separate privacy review. These fixes do not
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

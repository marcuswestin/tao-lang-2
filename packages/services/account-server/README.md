# Local account reference service

The service starts from a compiler-emitted, trusted `TaoDataPolicy.json` file. It never accepts
policy, caller identity, or a trusted provisioning instruction through the HTTP API.

```sh
./agent auth-review-server \
  --policy PATH/TO/TaoDataPolicy.json \
  --database .artifacts/auth-review/accounts.sqlite \
  --port 4738 \
  --resource auth-review
```

`--policy` is required. The other displayed arguments show their defaults. The default issuer is
`tao-local:auth-review`; `--issuer` overrides it. Repeat `--origin URL` for allowed browser origins.
No origins are accepted implicitly. The listener binds `127.0.0.1`. `--port 0` selects an ephemeral
test port, and `--ready-file PATH` writes its URL and resource for test/process orchestration.

Local email/password registration uses Bun's maintained Argon2id implementation. Email is a login
handle, not a verified contact or application identity. Sessions are opaque, expiry checked, and
resource bound; only token hashes are persisted. The SQLite database holds per-entity rows,
issuer/subject identity mapping, session records, account encryption keys, and operation receipts.
This is a localhost reference implementation, without managed-provider recovery, MFA, passkeys,
linking, or production deployment guarantees.

## Clerk account gateway

This is the application backend that translates a verified Clerk identity into a Tao Account and
resource-scoped data authority. It is not a disposable auth stub. The current launcher still binds
to loopback and supports one gateway process per deployment; production ingress, operations and
migration are not supplied by this reference service.

Use a **fresh database** and add `--clerk-config PATH` to the startup command. The trusted JSON
configuration has this shape (the PEM is Clerk's public JWT verification key, never its secret API key):

```json
{
  "issuer": "https://YOUR_INSTANCE.clerk.accounts.dev",
  "jwtKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "authorizedParties": ["http://localhost:8081"]
}
```

An optional `audience` string or list restricts JWT audiences. The configured issuer and parties
must match the session's `iss` and `azp`; missing required claims, pending sessions, expired proofs
and malformed factor claims fail closed. `--origin` independently allows the browser origin
through CORS. Only public verification material belongs in this gateway configuration.

`POST /v1/auth/clerk/exchange` accepts a Clerk bearer proof and `{ "resource": "auth-review" }`.
It verifies the signature locally with `@clerk/backend`, provisions the issuer/subject mapping,
and returns the existing opaque gateway session. The gateway session never outlives the proof,
including time spent provisioning remote storage. Expired gateway sessions are pruned. Local
password registration/sign-in endpoints are disabled in Clerk mode. Each database binds its auth
mode and Clerk issuer permanently: changing either, or adopting populated legacy local state into
Clerk, requires an explicit future migration. No email-based identity linking is performed.

The Tao binding is `Auth Clerk { PublishableKey "..." Endpoint "..." Resource "auth-review" }`
from `@tao/auth/clerk`. `Datasource Reference` continues to use the same endpoint and resource.
SQLite and self-hosted Instant remain gateway storage choices. The first implemented methods are
password and email code, including signup verification and email-based Device Trust. Required MFA,
other session tasks and unsupported instance requirements fail closed.

### Testing Clerk

Ordinary driver, connection and cryptographic gateway tests work offline. Real sign-in requires
Clerk's hosted development instance, even when the application and gateway run on localhost.
The opt-in browser test uses real Tao UI, synthetic `+clerk_test` addresses and code `424242`;
it does not use the helper that bypasses authentication with a backend ticket.

Configure a dedicated development instance with password and email-code sign-in enabled, no
required phone number, MFA or session tasks, and local browser origins allowed. Supply `CLERK_PUBLISHABLE_KEY`,
`CLERK_SECRET_KEY` and the PEM `CLERK_JWT_KEY` through your shell's secure environment, or add each
with `just secrets add <NAME>` and run `just secrets` once to decrypt the repository store. Explicit
environment values take precedence. Stored values are loaded only after live opt-in; the journey
selects the three Clerk entries without exporting them into the process environment. No secret is
needed in Tao source. From the repository root run:

```sh
TAO_CLERK_LIVE=1 ./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/clerk-auth.test.ts
```

Without opt-in the journey explicitly skips; opted-in missing configuration fails. The test creates
and deletes its own Clerk user, temporary project, gateway database and browser profile. If remote
cleanup fails, it reports the synthetic user ID for manual deletion. Live browser acceptance passed
on 2026-09-26 against the SQLite reference gateway, including both sign-in methods, profile/notes,
reload and logout. Clerk over real Instant storage still needs its own live conformance run.
The gateway requires an `azp` origin claim, which native Clerk proofs may omit. Native
authentication is not a verified pairing; its token/origin contract and physical-device storage
need separate acceptance.

See [Clerk's testing guide](https://clerk.com/docs/guides/development/testing/playwright/overview)
and [test emails and phones](https://clerk.com/docs/guides/development/testing/test-emails-and-phones).

## Self-hosted Instant storage

The same LocalAuth/Reference app can use Instant for application rows and transaction receipts.
Pass `--instant-config PATH` to the service with a private JSON file containing `apiURI`, `appId`,
and `adminToken`. Keep that file outside tracked source. The admin token belongs only to the
service; the Tao app continues to use its resource-bound session against the service endpoint.
SQLite retains passwords, identity mappings, sessions, and offline encryption keys. Back up that
identity database with the Instant deployment; replacing it does not recover the same accounts.
Use a fresh identity database for a new Instant deployment. Switching an existing local database
to Instant requires an explicit migration and is refused by this launcher.

Use a separate Instant app with deny-all client rules. The gateway enforces the compiler-emitted
policy. It stores individual Tao rows in Instant, and commits each operation's receipt with its
row changes. A unique revision record prevents an older read from overwriting newer data;
retries use fresh transaction records and check the original operation's receipt. A failed or
uncertain response is never treated as a confirmed save without a matching receipt.
Startup and acknowledged session revocation also advance the remote revision, so a request left
in flight by an earlier process cannot commit after that boundary.

This slice supports one gateway process per deployment. A process-lifetime local writer lock
rejects a second gateway, and an immutable Instant binding rejects another identity database.
Keep the original database in its original location; copying it to launch another gateway is
unsupported. Policy changes require an explicit migration. The service does not offer distributed
gateway failover. The existing client-side Instant
snapshot adapter remains unsupported with authenticated data.

Run the live conformance suite explicitly after starting the local Instant stack:

```sh
TAO_INSTANT_LIVE_API_URL=http://127.0.0.1:9020 \
  ./agent test-file packages/services/account-server/account-server-tests/instant-live.test.ts
```

Without the endpoint variable these tests are reported as skipped. With it, a missing service
is a failure. The tests create isolated ephemeral apps with restrictive rules; they never reuse
the WordFlower app. Temporary Instant apps expire under the local server's ephemeral-app policy.

The Reference datasource persists only explicitly declared offline working sets, plus pending
write operations, in an authenticated encrypted checkpoint. Native key custody uses the secure
vault. Browser keys remain in memory: after process restart, the user must authenticate online
before the encrypted checkpoint can be recovered. Logout drops live data immediately, removes
the accessible native key after in-flight persistence drains, and retains encrypted pending work
for the same account's later verified recovery. This does not claim browser offline cold-start
support, protection against a compromised same-origin script, or verified native device behavior.

The default `StorageLimitBytes` is 16 MiB per encrypted account checkpoint. Exceeding it or a
platform write failure marks coverage unavailable and fails the write before reporting it queued;
the provider does not evict retained rows to fit. Coverage reports loading, ready at an acknowledged
revision, or unavailable. A known empty set is ready only after a complete initial read and durable
write. Reopening missing storage or changed schema/scope metadata invalidates readiness. Platform
eviction between checks is detected when storage is next reopened; readiness is not a continuous
OS storage guarantee. Rejected writes expose their authored operations through recovery records,
including after the corresponding server row becomes unreadable.

Focused tests use host temporary directories named `tao-account-server-*`,
`tao-reference-provider-*`, `tao-account-launcher-*`, and `tao-auth-review-http-*`, and remove each owned fixture after use.
They exercise real loopback requests, independent server processes, restart and revocation,
authorization denials, constraints and receipts, encrypted persistence, late account-switch
callbacks, storage failures, and runtime baseline preservation. The repository test workflow
owns their invocation.

The Auth Review HTTP journey compiles the real Tao app and its deployment policy, drives its UI
in the React Native test host, and verifies saved profile and note rows through a separate HTTP
client. It opts into `TAO_TEST_REAL_HTTP=1`, which preserves Node's actual fetch transport around
Expo's otherwise non-networking native test mocks. The harness awaits finite auth operations
before assertions; it does not wait for user interaction in a presented sign-in flow. The test
host still mocks device storage and rendering, so this is not physical-device acceptance.

The cold-process provider test uses a persistent-vault fixture and encrypted disk checkpoints
with network requests disabled. It establishes provider restart behavior without claiming a
browser secret store or physical-device Keychain/Keystore acceptance. Offline logout revocation
retry is owned by the auth adapter; browser memory-only retry records cannot survive process exit.

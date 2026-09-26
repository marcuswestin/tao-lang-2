# Local account reference service

The service starts from a compiler-emitted, trusted `TaoDataPolicy.json` file. It never accepts
policy, caller identity, or a trusted provisioning instruction through the HTTP API.

```sh
bun run packages/services/account-server/account-server-src/serve.ts \
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

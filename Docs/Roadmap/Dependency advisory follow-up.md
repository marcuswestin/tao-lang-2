# Dependency advisory follow-up

The 2026-09-21 dependency remediation started from `main` at `dd7eaac7`. `bun audit --json`
reported 43 advisory records across 12 transitive package families. Compatible package overrides,
the VSIX packager update, and targeted locked patch releases reduced that to one record. The
installed nested links now match `bun.lock`; the linked
[developer-environment entry](<Developer environment upgrades/Archive/DEVENV-LOCK-UPDATE-KEEPS-STALE-TRANSITIVE-LINKS.md>)
records the stale-link reproduction and repair.

## Open advisory register

| Item                                                                                                  | Disposition                                                                                                                                                                                     | Owner                          | Review by  |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------- |
| [`uuid` advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)                                  | Locked `xcode@3.0.1 → uuid@7.0.3` remains; no affected call found in the last installed-parent review. Recheck callers and upstream releases.                                                   | the Developer, until delegated | 2026-10-05 |
| [`stream-json` advisory](https://github.com/uhop/stream-json/security/advisories/GHSA-528h-pc64-c93x) | Locked `jayson@4.3.0 → stream-json@1.9.1` remains; the last installed-parent review found only excluded `StreamValues` use. Recheck compatible upstream remediation.                            | the Developer, until delegated | 2026-10-05 |
| Nixpkgs glibc input                                                                                   | The pinned patch lacks newer CVE markers; a realized Linux closure and updated-input acceptance remain unproved. The interrupted run was recovered; arrange the input update and closure proof. | the Developer, until delegated | 2026-09-30 |

At each review, record the new evidence and either close the item or set a new review date and
owner. A review date schedules reassessment; it does not claim the advisory is fixed.

### 2026-09-24 review

`bun audit --json` still reports one moderate record: `uuid@7.0.3` through
`@expo/config-plugins@57.0.9 → xcode@3.0.1`. The official advisory still limits the
affected methods to `v3`/`v5`/`v6` with caller-owned buffers, while that installed
`xcode` parent calls `uuid.v4()` without one. The record remains unresolved, with no
reachable affected call demonstrated; the Developer remains its owner and September 28
its review date. `devenv.lock` still pins `73c703c22422b8951895a960959dbbaca7296492`.
The Nixpkgs tracker was checked, but no updated patch comparison or Linux closure was
available; the same owner and review date remain. No dependency or lockfile changed.

### 2026-09-25 review

`bun audit --json` still reports exactly one moderate record,
[`GHSA-w5hq-g745-h8pq`](https://github.com/advisories/GHSA-w5hq-g745-h8pq), for the installed
`xcode@3.0.1 → uuid@7.0.3` path. The installed parent still calls `uuid.v4()` without a buffer;
the advisory identifies the `v3`/`v5`/`v6` APIs with caller-provided buffers. No affected call
was demonstrated through this parent. The current Appium pins yielded no additional Bun audit
record. The `devenv.lock` Nixpkgs input remains `73c703c22422b8951895a960959dbbaca7296492`;
its glibc patch lacks six CVE-tagged fixes present in a later Nixpkgs patch, but this Darwin host
cannot establish exposure or a passing Linux closure. Both entries remain open with the Developer
as owner until delegated and September 28 as the review date. No dependency or lockfile changed.

### 2026-09-27 review

At `0e3f6a9b`, `bun audit --json` reports two moderate records: the existing `uuid` record
and `stream-json@1.9.1` ([GHSA-528h-pc64-c93x](https://github.com/uhop/stream-json/security/advisories/GHSA-528h-pc64-c93x)).
The latter enters through the Clerk/Solana dependency graph, `@solana/web3.js@1.99.0`, and
`jayson@4.3.0`. The installed `jayson/lib/utils.js` imports `StreamValues` and `Verifier` and
calls `StreamValues.withParser()`. The upstream advisory concerns the `pick`, `ignore`, `filter`,
and `replace` path filters and explicitly excludes `streamValues`; no affected caller was found
in this parent or direct Tao imports. The published repair is `3.5.0`, outside the parent's
`^1.9.1` range. Keep the record open without forcing an incompatible major override.

The installed `xcode` parent still calls `uuid@7.0.3` through argument-free `v4`, as does
`jayson` with its separate `uuid@8.3.2`; no
affected `v3`/`v5`/`v6` call was demonstrated. The Appium pins add no further audit records.
The Nixpkgs input is unchanged. Fetching the two immutable patch sources linked below found
seven newer CVE markers absent from the pinned patch, including `CVE-2026-5435` omitted from
the previous comparison. This is patch evidence, not a realized Linux closure or a demonstrated
vulnerable Tao execution path. All three advisory follow-ups retain the Developer as owner
until delegated and September 28 as the review date. No dependency or lockfile changed.

### 2026-09-28 review

The current `bun.lock` still contains `xcode@3.0.1 → uuid@7.0.3` and
`@solana/web3.js@1.99.0 → jayson@4.3.0 → stream-json@1.9.1`. The upstream
[`uuid` advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) still describes
caller-owned buffers for `v3`/`v5`/`v6`; the
[`stream-json` advisory](https://github.com/uhop/stream-json/security/advisories/GHSA-528h-pc64-c93x)
still names path filters rather than `StreamValues`. This pass did not reinstall packages or
repeat an installed-caller or `bun audit` trace, so the September 27 reachability assessment is
the latest such evidence. No compatible lockfile-only remediation was established. Keep both
records open with the Developer as owner until delegated and October 5 as the next review date.

`devenv.lock` still pins `73c703c22422b8951895a960959dbbaca7296492`. Comparison of its
[pinned glibc patch](https://raw.githubusercontent.com/NixOS/nixpkgs/73c703c22422b8951895a960959dbbaca7296492/pkgs/development/libraries/glibc/2.42-master.patch)
with the [later patch](https://raw.githubusercontent.com/NixOS/nixpkgs/79b35bf0bda5cd110f856aa5b5b2c5ba4460dbf5/pkgs/development/libraries/glibc/2.42-master.patch)
still finds seven newer CVE markers absent from the pinned file. The ARM64 contributor run
started from committed `39aac77c`, then its host runner stopped. The approved ownership-checked
recovery collected the exact exited cold guest's complete passing workflow evidence and removed
its run-specific resources. The original runner had no normal terminal receipt and the cached
guest did not start. A fresh cold guest on committed `e639461c` passed; its host runner was
interrupted again while the cached guest remained active. Exact recovery collected the cached
guest's test and verify failure from an unhandled CLI stdin `EPIPE` and removed its run-specific
resources. The fix passed all cold ARM64 stages on committed `160c05bd`; the host stopped before
cached mode began. A later committed `47a6b80e` run reached both native modes, but their
`test-all` stages failed on the shared closed-pipe regression; both `verify` stages passed.
After the synchronous-error correction, committed `eaea244f` passed a fresh native ARM64 cold and
cached contributor run with normal host exit and cleanup. This validates that contributor workflow,
not the updated Nixpkgs input. The earlier transfer log names two glibc paths, which does not
identify the realized runtime closure. Retain the Developer as owner until delegated, review
by September 30, and require the updated-input Linux closure proof described below before
closing. No package or lockfile changed in this review.

## Bun/npm graph

- **Remaining: `uuid@7.0.3` through `@expo/config-plugins → xcode@3.0.1`.**
  [`GHSA-w5hq-g745-h8pq`](https://github.com/advisories/GHSA-w5hq-g745-h8pq) affects the
  `v3`, `v5`, and `v6` APIs when passed a caller-owned output buffer. The installed `xcode@3.0.1`
  source calls only `uuid.v4()` (`lib/pbxProject.js:90`); no affected call was found in that parent.
  `xcode@3.0.1` is the latest published xcode release and pins `uuid: ^7.0.3`. Keep this as an
  unresolved audit record, with no demonstrated reachable vulnerable call in Tao's current Expo
  configuration path. Revisit when Expo or xcode changes that dependency, or if another caller of
  this installed `uuid` version appears. Do not force an incompatible `uuid` major for the sake of
  an empty audit result.
- **Resolved by this change:** The other 42 records covered `baseline-browser-mapping`,
  `brace-expansion`, `browserslist`, `fast-uri`, `form-data`, `hono`, `js-yaml`, `linkify-it`, `qs`,
  `shell-quote`, and `undici`. The `brace-expansion` and `js-yaml` lock entries were moved to
  patched releases within their existing major versions, with package dependencies, binary paths,
  and tarball integrity checked against the npm registry before frozen installation. An ordinary
  `./agent setup --refresh-lockfile` retained those resolutions.

## Linux Nixpkgs input

`devenv.lock` still pins Nixpkgs source `73c703c22422b8951895a960959dbbaca7296492`. Its
[glibc definition](https://raw.githubusercontent.com/NixOS/nixpkgs/73c703c22422b8951895a960959dbbaca7296492/pkgs/development/libraries/glibc/common.nix)
builds `2.42-61` with backported fixes. A later
[Nixpkgs glibc patch](https://raw.githubusercontent.com/NixOS/nixpkgs/79b35bf0bda5cd110f856aa5b5b2c5ba4460dbf5/pkgs/development/libraries/glibc/2.42-master.patch)
contains subsequent fixes for CVE-2026-4046, CVE-2026-5435, CVE-2026-5450, CVE-2026-5928, CVE-2026-6238,
CVE-2026-6368, and CVE-2026-6791. A tracker match on the bare glibc version alone is not proof
that a backported CVE is still present; compare the pinned patch with upstream fixes and the
[Nixpkgs tracker](https://tracker.security.nixos.org/).

The earlier `devenv update nixpkgs --no-tui` attempt could not resolve `github.com` on this host,
including outside the managed shell, so no lock update or updated-input Linux closure acceptance
is claimed. Contributor verification of the unchanged input does not establish its glibc patch exposure. On a network-enabled Linux
host, update the input, inspect its glibc patches against current upstream notices, build and
activate a fresh `x86_64-linux` profile, inspect the realized closure and glibc version, and run
the complete repository gate and relevant Android/Node smoke checks. Record the new lock revision
and output before closing this item. Review all live items at the next dependency-security pass.

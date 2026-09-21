# Dependency advisory follow-up

The 2026-09-21 dependency remediation started from `main` at `dd7eaac7`. `bun audit --json`
reported 43 advisory records across 12 transitive package families. Compatible package overrides,
the VSIX packager update, and targeted locked patch releases reduced that to one record. The
installed nested links now match `bun.lock`; the linked
[developer-environment entry](<Developer environment upgrades/Archive/DEVENV-LOCK-UPDATE-KEEPS-STALE-TRANSITIVE-LINKS.md>)
records the stale-link reproduction and repair.

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
- **Resolved in the proposed branch:** The other 42 records covered `baseline-browser-mapping`,
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
contains subsequent fixes for CVE-2026-4046, CVE-2026-5450, CVE-2026-5928, CVE-2026-6238,
CVE-2026-6368, and CVE-2026-6791. A tracker match on the bare glibc version alone is not proof
that a backported CVE is still present; compare the pinned patch with upstream fixes and the
[Nixpkgs tracker](https://tracker.security.nixos.org/).

`devenv update nixpkgs --no-tui` could not resolve `github.com` on this host, including outside
the managed shell, so no lock update or Linux acceptance is claimed. On a network-enabled Linux
host, update the input, inspect its glibc patches against current upstream notices, build and
activate a fresh `x86_64-linux` profile, inspect the realized closure and glibc version, and run
the complete repository gate and relevant Android/Node smoke checks. Record the new lock revision
and output before closing this item. Review both live items at the next dependency-security pass.

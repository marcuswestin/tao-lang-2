# DEVENV-096 — The devenv Bun cannot produce a runnable compiled binary on macOS 27

- **Status:** Resolved
- **Section:** External
- **Area:** Toolchain pin
- **Impact:** `bun build --compile` is the mechanism behind the standalone `tao` executable
  (`Docs/MVP Roadmap/Plan - Standalone Tao CLI.md`). With the Bun the shared devenv profile supplies,
  every compiled binary is invalid-signed and killed by the kernel on this host, so the whole
  approach looks impossible rather than merely unpinned. It is slice 1 of that plan and blocks the
  rest of it.
- **Evidence:** 2026-09-17 on macOS 27.0 (26A428), arm64. `bun build --compile` of a one-line
  `console.log` with the profile's Bun 1.3.13 produced a 63,060,304-byte binary whose ad-hoc
  signature covers 15275 x 4096 = 62,566,400 bytes; running it exits 137 (SIGKILL) and
  `codesign -v -vvv` reports `invalid signature (code or signature have been modified)`. Re-signing
  is refused: `codesign --force --sign -` answers `main executable failed strict validation`. The
  official 1.3.13 release behaves identically, so it is the version and not the Nix build. Across
  official releases on the same host and input: 1.3.13 invalid and killed, 1.3.14 invalid but ran
  once (a signature cache, not a fix), 1.4.0 invalid and killed, 1.4.2 valid and runs. A 1.4.2 binary
  also survives `codesign --force --sign - --options runtime` and still runs `tao check`, which is
  what notarization needs. Reproduced on 2026-09-22 in the standalone CLI bootstrap worktree:
  the old 1.3.13 profile's compiled `hello` failed `codesign --verify` and exited 137; the new
  1.4.2 profile's compiled `hello` passed signature validation and printed `hello`. The compiled
  Tao CLI also passed signature validation and ran `--help`, `fmt`, and `check` from outside the
  checkout on a self-contained Tao project. Bun 1.4.2 stopped native file-edit events in two
  CLI watch tests on this host, so the shared watcher now polls on macOS for that version; both
  tests pass without a test-only environment override.
- **Workaround:** Download an official Bun 1.4.2 and call it explicitly for `--compile` work; the
  profile's Bun remains correct for everything else.
- **Proposed change:** Pin Bun 1.4.2 through a dedicated `bun-nixpkgs` input and
  `languages.javascript.bun.package`, leaving the other toolchain packages on their existing
  nixpkgs pin. Refresh each worktree's profile to adopt it and verify the complete gate against
  the new profile.
- **Dependencies:** None.
- **Acceptance:** `bun build --compile` from the profile's Bun produces a binary that `codesign -v`
  calls valid and that runs on macOS 27, and `verify --complete` passes on the bumped profile.
- **Source:** 2026-09-17 standalone Tao CLI planning task.
- **Archived:** 2026-09-22

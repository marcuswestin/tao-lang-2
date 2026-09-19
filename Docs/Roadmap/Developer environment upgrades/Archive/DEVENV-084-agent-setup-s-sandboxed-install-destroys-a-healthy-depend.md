# DEVENV-084 — `./agent`'s dependency repair could only ever damage the tree it repaired

- **Status:** Resolved
- **Area:** Dependency installation
- **Impact:** `repair_dev_deps_if_unhealthy` ran `bun install --frozen-lockfile --force` whenever the
  dependency probe failed. `--force` re-links every package, including the few shipping `.idea/` or
  `.gitmodules` that an agent sandbox protects and no setting exempts, so a sandboxed repair was
  guaranteed to fail — and to fail partway, after it had begun replacing packages. A tree that was
  unhealthy in one package came back unhealthy in several, and the recovery the failure printed was
  the only way out. The ordinary `./agent` path was never affected: `needs_install` compares the
  stamp against `package.json`, `bun.lock`, and the dev package's manifest, so an untouched lockfile
  installs nothing at all.
- **Evidence:** `./agent test-file packages/tao-cli/cli-tests/test-cache.test.ts` printed `EEXIST:
  File or folder exists: failed to link package: uri-templates@0.2.0 (clonefileat)` for four
  packages and `Failed to install 4 packages`. `rm -rf node_modules && bun install --frozen-lockfile`
  unsandboxed restored the tree, and the next sandboxed `./agent` call that reached the repair path
  broke it identically.
- **Not the cause:** the same session read `ls node_modules | wc -l` → `5` as a partial tree. Five is
  this repository's healthy count: Bun's isolated install keeps the 1,265 real packages under
  `node_modules/.bun` and links only `@types`, `knip`, `rulesync`, `typescript`, and
  `typescript-native` at the top level. Any future measurement of install health should count
  `node_modules/.bun`, or run `bun run packages/dev/dev-src/doctor/DependencyHealth.ts`.
- **Workaround:** `./dev <command>` instead of `./agent <command>`, which runs no setup.
- **Change made:** the repair now runs a plain `--frozen-lockfile` install first and re-probes, and
  escalates to `--force` only for a tree still unhealthy after that. A plain install writes what is
  missing without relinking what is healthy, which is what an unhealthy tree needs; `--force` stays
  available for the case that genuinely calls for replacing packages wholesale.
- **Dependencies:** DEVENV-040 covers the neighbouring case of a genuinely stale link whose removal
  the sandbox blocks. This entry was about a forced install that had nothing to replace.
- **Acceptance:** two consecutive sandboxed `./agent test-file` runs against an unchanged lockfile
  both execute the test, and `node_modules/.bun` holds the same package count afterwards as before.
- **Source:** 2026-09-19 Tao CLI stdlib-fingerprint work, corrected the same day against the script.
- **Archived:** 2026-09-19

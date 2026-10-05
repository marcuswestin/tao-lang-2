# DEVENV-AGENT-BUNDLE-MISSES-VERIFICATION-SOURCE-CHANGES — Agent bundle misses verification source changes

- **Status:** Resolved
- **Area:** Repository workflow bootstrap and visibility preflight.
- **Impact:** A workflow can enforce an older visibility policy after its source changes, making the
  live command disagree with focused source tests.
- **Evidence:** On 2026-10-03 in the shared `dev/ro` checkout, the quiet WDA transport probe was
  classified as quiet by the updated source and its focused test, but the cached agent bundle still
  refused it as visible. The `agent` rebuild predicate watched agent-cli, cli-kit and shared sources,
  while its bundled runner also imports verification code. Adding verification sources and its
  manifest to that predicate made the same named command run successfully without a visibility flag.
  The real-host probe passed first in log
  `.artifacts/logs/agent/studio-smoke/2026-10-03T17-35-25-398Z-51812.log`, then passed its expanded four
  cases in `.artifacts/logs/agent/studio-smoke/2026-10-03T17-41-49-289Z-62987.log`.
- **Workaround:** None required after the source correction.
- **Proposed change:** Track the verification package sources and manifest in the agent bundle's
  rebuild predicate, preserving scoped native visibility checks.
- **Dependencies:** None.
- **Acceptance:** The source visibility tests pass; the supported quiet native registration probe
  runs through the rebuilt workflow without `--show-studio`. Independent review found no new
  high-confidence issue in the bootstrap change. This does not prove visible native focus behavior.
- **Source:** Managed-loop and isolated native acceptance execution, 2026-10-03.
- **Archived:** 2026-10-03

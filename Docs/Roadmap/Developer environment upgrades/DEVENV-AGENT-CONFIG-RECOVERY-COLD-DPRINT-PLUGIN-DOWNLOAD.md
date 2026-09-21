# DEVENV-AGENT-CONFIG-RECOVERY-COLD-DPRINT-PLUGIN-DOWNLOAD — Agent-config recovery can download dprint plugins

- **Status:** Candidate
- **Section:** External
- **Area:** Agent configuration recovery, sandbox boundary
- **Impact:** `fix-agent-config` is excluded from the harness sandbox on the premise that it reaches no
  network. Its dprint step can fetch a remote plugin when the cache is cold, so that premise does
  not hold on a fresh host even after dependency bootstrap is made install-free.
- **Evidence:** 2026-09-21, `Justfile`'s `fix-agent-config` recipe calls `dprint fmt`, while
  `config/dprint.jsonc` names three `https://plugins.dprint.dev/*.wasm` plugins. With an empty
  `DPRINT_CACHE_DIR` and an unavailable proxy, `dprint output-resolved-config` failed with
  `Error downloading https://plugins.dprint.dev/typescript-0.96.1.wasm` and `Connection refused`.
  This is a cold-cache reproduction of the network attempt without downloading a plugin.
- **Workaround:** Run recovery only after the pinned dprint plugins have been fetched by a normal
  sandboxed workflow. A warm cache is an observation, not an enforced boundary.
- **Proposed change:** Make the recovery path fail closed when its formatter plugins are unavailable
  locally, or run the formatter under a narrower profile that denies network access while retaining
  the required writes to protected agent configuration.
- **Dependencies:** DEVENV-101 for the protected skill-file write context; DEVENV-111 for the
  inherited Seatbelt profile constraint.
- **Acceptance:** A cold-cache `fix-agent-config` attempt cannot reach an external address and
  reports how to populate the cache in the normal sandboxed workflow; a warm-cache attempt still
  formats skills and regenerates harness configuration.
- **Source:** 2026-09-21 recurring repository pass.

# DEVENV-AGENT-CONFIG-RECOVERY-COLD-DPRINT-PLUGIN-DOWNLOAD — Agent-config recovery can download dprint plugins

- **Status:** Resolved
- **Section:** External
- **Area:** Agent configuration recovery, sandbox boundary
- **Impact:** `fix-agent-config` is excluded from the harness sandbox on the premise that it reaches no
  network. Its dprint step can fetch a remote plugin when the cache is cold, so that premise does
  not hold on a fresh host even after dependency bootstrap is made install-free.
- **Evidence:** 2026-09-21, `Justfile`'s `fix-agent-config` recipe calls `dprint fmt`, while
  `config/dprint.jsonc` names three `https://plugins.dprint.dev/*.wasm` plugins. With an empty
  `DPRINT_CACHE_DIR` and an unavailable proxy, `dprint output-resolved-config` failed with
  `Error downloading https://plugins.dprint.dev/typescript-0.96.1.wasm` and `Connection refused`.
  After the dependency update and `./agent setup`, a cold-cache `dprint check --incremental=false
  --allow-no-files 'agents/skills/**/*'` with all proxy variables pointed at an unavailable local
  port compiled all three plugins from `node_modules` and passed. The plugin configuration now names
  only local paths; absent packages cause a local file error instead of a remote fetch.
- **Workaround:** None needed after `./agent setup`.
- **Proposed change:** Pin the three dprint plugin packages as root development dependencies and
  resolve their local WASM files in `config/dprint.jsonc`.
- **Dependencies:** DEVENV-101 for the protected skill-file write context; DEVENV-111 for the
  inherited Seatbelt profile constraint.
- **Acceptance:** After `./agent setup`, a cold-cache dprint run with an unavailable proxy loads
  only local plugin files and passes; normal agent-config recovery still formats skills and
  regenerates harness configuration.
- **Source:** 2026-09-21 recurring repository pass.
- **Archived:** 2026-09-21

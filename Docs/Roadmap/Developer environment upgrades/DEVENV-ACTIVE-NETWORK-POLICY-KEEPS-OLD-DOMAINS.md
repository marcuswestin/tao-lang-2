# DEVENV-ACTIVE-NETWORK-POLICY-KEEPS-OLD-DOMAINS — Active network policy keeps old domains

- **Status:** Blocked
- **Section:** External
- **Area:** Shared harness network configuration and native Studio provisioning
- **Impact:** A session that adds required artifact domains can still fail native verification after regenerating its configuration, preventing the authorized landing.
- **Evidence:** On 2026-09-26, canonical rules and both generated harness configurations permitted `hutch.blackboard.sh` and `electrobun-artifacts.blackboard.sh`. Nix environment setup provisioned Hutch 0.24.3 successfully. Landing then failed at `hutch install` with `could not resolve Cottontail to load hutch.config.ts: ReleaseDownloadFailed`; log `.artifacts/logs/verify-full/2026-09-26T20-45-28-764Z-27086-1d3e5890/studio-smoke-native.log`. A read-only request to `https://electrobun-artifacts.blackboard.sh/cottontail/releases/0.5.0/manifest.json` returned HTTP 403 with `x-proxy-error: blocked-by-allowlist` in the still-active session. The Hutch artifact origin was also denied.
- **Workaround:** Resume in a fresh session that loads this checkout's regenerated policy, or run the authorized landing from a normal terminal. Do not skip native verification.
- **Proposed change:** Verify policy reload in a fresh session; retain clear setup and download diagnostics if the harness does not support live policy refresh.
- **Dependencies:** Effective session network policy must permit the configured artifact domains.
- **Acceptance:** The pinned Cottontail manifest and archive download succeed under the intended agent policy, and native Studio verification completes from an initially empty cache.
- **Source:** Hook naming, Watchman management, and initial verification performance task, 2026-09-26.

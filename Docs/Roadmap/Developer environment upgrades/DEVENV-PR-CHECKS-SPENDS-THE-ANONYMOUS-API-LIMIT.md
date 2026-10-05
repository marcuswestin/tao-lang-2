# DEVENV-PR-CHECKS-SPENDS-THE-ANONYMOUS-API-LIMIT — Following checks spends GitHub's anonymous API limit

- **Status:** Candidate
- **Section:** External
- **Area:** Hosted verification commands run without `open-pr`: `pr-checks --wait` and `ci-timings`.
- **Impact:** Without a configured token, these standalone commands share GitHub's anonymous REST limit of 60 requests an hour per address. Polling checks plus a few timing comparisons can exhaust it. Hosted `open-pr` and `merge-pr` now follow checks with the existing CLI login.
- **Evidence:** On 2026-10-05, `feat/ci-nix-store-cache` pushed twice with `./agent unsandboxed open-pr`. Both pushes landed, then each run exited 1 with "GitHub's anonymous rate limit is spent until 2026-10-05T16:25:34.000Z; set GH_TOKEN to lift it." Logs: `.artifacts/logs/agent/open-pr/2026-10-05T15-57-02-832Z-17879.log`. The same hour's authenticated `gh api rate_limit` showed 5000 requests remaining.
- **Workaround:** Use a configured `GH_TOKEN` for standalone reads, or wait for the reset the message names. Never print or copy credentials into reports.
- **Proposed change:** `open-pr` and `merge-pr` follow checks with the `gh` login (`ghAuth`). Give `ci-timings` and a host-run `pr-checks` the same authenticated path, keeping anonymous reads available in the sandbox.
- **Dependencies:** Any change to `open-pr`'s host behavior needs the Developer's approval under the unsandboxed-operation rule.
- **Acceptance:** Three `ci-timings` comparisons and a `pr-checks --wait` run on the host within one hour all complete.
- **Source:** CI bootstrap caching, `feat/ci-nix-store-cache`, 2026-10-05.

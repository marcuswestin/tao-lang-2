# DEVENV-PR-CHECKS-SPENDS-THE-ANONYMOUS-API-LIMIT — Following checks spends GitHub's anonymous API limit

- **Status:** Candidate
- **Section:** External
- **Area:** Hosted verification commands: `open-pr`, `pr-checks --wait`, `ci-timings`.
- **Impact:** These commands read GitHub's public REST API without credentials, sharing a limit of 60 requests an hour per address. Polling one pull request's checks, plus a few `ci-timings` comparisons, spends it within the hour, after which `open-pr` stops following checks right after its push and exits failed.
- **Evidence:** On 2026-10-05, `feat/ci-nix-store-cache` pushed twice with `./agent unsandboxed open-pr`. Both pushes landed, then each run exited 1 with "GitHub's anonymous rate limit is spent until 2026-10-05T16:25:34.000Z; set GH_TOKEN to lift it." Logs: `.artifacts/logs/agent/open-pr/2026-10-05T15-57-02-832Z-17879.log`. The same hour's authenticated `gh api rate_limit` showed 5000 requests remaining.
- **Workaround:** Follow the run with `gh run watch <id>` from an unsandboxed shell, or wait for the reset the message names.
- **Proposed change:** When `open-pr` runs on the host, where `gh` is authenticated, follow checks through `gh api` rather than anonymous `fetch`, keeping the anonymous path for the sandbox. Alternatively, have `pr-checks --wait` honor the `ETag` it already sends, so an unchanged 304 response does not count against the limit, and poll less often while every check is queued.
- **Dependencies:** Any change to `open-pr`'s host behavior needs the Developer's approval under the unsandboxed-operation rule.
- **Acceptance:** Two `open-pr` runs and three `ci-timings` comparisons within one hour all follow their checks to a verdict.
- **Source:** CI bootstrap caching, `feat/ci-nix-store-cache`, 2026-10-05.

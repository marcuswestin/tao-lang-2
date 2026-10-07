# DEVENV-OPEN-PR-GIVES-UP-ON-TRANSIENT-GITHUB-SERVER-ERRORS — open-pr gives up on transient GitHub server errors

- **Status:** Candidate
- **Section:** External
- **Area:** Landing through `./agent unsandboxed open-pr`.
- **Impact:** One GitHub 5xx during the push or the first check poll ends the landing, and the agent reruns the whole command by hand; a push accepted during the outage can also leave a head with no check suite, which costs a further empty commit.
- **Evidence:** On 2026-10-07, landing `feat/repository-pass-2026-10-07` (PR #77): two `open-pr` runs failed at `git push` with `remote: Internal Server Error` (16:53:56Z and 16:54:07Z). A manual push loop failed twice more with the same error and succeeded on its third try, about six minutes later. The next `open-pr` run failed on its first poll with `gh: HTTP 500` from `gh api "repos/{owner}/{repo}/commits/b88f4905…/check-runs?per_page=1"`. The run after that waited 180 s and reported that `b88f4905` had no check suite at all, so the push event never reached Actions. GitHub's status page showed all systems operational throughout.
- **Workaround:** Retry the push by hand until it lands, rerun `open-pr`, and push a new head when it reports no check suite.
- **Proposed change:** In `OpenPrCommand`, retry `git push` and the check-run poll on a 5xx or `Internal Server Error` with a bounded backoff (for example three tries over about two minutes), printing each retry. Keep the existing no-check-suite diagnosis as the final answer once retries are spent.
- **Dependencies:** None.
- **Acceptance:** A focused test with a fake push and fake `gh api` that fail with a server error once, then succeed, shows `open-pr` continuing to the check wait; a persistent failure still exits with the original error after the bounded retries.
- **Source:** Landing of `feat/repository-pass-2026-10-07`, 2026-10-07; `packages/cli/dev-cli/dev-cli-src/pr/OpenPrCommand.ts`.

# DEVENV-NO-ARM-LINUX-RUN-ON-HOSTED-CI — no ARM Linux run on hosted CI

- **Status:** Planned
- **Section:** Deferred
- **Area:** `.github/workflows/`. Hosted Verify runs only on `ubuntu-24.04`, which is x86-64.
- **Impact:** Nothing on hosted CI runs the repository on ARM Linux, which is what the local Tart Ubuntu contributor check and Apple Silicon Linux VMs run. An ARM-only failure appears only when someone runs the local check.
- **Evidence:** 2026-10-07: every `runs-on` in `.github/workflows/verify.yml` is `ubuntu-24.04`. GitHub has offered `ubuntu-24.04-arm` standard runners to private repositories since 2026-01-29, with 2 vCPUs there. A 2026-09-03 notice names the Team and Enterprise Cloud plans, so the organization's plan decides availability.
- **Workaround:** Run `./agent unsandboxed contributor-linux-test` locally.
- **Proposed change:** Decided 2026-10-07: add a nightly workflow on `ubuntu-24.04-arm` that runs the contributor path from the getting-started instructions and a few Verify partitions. Keep it off pull requests: at 2 vCPUs, the full suite would run noticeably slower. Report a red nightly run the way other advisory nightly checks on `main` are reported.
- **Dependencies:** The organization's plan must include ARM runners for private repositories.
- **Acceptance:** A scheduled run on `ubuntu-24.04-arm` completes the contributor path and its selected partitions on `main`, and a failure is visible without opening the Actions page.
- **Source:** Decision round after the October 7 afternoon repository pass.

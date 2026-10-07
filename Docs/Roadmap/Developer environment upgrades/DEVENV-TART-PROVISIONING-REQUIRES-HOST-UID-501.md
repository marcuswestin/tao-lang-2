# DEVENV-TART-PROVISIONING-REQUIRES-HOST-UID-501 — Tart provisioning requires host uid 501

- **Status:** Candidate
- **Section:** External
- **Area:** `packages/cli/tao-cli/cli-src/standalone-vm.ts` `provision`, used by `standalone-cli-clean-machine` (vanilla and Xcode) and `contributor-macos-test`.
- **Impact:** Every macOS isolation check fails before boot on a host account whose uid is not 501. Offline provisioning attaches the stopped clone's disk with `-owners on` and writes the harness into `Users/admin` as the host user. It refuses unless the guest admin's owner matches the host's, and the upstream Cirrus Labs images give `admin` uid 501. Matching worked only because the first account on a Mac is 501.
- **Evidence:** 2026-10-07, the afternoon repository pass, on host account uid 503. `./agent unsandboxed standalone-cli-clean-machine` at `63e027607` pulled `ghcr.io/cirruslabs/macos-tahoe-vanilla@sha256:eeec54bf…` (865 s), then failed provisioning after 15 s: `Guest admin ownership 501:20 differs from host 503:20.` (`standalone-vm.ts:232-236`). The run logs are in `.artifacts/standalone-vm/tao-acceptance-1791402497-64188/logs` and the clone was cleaned up. `contributor-macos-test.sh:133` calls the same `provision`, so the contributor check and the prepared Xcode base share the failure.
- **Workaround:** Run the checks from a uid-501 account.
- **Proposed change:** The Developer approved copying the harness in after boot through the guest agent. The vanilla image has no guest agent, so the agent's binary and its LaunchAgent must be written to the stopped disk before boot (`vm-guest-lib.sh:71`). `exec` cannot carry the agent in, and the transport deliberately uses no SSH and no shared folders. Three routes remain:
  - Write the agent's bootstrap as root and `chown` it to uid 501, then copy everything else in through `exec` after boot. This runs `sudo` inside an unsandboxed operation.
  - Attach the disk with `-owners off`, so new files take the unknown owner, uid 99, which the guest reads as `admin`. The filesystem audit checks for uid 501 (`standalone-filesystem-audit.ts:534-574`), and it reads ownership from this mount. It would have to snapshot through a second `-owners on` attachment.
  - Keep uid 501 as a documented host requirement.
- **Dependencies:** The Developer's choice among those routes.
- **Acceptance:** Vanilla acceptance and `contributor-macos-test` pass their provisioning step from a host account whose uid is not 501.
- **Source:** Isolation checks of the October 7 afternoon repository pass.

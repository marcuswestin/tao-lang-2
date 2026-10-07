# DEVENV-TART-PROVISIONING-REQUIRES-HOST-UID-501 — Tart provisioning requires host uid 501

- **Status:** Candidate
- **Section:** External
- **Area:** `packages/cli/tao-cli/cli-src/standalone-vm.ts` `provision`, used by `standalone-cli-clean-machine` (vanilla and Xcode) and `contributor-macos-test`.
- **Impact:** Every macOS isolation check fails before boot on a host account whose uid is not 501. Offline provisioning attaches the stopped clone's disk with `-owners on` and writes the harness into `Users/admin` as the host user. It refuses unless the guest admin's owner matches the host's, and the upstream Cirrus Labs images give `admin` uid 501. Matching worked only because the first account on a Mac is 501.
- **Evidence:** 2026-10-07, the afternoon repository pass, on host account uid 503. `./agent unsandboxed standalone-cli-clean-machine` at `63e027607` pulled `ghcr.io/cirruslabs/macos-tahoe-vanilla@sha256:eeec54bf…` (865 s), then failed provisioning after 15 s: `Guest admin ownership 501:20 differs from host 503:20.` (`standalone-vm.ts:232-236`). The run logs are in `.artifacts/standalone-vm/tao-acceptance-1791402497-64188/logs` and the clone was cleaned up. `contributor-macos-test.sh:133` calls the same `provision`, so the contributor check and the prepared Xcode base share the failure.
- **Workaround:** Run the checks from a uid-501 account.
- **Proposed change:** Provision without host-side ownership. Either copy the harness in after boot through the guest agent, as `exec` already runs, or share it read-only with `tart run --dir` and copy it in from the guest. The alternative is to write it as root and `chown` it to the guest admin's uid, which widens what the unsandboxed operation runs. Both change an unsandboxed operation and need the Developer's approval.
- **Dependencies:** The Developer's choice of provisioning route.
- **Acceptance:** Vanilla acceptance and `contributor-macos-test` pass their provisioning step from a host account whose uid is not 501.
- **Source:** Isolation checks of the October 7 afternoon repository pass.

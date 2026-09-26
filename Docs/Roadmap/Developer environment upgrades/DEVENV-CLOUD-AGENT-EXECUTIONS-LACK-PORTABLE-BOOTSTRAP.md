# DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP — Cloud agent executions lack a portable bootstrap

- **Status:** Blocked
- **Section:** Deferred
- **Area:** Agent workflow; cloud development environment
- **Impact:** A cloud agent container without zsh or the pinned Nix/devenv profile cannot start the repository's `./agent` workflow, so it cannot set up, test, or verify a checkout.
- **Evidence:** On 2026-09-25, a cloud execution reported that `./agent` required zsh and a Nix/devenv profile, neither of which was present in its container. The interactive local shell has landed. The 2026-09-26 continuation on `feat/cloud-contributor-continuation` provisioned Ubuntu successfully, then reproduced a QEMU-reported segmentation fault during pinned Nix installation in two fresh amd64 containers. Linux setup, repository verification, and hosted runs remain unproved; see the run evidence below.
- **Workaround:** Run the workflow on a prepared local Mac until a cloud environment is supported.
- **Proposed change:** After the standalone developer-shell branch lands, provide a portable cloud bootstrap or a declared cloud image with the pinned tools. Make `./agent` discover and use that environment without assuming zsh or a preexisting local Nix/devenv profile. Keep local and cloud tool versions aligned and report missing host-only capabilities explicitly. Cover every supported cloud harness, including the editor-based cloud workflow.
- **Dependencies:** The standalone developer-shell work has landed. Complete this task before closing the broader standalone development effort. The Linux Nix 2.35.2 bootstrap dependency is approved and its archive checksum is pinned from the official installer. Host access and the initial download policy now have successful evidence. Further acceptance needs an amd64 execution environment that can run the pinned Nix installer; no host configuration or dependency-version change is authorized by this finding.
- **Acceptance:** Reproduce contributor setup locally in an isolated Ubuntu environment, then prove the workflow in an actual fresh cloud session for each supported harness. Bootstrap a checkout without preinstalled zsh or a Nix/devenv profile; run `./agent help`, `./agent setup`, a focused test, and the portable check/test/verify lanes. Record per-harness evidence and explicitly identify unavailable macOS-only lanes. Local success alone does not close the task.
- **Source:** Developer request, 2026-09-25.

## Local reproduction and cloud proof

Current implementation separates the portable tools from Android/CocoaPods while sharing their
existing lockfile pins. `bootstrap-tao-dev-env` is the explicit noninteractive entry; it publishes
a profile and calls the existing `./agent setup`. Root launchers select the profile's zsh through
POSIX shell. The dedicated `./agent unsandboxed contributor-linux-test` command snapshots committed
source into cold and cached Ubuntu guests. Its focused tests do not constitute a Linux run.
An earlier task intermittently hit the wrapper's process-inspection guard. That message alone
does not establish why process inspection failed or whether a named permission was loaded.
The Developer's Terminal probe passed on 2026-09-26: Docker Desktop 4.88.1, Engine 29.7.2,
`linux/arm64`, using the containerd overlayfs snapshotter. The planned `linux/amd64` guest requires
emulation. This establishes host access, not a guest bootstrap or verification run.
The proposed 30 GiB disk allowance remains a measured budget, not an enforced container quota.
Provider setup instructions live in `.claude/cloud-setup.md`; actual hosted proof remains open.

### Network investigation, 2026-09-26

A fresh worktree at `15910aeb61c87d4376f8042bc911f345b2f0dc9c` passed standalone host
capabilities and the Docker probe. The full run `20260926T161634Z-57262` reached Ubuntu image
metadata fetching before the execution service rejected `auth.docker.io` as outside the active
network allowlist. No Linux bootstrap or repository test started. Its build log stopped at
`load metadata for docker.io/library/ubuntu:24.04`; no cleanup or final result was recorded.
This network failure is separate from the earlier process-inspection guard.

The follow-up branch `feat/cloud-contributor-network` adds exact token, registry, and documented
blob delivery hosts from [Docker's allowlist](https://docs.docker.com/desktop/setup/allow-list/),
`releases.nixos.org` used directly by the checksum-pinned installer, and the fixed amd64 base's
`archive.ubuntu.com` / `security.ubuntu.com` APT hosts documented in
[Ubuntu's package sources](https://ubuntu.com/server/docs/how-to/software/snapshot-service/).
GitHub, package registries, Nix binary cache, and Cachix already have rules. Only the token-host
denial was observed; subsequent downloads and redirects remain unproved. General Docker/CDN
wildcards and unrestricted networking are not needed for this evidence-backed starting set.

Direct Docker inspection from the managed shell was denied at its Unix socket. The runner now
has a read-only `--inspect-run YYYYMMDDTHHMMSSZ-PID` mode for exact run base-image and container
inventory through its existing named host operation. It never removes resources or prunes caches,
and a failed Docker request leaves inspection state unknown. This deliberately expands the
runner's accepted arguments without expanding the wrapper's host command list.

The initial regeneration could update the ordinary adapter but could not write protected
configuration. The repository's named configuration-repair operation regenerated those outputs.
The committed retry at `4239801005055a714e4c2ba56bd47799ee32fa9a`, run
`20260926T164953Z-90322`, still failed at `auth.docker.io` in the same execution session,
although the regenerated repository profile explicitly allows it. Host dispatch and the Docker
probe again succeeded; image provisioning, cold bootstrap, cached bootstrap, and Linux repository
verification remain unrun beyond image metadata fetching. No proxy or global configuration was
changed. Resume from a fresh session that loads this branch's regenerated policy; if it still
rejects the allowed hostname, resolve that effective managed policy before another Linux attempt.

Read-only host inspections `20260926T164951Z-90236` and `20260926T165003Z-90435` confirmed
that neither failed run retained its run-specific base image or any cold/tools/cached container.
No toolchain cache image was created; shared image and builder caches were untouched. All run and
inspection evidence is under `.artifacts/contributor-linux/` in the verification worktree.
Focused tests, including an intentional mutation of failure-state reporting, and the per-commit
macOS verification passed. Those checks establish runner behavior, not Linux portability or
hosted-cloud compatibility.

### Fresh-session Linux execution, 2026-09-26

The continuation used its own clean worktree, `d8fc/tao-lang-2`, on
`feat/cloud-contributor-continuation`, testing committed source
`0c9bbadb350914545f4cfe96c230958a974151fb`. The Developer assigned this task sole isolation-test
ownership across worktrees. A completed host process listing found no competing isolation runner;
no parallel Tart or Linux run was launched. The first capabilities invocation hit the earlier
process-inspection guard, but a separate retry passed. That does not establish the guard's cause.
The Docker probe `20260926T171352Z-4182` also passed.

Run `20260926T171433Z-8550` got beyond the prior authentication denial, downloaded Ubuntu and
APT prerequisites, and built its base in 50 seconds. Docker Desktop 4.88.1 / Engine 29.7.2 reported
`linux/arm64`; guests were `linux/amd64`, with four CPUs and 16 GiB RAM. The 30 GiB disk figure
remains a measured budget, not an enforced quota.

| Identity                               | Value                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------- |
| Ubuntu 24.04 source manifest           | `sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3` |
| Built run base                         | `sha256:1710d231f7f430cffa4589fc3a5ec055b40dafd3aff6f7b0da0cb3459d10e2d2` |
| Intended tool-cache tag, never created | `tao-contributor-linux-tools:7f2d8b9bf620e9722af5ee32c6775ca06cc0951d`    |

Both fresh containers downloaded the pinned Nix 2.35.2 archive, passed its checksum check, and
started single-user installation. Cold bootstrap failed after 12 seconds; tool-image bootstrap
failed after 9 seconds. Both reported:

```text
qemu: uncaught target signal 11 (Segmentation fault) - core dumped
Segmentation fault
```

The installer then reported `unable to register valid paths`. Both container inspections recorded
`OOMKilled: false`, exit 1, and an empty Docker state error. This demonstrates a failure executing
the pinned installer under this host's amd64 emulation, not a remaining download-policy denial.
It does not identify the precise QEMU or Nix defect, or prove that native amd64 succeeds.
The [version-pinned upstream installer](https://github.com/NixOS/nix/blob/2.35.2/scripts/install-nix-from-tarball.sh#L181-L184)
maps that error to `nix-store --load-db`, before profile installation. Its root-install warning
does not establish the cause of the crash. [Docker's known issues](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/known-issues/)
describe Intel containers on Apple Silicon as best effort, including QEMU crashes. The required
next intervention is a native x86_64 Linux execution host for the same committed-head test, or a
separately approved host-emulation repair. Do not change the pinned Nix version, guest architecture,
single-user/root-store policy, pending markers, or global Docker settings to bypass this result.
No repository dependency installation, focused test, check, test-all, or verify lane started.
Cached setup was unrun because tool-image provisioning failed. Overall wall time was 76 seconds;
the cold guest took 15 seconds including provisioning/collection, and the tools guest 10 seconds.

Evidence is retained in this worktree under `.artifacts/contributor-linux/20260926T171433Z-8550/`:
`source-commit.txt`, `base-build.log`, `base-image.json`, `resources.txt`, `result.txt`,
`cold/guest/bootstrap.log`, `tools/guest/bootstrap-tools.log`, both guest `steps.tsv` files,
both `container.json` files, and `cleanup.log`. The runner removed its two containers and base
image after collecting logs. Read-only inspection `20260926T171616Z-10124` independently confirmed
no run-specific image or container remained. No toolchain-cache image was committed; shared image
and builder caches were preserved. No external task directory was created.

Read-only Tart inspection found no local VMs in the default `/Users/ro/.tart` store; both older
`tao-acceptance-1790382642-43448` and `tao-acceptance-1790396293-31565` directories were absent.
The mounted-image inventory contained only simulator images, with no Tart disk. No clone deletion
or lease recovery was performed by this task. Keep the Linux evidence until the blocker is resolved.
Actual hosted smoke tests for all supported harnesses remain outstanding.

- [ ] Verify each supported cloud harness's current OS, architecture, setup hooks, caching, and
      network constraints before choosing the final image. Compare the published
      [reference container](https://github.com/openai/codex-universal) and
      [cloud environment documentation](https://code.claude.com/docs/en/cloud-environments);
      do not treat a reference image as the exact hosted environment.
- [ ] Start with the proposed Ubuntu 24.04 `linux/amd64` environment, approximately four CPUs,
      16 GiB RAM, and a 30 GiB disk budget. Choose a container inside a Linux VM on macOS or a
      dedicated VM according to the required isolation. Measure architecture-emulation cost on
      Apple Silicon separately from repository performance, and verify disk-limit enforcement.
- [ ] Cache pinned Linux tool installation in a reusable image layer, but create a fresh checkout
      and writable environment per run. Apply the selected local revision/patch explicitly;
      never borrow the host checkout's dependencies, generated files, or developer profile.
- [ ] Exercise both cold bootstrap and cached-image setup, including worktree/session initialization,
      dependency installation, and portable repository verification. Retain logs, tool versions,
      image identity, resource limits, and cleanup ownership for failures.
- [ ] Run actual cloud smoke tests for every supported harness to cover hosted proxy, permissions,
      credentials, and setup-hook differences that the local Ubuntu environment cannot prove.

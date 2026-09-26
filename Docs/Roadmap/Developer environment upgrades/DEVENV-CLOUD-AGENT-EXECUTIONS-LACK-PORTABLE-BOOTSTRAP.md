# DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP — Cloud agent executions lack a portable bootstrap

- **Status:** In progress
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
describe Intel containers on Apple Silicon as best effort, including QEMU crashes. The initial
handoff proposed native x86_64 execution or an approved host-emulation repair; subsequent research
identified the narrower process-local experiment below. The pinned Nix version, guest architecture,
single-user/root-store policy, pending markers, and global Docker settings remain unchanged.
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

### Scoped emulation and process portability follow-up

The Developer authorized a local experiment after [Nix issue 16184](https://github.com/NixOS/nix/issues/16184)
reported a matching startup fault in 2.35.1 under arm64 QEMU, with the unchanged binary starting
when `QEMU_GUEST_BASE=0x800000000000` is supplied. This is adjacent evidence, not proof for this
checkout's pinned 2.35.2. The runner's explicit `--qemu-guest-base` option requires an arm64
Docker daemon, carries the fixed setting through guest environment clearing, and separates its
tool-cache identity from the default acceptance run. It neither changes emulator registration nor
adds privileges. Rosetta and global Docker changes require a separate decision.

Source inspection also found portability gaps after installation: Git-hook entries assumed
`/bin/zsh`, process-group lookup was Darwin-only, and Linux process tracking depended on an
undeclared `ps` executable. The hook now uses POSIX `sh`. Process tracking keeps the existing
macOS libproc implementation and adds Linux procfs inspection behind the same API, including
kernel start identities, process groups, exit races, and explicit inspection failures. Linux
signalling uses the runtime API instead of assuming `/bin/kill`. No package/version change or
new dependency is needed; Windows support remains outside this slice. These changes still need
committed-head Linux acceptance before the bootstrap can be considered complete.

### Scoped guest-base result (2026-09-26)

Committed head `63cef60f7de68a6b7ecd622866554f36f012f93b` ran with the explicit guest-base
option in `20260926T174901Z-29680`. The same Ubuntu 24.04 manifest
`sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3`
provisioned in one second using existing builder layers; the run-specific base identity was
`sha256:2aed676c7a506e9b2fd7ec87f93781c7a4aa946303bc949fe0fa05d8847f3204`.
The setting passed the prior Nix registration crash and reached default-profile installation in
both fresh guests. Both then failed with `unable to load seccomp BPF program: Invalid argument`.
Cold bootstrap took nine seconds (guest eleven); tools bootstrap took fourteen seconds (guest
fourteen); total wall time was twenty-eight seconds. Setup, repository tests/check/verify, and
cached bootstrap remain unrun. The local macOS verification gate covers the portability code;
it does not substitute for Linux execution of that code.

[Nix issue 5258](https://github.com/NixOS/nix/issues/5258) reports the matching installation error
under user-mode QEMU, even with the build sandbox disabled. Nix's internal syscall filter is a
separate setting. Its [2.35.2 manual](https://nix.dev/manual/nix/2.35/command-ref/conf-file.html#conf-filter-syscalls)
documents `filter-syscalls` and cautions about disabling its protection against operations such
as setuid/setgid creation, ACLs, and extended attributes. A separate, explicit disposable-guest
experiment with process-local `NIX_CONFIG='filter-syscalls = false'` was subsequently approved
by the Developer and implemented as `--qemu-compat`, retaining the guest-base setting and a
separate tool-cache identity. Committed-head execution evidence follows when available. Do not
change the default bootstrap, Docker's outer isolation, host configuration, or network policy.
[Nix issue 15153](https://github.com/NixOS/nix/issues/15153) reports the same error class under
Rosetta with mismatched userland/kernel architectures; Rosetta is neither tried nor established
as the needed remedy. Native Linux execution remains a separate control; native arm64 changes
the acceptance architecture, while native amd64 preserves it.

The runner removed its cold/tools containers and run-specific base. Read-only inspection
`20260926T174959Z-31040` independently confirmed their absence. No toolchain cache image was
created (intended experiment tag `tao-contributor-linux-tools:26ae486aa51e0fcfcbf34c1d7a58f19d75d27e45`).
Shared image/builder caches were preserved. Evidence remains in
`.artifacts/contributor-linux/20260926T174901Z-29680/`, including guest logs, image/container
metadata, timings and cleanup. No global configuration, privilege, dependency/version or
network policy change was needed for this experiment. Actual hosted smoke tests remain outstanding.

A later macOS evidence-update gate reported an unhandled `ENOENT` while
`reclaimStaleMutex` scanned an already-removed `tao-gate-catalog-*/registry` scratch directory
(`2026-09-26T17-51-27-148Z-51857`). The focused gate-catalog rerun passed
(`2026-09-26T17-52-59-069Z-66921`). This is a separate observed fixture/lease-lifecycle race,
not a cause assigned to the Linux bootstrap or new procfs adapter. Preserve the failed gate log
for the verification owner's follow-up; no scheduler or lease behavior was changed here.
The next gate passed that suite but hit a separate account-server fixture readiness race:
`JSON Parse error: Unexpected EOF` at `account-server.test.ts:432`, after observing the ready
file before its direct JSON write finished (`2026-09-26T17-53-14-010Z-67962`). Its focused
rerun passed (`2026-09-26T17-54-54-210Z-86128`). Neither unrelated fixture was changed by this
bootstrap slice; both failed logs remain as follow-up evidence.

The approved `--qemu-compat` run at `1c7e62795db7babdb7540ab4a448cfe46011717e`
(`20260926T180520Z-58111`) passed Nix installation, toolchain provisioning, cold setup,
repeat setup, and the focused parser test. Cold bootstrap took 255 seconds; repository checks
were still running at this observation boundary. The long captured-output interval exposed a
diagnostic gap: guest lanes now request the existing verbose output, and read-only run inspection
can snapshot workflow logs and fixed process/resource observations from exact ownership-checked container IDs. It never executes inside,
stops, or removes the inspected guest. Final cold/cached results are still pending.

Cold checks subsequently passed in 677 seconds. Process snapshots during the quiet interval
showed active bridge typechecking, not an established hang. Docker reported an effective 7.746 GiB
memory ceiling despite the requested 16 GiB; no OOM was observed. The first full test run then
exposed a timeout exit-code difference (143 versus null) and two Tao app shards exceeding the
240-second no-output bound while QEMU workers had accumulated CPU time. These need separate
repository fixes or diagnostic evidence; cold/cached acceptance is not yet established.
The timeout fixture now explicitly replaces the shell with `sleep` when asserting direct signal
termination, and separately verifies a timed-out shell's numeric exit status is preserved.
The Tao verification child now explicitly selects line output: its previous noninteractive quiet
mode suppressed the very progress observed by the graph's silence bound. A real piped-child
regression failed before that fix and passed afterward. Neither fix raises a timeout or changes
process-result semantics; subsequent committed-head Linux execution remains required.

Repeated base builds also produced different image-list IDs with identical ordered rootfs
layers and complete runtime configuration. The tools cache now hashes that execution content
and validates linux/amd64, retaining the full image ID separately as evidence. This avoids
invalidating reusable tools solely because build attestations changed; changed layers, their
order, or runtime configuration still invalidate the cache. Docker documents attestations as
[image-index metadata](https://docs.docker.com/build/metadata/attestations/), and the
[OCI image configuration](https://github.com/opencontainers/image-spec/blob/main/config.md)
defines ordered filesystem DiffIDs and execution parameters. The focused fixture checks both
reuse and invalidation without creating isolation resources.

The same run reached runtime journeys but exceeded a 30-second Jest case bound and the
300-second runtime suite bound; Studio also exceeded its suite bound. A separate “Unfinished”
journey diagnostic was interleaved and does not identify the navigation test's stalled phase.
Other suites, including compiler (276 seconds), parser (171 seconds), and shared process tests
(33 seconds), completed. Concurrent host verification reached substantial machine contention,
so these timings do not isolate QEMU's contribution. No deadline was raised.

An explicit `--native-arm64` Ubuntu control is now available on an arm64 Docker daemon. It keeps
default amd64 acceptance separate, uses the same dependency pins, Nix 2.35.2's published ARM
checksum, and unchanged resource/test limits, with neither QEMU environment workaround. This
follows Docker's [native architecture guidance](https://docs.docker.com/build/building/multi-platform/)
to distinguish Linux behavior from translation cost. The
[published Nix installer](https://releases.nixos.org/nix/nix-2.35.2/install) owns both architecture
checksums. ARM success alone will not establish amd64 or hosted acceptance. Full workflow logs
are now collected before each ordinary guest is removed, preserving detail beyond bounded
console reports. This control has focused fixture coverage; execution remains pending until
the sole active isolation run ends.

Further cold-run failures exposed additional clean-machine assumptions. Remaining configured
hook shims required `/bin/zsh`; simple entries now use POSIX sh, while worktree fallback and
atomic delegation logging use Bash features supported by macOS's Bash 3.2 and Ubuntu. Existing
hook paths remain unchanged. A configuration test no longer assumes a clone lives under
`~/code/tao-lang-2`; it verifies the actual shared Git directory. Interactive shell fixtures resolve
the managed zsh executable, and merge fixtures configure their own identity and assert an actual
conflict before testing recovery. Studio process fixtures now use the portable process API for
liveness and signalling, including Linux zombie handling, and retain failed-spawn details.
Focused host tests cover these repairs; guest execution is still pending.

The task-inventory test also could not spawn `python3` (exit -2); neither the Ubuntu base nor
portable toolchain declared that existing runtime requirement. The Developer approved adding
Python from the existing locked nixpkgs on 2026-09-26. It is now declared in the shared toolchain:
the production worktree/task inventory uses its standard SQLite and JSON modules on both macOS
and Linux, so making it Linux-only would retain an undeclared macOS dependency. The current Mac
resolved `/opt/homebrew/bin/python3`, with no Python executable in its linked managed profile.
Ordinary setup completed without changing dependency pins or lockfiles; the next environment
build and Linux run must prove the managed Python executable. Guest version evidence now requires
that executable explicitly. Rewriting or skipping the inventory would affect reclaim safety
and is not a bootstrap workaround. Other observed
journey and suite timeouts remain unresolved; neither machine contention nor instruction
translation has yet been isolated as their cause.

The first cold test-all completed with failures after 2,526 seconds, including its existing
contention retries; verification then began in the same guest. This still tests `1c7e6279`,
before the repairs above. Its workflow snapshot is retained under
`.artifacts/contributor-linux/20260926T190651Z-86255/`. Additional fixture repairs replace
process-relative clock comparisons with explicit cross-process handshakes and arm short
descendant timeouts only after observing a live descendant. Directory-denial coverage now
injects a deterministic filesystem failure in an isolated child: root correctly ignores the
old `chmod 000` premise. Focused tests and deliberate regression mutations cover these
fixtures; updated committed-head guest verification remains outstanding.

The final test report also exposed standalone-installer fixtures inheriting the Linux host,
although the published release is intentionally macOS-only. Test-local platform, ownership,
and JSON-tool contracts now model that supported host and explicitly retain Linux rejection;
the production release contract is unchanged. Expo descendant checks now distinguish the
owned live process from a retained PID. Studio trust-store workers and the web-build fixture
retain subprocess failure details instead of reporting only a numeric mismatch. The original
guest's subsequent verification completed one Tao shard in 117 seconds; the other reached
52 passing journeys and one 30-second WordFlower journey timeout. This demonstrates further
progress with warmed state, without establishing the cause of the remaining timeouts.

Cold verification finished with failures after 3,439 seconds. The complete cold guest took
6,996 host seconds and exited 1; its collected `cold/guest/steps.tsv` records every phase.
The final retry exposed three more root-sensitive preview rollback fixtures and a simulator
archive test that assumes macOS `ditto`. The rollback fixtures now inject exact filesystem
failures in isolated children while exercising real generation and recovery; deliberate
rollback-order mutations fail their assertions. The simulator archive fixture now retains real
macOS `ditto` integration and uses a child-local Python standard-library ZIP command fixture on
Linux. Production extraction is unchanged. Tests validate real archive bytes, the extraction
invocation, installed content, manifest, archive removal, and rejection of the wrong bundle;
suppressed-extraction and bypassed-bundle-validation mutations fail. A host probe separately
exercises the portable ZIP fixture, including malformed archives and unsupported arguments.
This does not establish macOS symbolic-link/mode fidelity on Linux or enable Linux simulators.
These are repository portability failures, not evidence that another Ubuntu image is needed.

The same run then provisioned its reusable tools in 79 seconds (147 host seconds including
image capture), producing
`sha256:625bbfdcf61f769765b0eabf45d3207c46185a4c9cde61110bcacb1087560942`.
Its cached guest reused those tools, completed bootstrap/setup in 76 seconds, repeated setup
in 24 seconds, passed the parser test in 50 seconds, and completed checks in 856 seconds.
Cached test/verify are still running against the original `1c7e6279` source, not the subsequent
repairs. The runner removed
the completed cold and tools containers; it retains the active cached guest, base image, and
reusable tools image. Read-only inspection `20260926T200309Z-76264` independently confirmed
the cold container was absent before cached provisioning. Full cold verification evidence is
retained in snapshot `.artifacts/contributor-linux/20260926T195929Z-56423/`.

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

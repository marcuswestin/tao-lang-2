# DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP — Cloud agent executions lack a portable bootstrap

- **Status:** In progress
- **Section:** Deferred
- **Area:** Agent workflow; cloud development environment
- **Impact:** A cloud agent container without zsh or the pinned Nix/devenv profile cannot start the repository's `./agent` workflow, so it cannot set up, test, or verify a checkout.
- **Evidence:** On 2026-09-25, a cloud execution could not start without zsh or the pinned profile. On 2026-09-26, committed `d37963fc282d7a6d8a926a6822b23f3b7bfbfb7c` passed the complete cold and cached native ARM Ubuntu contributor workflow, including bootstrap, setup, parser tests, checks, all tests, and verification. Default amd64 emulation and actual hosted acceptance are distinct; see the evidence below.
- **Workaround:** On Apple Silicon, run `./agent unsandboxed contributor-linux-test --native-arm64` for local Linux contributor acceptance. It does not establish amd64 or actual hosted compatibility.
- **Proposed change:** Retain committed-source native Linux acceptance of the implemented portable bootstrap and shared pinned tools, resolve or qualify the default amd64 emulation boundary, then verify actual hosted setup and caching for every supported harness. Preserve noninteractive setup without preinstalled zsh, shared local/cloud versions, explicit host-only capability boundaries, and owned resource cleanup.
- **Dependencies:** The standalone developer-shell work has landed. Complete this task before closing the broader standalone development effort. Nix 2.35.2 remains checksum-pinned; the existing task inventory's Python runtime is approved from locked nixpkgs without a pin change. Host access, initial downloads, and process-local QEMU bootstrap compatibility have successful evidence. Native ARM acceptance proves local ARM Linux behavior, not amd64 acceptance. Rosetta, global configuration, and further dependency/version changes remain outside this authorization.
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

The dependency review also exposed a macOS-only default task-store lookup. On Linux it could
report an installed editor's task index as absent, allowing an otherwise idle worktree to appear
reclaimable. The lookup now uses each supported OS's default directory and honors Linux's
absolute configuration-directory override; malformed, inaccessible, or incomplete installed
state remains unavailable. A real SQLite fixture with an attached Linux task prevents both
reclaim classification and stale removal; deliberately restoring the wrong OS path fails that
safety assertion. This covers default profiles only, not arbitrary custom data directories.
The [editor's storage guidance](https://forum.cursor.com/t/agents-panel-right-sidebar-lost-session-list-no-way-to-restore/153481/4),
[Electron app-data contract](https://www.electronjs.org/docs/latest/api/app#appgetpathname), and
[XDG directory specification](https://specifications.freedesktop.org/basedir/latest/) document
the relevant defaults and override rules. Tests use owned fixture databases, never live indexes.

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
Cached tests failed after 2536 seconds, repeating portability failures and timeouts; verification
failed after 3397 seconds. Both used the original `1c7e6279` source, not the subsequent repairs.
The cached guest took 6952 host seconds; the complete cold/tools/cached run took 14098 seconds.
The runner removed all three containers and its base image, retaining the reusable tools image
and shared caches. Read-only inspection `20260926T220026Z-51081` independently confirmed no
run-specific container or base image remained. Full cold verification evidence is retained in
snapshot `.artifacts/contributor-linux/20260926T195929Z-56423/`; the last cached workflow snapshot
is `.artifacts/contributor-linux/20260926T215820Z-49468/`, with final guest reports under the
original run's `cached/guest/` directory.

Cached tests repeated the known quiet-output and suite timeouts. One additional 120-second
fixture timeout came from `just --dry-run verify-full`, not actual bootstrap or verification.
The same source passed that fixture three times in the cold guest in under one second; the
cached timeout has no established cause. Its helper now supervises the child with a 20-second
bound and retains the complete process result on failure, so the enclosing test timeout cannot
leave an unbounded child. This is diagnostic and lifecycle coverage, not a claimed repair of
the emulation failure. After that run finished and cleanup was confirmed, native ARM control
`20260926T220103Z-51682` started at repaired commit `0e747207`, following successful named host
capabilities and probe commands. The ARM Ubuntu layer and `ports.ubuntu.com` package indexes
downloaded without a new policy failure. Base provisioning took 25 seconds; cold bootstrap passed
in 127 seconds, with Python 3.13.12 confirmed in the managed profile. Repeat setup took 3 seconds,
parser tests 5 seconds, and checks 65 seconds. Test-all finished in 309 seconds with two fixture
failures. Cold verification finished in 571 seconds with only the inspector fixture failing;
the cold phase took 1098 host seconds including log collection. Tools bootstrap took 26 seconds
(104 host seconds including image capture). Cached bootstrap passed in 38 seconds with managed
Python, repeat setup in 4 seconds, parser in 6 seconds, and checks in 67 seconds. Cached tests took 308 seconds and verification 529 seconds; both failed only the
inspector fixture. The cached phase took 967 host seconds. Read-only inspection
`20260926T223819Z-33462` confirmed that no run-specific containers or base images remained;
reusable tools and shared caches were preserved.

The remaining inspector fixture intercepted the macOS helper even on Linux, where process
identities correctly come from `/proc`. It now exercises both real adapters in isolated module
graphs, injecting failed helper execution on macOS and `EACCES` at the requested Linux stat file.
Changing the latter to `ENOENT` makes its unavailable-inspector assertion fail, preserving the
difference between denied inspection and a vanished process. Actual worker teardown is unchanged.

The doctor fixture compared a shared checkout's artifacts while a Studio startup-failure fixture
created `.artifacts/user/dev-data` through its omitted `devDataRoot`. The Studio fixture now owns
that directory under its temporary root. Doctor mutation protection runs against an owned Git
checkout, including staged, unstaged, untracked, and ignored contents; the real-checkout dependency
and parser smoke checks remain separate. A scratch copy of the actual doctor that creates
`.artifacts/user` fails the new preservation assertion. These are test-isolation repairs; no
production doctor or process-inspection contract was weakened.

The host gate caught and corrected an invalid matcher access in the new inspector test. That
same run also observed empty stdout from a successful Git child in the configuration fixture,
under recorded five-lane contention. The focused configuration file passed immediately afterward;
no cause is established, and no production change or deadline increase was made for that event.
The next host gate observed the same empty-output symptom in the existing concurrent Git-child
fixture, plus a CPU-versus-wall plausibility assertion. Both focused files passed afterward,
including 680 Git children. The logs contain no actual permission denial. Completion-event and
stream-byte tracing would be needed to distinguish premature completion from upstream output
loss; the gate's sandbox classification alone does not establish either cause.

The cached browser-shortcut integration test also used Meta+K without declaring an Apple browser
platform. Production maps the primary modifier to Meta on Apple browsers and Control elsewhere;
the fixture therefore depended on the host. Explicit Mac and Linux platform/modifier cases now
exercise the same renderer and dispatch, including handled and unhandled browser defaults.
No production shortcut semantics changed.

- [ ] Verify each supported cloud harness's current OS, architecture, setup hooks, caching, and
      network constraints before choosing the final image. Compare the published
      [reference container](https://github.com/openai/codex-universal) and
      [cloud environment documentation](https://code.claude.com/docs/en/cloud-environments);
      do not treat a reference image as the exact hosted environment.
- [ ] Start with the proposed Ubuntu 24.04 `linux/amd64` environment, approximately four CPUs,
      16 GiB RAM, and a 30 GiB disk budget. Choose a container inside a Linux VM on macOS or a
      dedicated VM according to the required isolation. Measure architecture-emulation cost on
      Apple Silicon separately from repository performance, and verify disk-limit enforcement.
- [x] Cache pinned Linux tool installation in a reusable image layer, but create a fresh checkout
      and writable environment per run. Apply the selected local revision/patch explicitly;
      never borrow the host checkout's dependencies, generated files, or developer profile.
- [x] Exercise both cold bootstrap and cached-image setup on native ARM Linux, including worktree/session initialization,
      dependency installation, and portable repository verification. Retain logs, tool versions,
      image identity, resource limits, and cleanup ownership for failures.
- [ ] Run actual cloud smoke tests for every supported harness to cover hosted proxy, permissions,
      credentials, and setup-hook differences that the local Ubuntu environment cannot prove.

## Updated-source native follow-up

Native run `20260926T223924Z-40862` tests merge commit `03b54882`, including the inspector
and doctor repairs at `2411e883` and main `d5bdeaef`. macOS complete verification passed
in 241.8 seconds at `.artifacts/logs/verify/2026-09-26T22-40-09-499Z-38053-7bbf89e4/`.
Cold Linux bootstrap took 67 seconds, repeat setup 3 seconds, parser 6 seconds, and checks
65 seconds. Managed Python 3.13.12 is confirmed. Full Linux results remain pending.

The first cold test failure came from the incoming Watchman dispatch fixture's `/bin/zsh`
shebang. Linux provides zsh through the managed profile, not that macOS system path. The
fixture uses only POSIX syntax and now uses `/bin/sh`, matching neighboring dispatch fixtures.
No Watchman lifecycle or permission behavior changed. Failure evidence is retained under
`.artifacts/contributor-linux/20260926T224544Z-85379/` in the cold workflow log snapshot.

Incoming `./agent setup --environment` uses the full devenv environment and requires its
launcher prerequisites. Fresh Linux continues to enter through `bootstrap-tao-dev-env`;
that entry installs the pinned tools before invoking setup. The incoming full environment's
Hutch package is separate from the portable contributor profile.

## Native cold and cached acceptance completed

Run `20260926T230749Z-43918` passed at `7996e033657e3a7ddccd8a392f5a977057c17431`
using `./agent unsandboxed contributor-linux-test --native-arm64`. Host access and image
provisioning succeeded separately. The source was committed HEAD with no dirty edits.
The full run took 1350 seconds, including image provisioning and evidence collection.

| Phase                       | Cold | Cached |
| --------------------------- | ---- | ------ |
| Bootstrap                   | 238s | 25s    |
| Repeat setup                | 1s   | 2s     |
| Parser tests                | 3s   | 3s     |
| Source checks               | 30s  | 32s    |
| Complete tests              | 168s | 209s   |
| Verification                | 305s | 307s   |
| Guest phase with collection | 756s | 584s   |

Both guests confirmed Nix 2.35.2 and managed Python 3.13.12. The cold guest had a fresh
single-user store; the cached guest reused only the locked tools image, with fresh checkout
dependencies. Verification reused its own exact-tree source-check evidence for three nodes;
Studio smoke and native/UI host lanes were not exercised. Neither QEMU workaround nor Rosetta
was enabled. These runs prove local ARM Linux behavior, not amd64 or hosted acceptance.

- Ubuntu 24.04 manifest: `sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3`.
- Run base image: `sha256:8d6fa8b329ef1608b095cf46de1d16c7a8cea935c005a18d64e231ce945aaef2`.
- Reused tools image: `sha256:fe941be7d173ed62368420c1617b6e85c98a45e6797567a0eea5e90159bfab50`,
  tagged `tao-contributor-linux-tools:f1357ff472ba023ac11e47c71eb127d218595023`.
- Evidence: `.artifacts/contributor-linux/20260926T230749Z-43918/`, including per-phase
  `guest/steps.tsv`, tool versions, complete workflow logs, image metadata, and cleanup logs.
- Independent cleanup inspection: `20260926T233031Z-56492` confirmed no run-specific
  containers or base images remain. Reusable ARM and earlier amd64 tools images and shared
  builder caches were preserved. No older Tart clones were deleted.

The preceding native run at `03b54882` finished in 1679 seconds: cold 941 seconds, cached
729 seconds. Tests and verification failed only the incoming Watchman fixture. The one-line
POSIX shell repair at `7996e033` passed focused dispatch coverage and the per-commit gate.
The repaired inspector and isolated doctor assertions passed in both runs. The existing doctor
ledger now records that repair as incoming, pending landing and subsequent verification.

One host gate repeated the intermittent successful Git child with empty captured stdout.
Its focused test and complete gate retry passed; neither a runtime cause nor a sandbox denial
was established. Failure log: `.artifacts/logs/verify-changed/2026-09-26T22-47-11-550Z-92905-ad7adaf6/shared.log`;
successful retry: `.artifacts/logs/agent/verify-changed/2026-09-26T22-53-51-504Z-52371.log`.
This observation remains separate from successful native Linux acceptance.

## Default amd64 blocker reconfirmed on the repaired commit

After native cleanup, default run `20260926T233041Z-57627` tested the same `7996e033`
without compatibility overrides. Image provisioning passed in 2 seconds. Cold Nix installation
failed in 14 seconds, and tool-image Nix installation failed in 11 seconds; the entire run
took 30 seconds. Both failed during upstream store registration, before `./agent setup`:

```text
qemu: uncaught target signal 11 (Segmentation fault) - core dumped
Segmentation fault
unable to register valid paths
```

Cached amd64 setup and repository verification were unrun because no default tool image could
be provisioned. This reproduces the external QEMU/Nix boundary on the repaired source; it does
not identify the precise upstream defect. The base image was
`sha256:2f7d115281e90d6a9f88b0a3faa7bca02db0af2cb3fbca966d876c41b4c05cd7`.
Independent inspection `20260926T233200Z-76562` confirmed no run-specific containers or base
image remained. No new tools image was created; reusable caches were preserved.

The next amd64 proof should run the existing contributor workflow on a native amd64 Linux
host or hosted runner. Local ARM Linux acceptance is complete without Rosetta, global Docker
changes, or new privileges. A Rosetta experiment or dependency/version change remains a separate
approval decision. Actual hosted smoke tests remain outstanding for every supported harness.

## Finalization integration follow-up

Finalization integrated main through `f0d36ded` in `fa8365ac`. Incoming `59b4ea80` fixes
subprocess output retention before consumers attach; `86cccd63` lowers full verification
priority and removes the scheduler-dependent CPU-sample assertion. The only merge conflict
was the Platform import list; Linux process signalling and procfs identities were preserved.
Focused output, process lifetime, and cache lifecycle checks passed. These incoming process
changes require a fresh committed-source Linux run before claiming acceptance for the merged tree.

Review found that the incoming cache lifecycle fixture published readiness JSON non-atomically
and then treated file existence as complete publication. Its receipt now writes to an owned
temporary sibling and renames after completion. This changes only the test handshake; cache
retention and process cleanup behavior are unchanged.

## Integrated-source Linux acceptance

Run `20260926T234504Z-90279` passed both native ARM phases at `d37963fc282d7a6d8a926a6822b23f3b7bfbfb7c`,
including the incoming subprocess-output, verification-priority, and account-review changes.
Total wall time was 1132 seconds. All steps passed:

| Phase                          | Cold | Cached |
| ------------------------------ | ---- | ------ |
| Bootstrap                      | 63s  | 27s    |
| Repeat setup                   | 2s   | 2s     |
| Parser tests                   | 2s   | 2s     |
| Source checks                  | 28s  | 30s    |
| Complete tests                 | 187s | 167s   |
| Verification                   | 244s | 351s   |
| Phase with evidence collection | 536s | 595s   |

Both guests confirmed the managed Nix 2.35.2 and Python 3.13.12 toolchain. The run base was
`sha256:12f2f66ce9ce08bb6916d48e9d78f1335b4d7c8b7726ff9e8f2b951370d95ad3`; the cached phase reused
`sha256:fe941be7d173ed62368420c1617b6e85c98a45e6797567a0eea5e90159bfab50`.
Full evidence is in `.artifacts/contributor-linux/20260926T234504Z-90279/`. Independent inspection
`20260927T000405Z-35530` confirmed no run-specific containers or base images remain.
Reusable tools images and shared caches were preserved. No Tart cleanup was performed.

Complete macOS verification of this same commit passed in 94.2 seconds at
`.artifacts/logs/verify/2026-09-26T23-42-56-113Z-68683-87013f24/`; finalization passed before
this Linux rerun. Evidence commit `2a3733f0` only records the results. Finalization then integrated
the unrelated iPad/Catalyst changes from main `898f5f97` into `4c533b32`; complete macOS verification
of that merged tree passed in 182.4 seconds at
`.artifacts/logs/verify/2026-09-27T00-07-39-407Z-77016-b2e76ea2/`. Those incoming changes do not alter
bootstrap, process supervision, Nix, dependency pins, or network policy. Linux acceptance remains
explicitly tied to `d37963fc`; native UI/device acceptance is separate. The default amd64 QEMU/Nix
blocker was last reproduced at `7996e033`; the intervening integrations did not change the
Nix bootstrap, pinned version, image, or compatibility settings. Native amd64 and actual hosted
smoke tests remain outstanding. No landing, Rosetta experiment, or global configuration change
was performed.

## Landing continuation, 2026-09-27

The continuation at `06791ceb` restored the missing pinned Hutch launcher with
`./agent setup --environment`; the separate host capability report then found it available.
Setup reported a nonfatal timestamped GC-root symlink warning and retained the protected
generated adapter directory. No dependency version or lockfile change was needed.

Whole-diff review found the outer bootstrap rejected an active installer's pending marker
before entering the installer's lock. The `--install-nix` path now lets the installer wait
before judging that marker. The focused portable-bootstrap regression failed on the old
ordering, then passed with the repair. It exercises the real installer through a deterministic
lock-completion fixture, preserves rejection of interrupted installations, and checks profile
reuse. It does not claim a concurrent real Linux installation or refresh the native ARM
acceptance tied to `d37963fc` above. Native amd64 and actual hosted acceptance remain open.

Landing integrated optional shell activation and subsequent Studio Feed changes from main.
The native launcher smoke and canary completed, but full verification stopped in the existing
bootstrap-lock fixture: its fixed 0.2-second holder could exit before the contender ran,
producing exit 9. A deliberate 0.3-second contender delay reproduced that failure. The fixture
now retains the lock until an explicit release handshake, with bounded failure cleanup; the
contender timeout is unchanged. This repairs the test schedule rather than altering lock behavior.

## September 27 recurring-pass regression

The native ARM run `20260927T165256Z-51943` tested committed `206858d2a7a344473417840b0254f275f36ea492` and failed both cold and cached setup: `_shell-completion` still used `#!/bin/zsh`, bypassing the available managed Zsh. Cold bootstrap failed after 41 seconds; cached bootstrap failed after 18 seconds. Parser, checks, tests and verification did not start. The complete command took 137 seconds; tools-only profile provisioning succeeded independently in 24 seconds.

The recipe now uses `#!/usr/bin/env zsh`. A directly executed direnv fixture had the same system-path assumption and also hid the managed shell from child PATH; its launcher and isolated PATH are corrected. The hand-maintained worktree setup hook now uses POSIX shell and physical checkout resolution while retaining its existing `devenv` prerequisite and setup arguments; a direct invocation fixture checks paths containing spaces and apostrophes, environment, arguments and exit propagation. Existing explicitly Zsh-invoked helper scripts are unchanged. The correction is committed as `ee79a599` and fresh cold/cached acceptance is running against its immutable archive. Run-specific resources from the failed run were removed; the reusable tools image remains. Native amd64 and actual hosted setup remain separate unproved requirements, so this ledger item stays open.

The rerun passed cold bootstrap, setup, parser and checks, then exposed a real-direnv fixture that assumed the full environment's optional tool was installed. The portable package set deliberately omits direnv. Only the real integration case is now skipped when the current profile is the bootstrap's exact published portable-generation symlink and direnv is absent. A full profile missing direnv still fails; the six protocol tests remain, and a controlled profile-selection test covers both boundaries. Actual portable skip reporting awaits the next committed-source run.

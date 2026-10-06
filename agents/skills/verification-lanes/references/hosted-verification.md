# Hosted verification and contention

## The landing route

Once the Developer has authorized landing the slice and the merge message at
`.artifacts/merge/<branch>.msg` is reviewed, every `feat/<name>` branch lands the same way, with no
variations:

1. Run `./agent unsandboxed open-pr --auto-merge`. Always pass `--auto-merge`; there is no
   "open first, arm later" step. It pushes, opens or reuses the pull request, and starts hosted
   `Verify`, which runs every gate CI can run. GitHub squash-merges the pull request the moment
   `Verify` is green on that head; nothing reruns and nothing waits.
   Before the push, `open-pr` checks the `Verify` runs already in flight, because the runner pool
   holds two runs at once and no more. Expect one of three lines: `PASS` and an immediate push when
   no other run is in flight or the one other run changed none of this branch's files; `WAIT` when
   two runs are in flight, or when the one other run is a pull request that changed a file this
   branch also changes, since the two would merge untested against each other. A wait is normal
   and is not a failure: it polls every 30 s, prints again only when the blocking set changes or
   every five minutes, and gives up after 90 minutes without pushing. While waiting, do nothing to
   the other runs, tell the Developer on the first wait line, and expect your own run to take
   about 7.5 min at 11 partitions when it shares the pool rather than 6.5 min at 20 alone.
   `--jump-queue` pushes without the check; it is for the Developer, or for a coordinator the
   Developer has told to use it, never a way past a wait you find inconvenient.
2. The same command starts the local complement beside `Verify`: `verify-complement`, one locked
   lane of exactly the gates CI cannot run, derived from the catalog's `requiresUnsandboxed` and
   `requiresMacOS` gates minus whatever `CI_HOST_GATES` in `.github/workflows/verify.yml` admits
   (about five minutes today). It posts the `Verify (host)` status on the head, which
   `pr-checks` follows beside `Verify`, and leaves a receipt (`complement.json`) beside the lane's
   `summary.json`. Never run the sandbox-capable gates locally as merge evidence: hosted `Verify`
   owns them. `open-pr --auto-merge --no-complement` and a separate
   `./agent unsandboxed verify-complement` are the two-command shape for a machine that must run
   the lane at another time.
3. If the complement fails while `Verify` is still running, `open-pr` cancels the run and turns
   auto-merge off itself (`./agent unsandboxed cancel-verify` does the same for a failure found
   by hand). Fix the failure, commit, and run `open-pr --auto-merge` again; the push restarts
   `Verify` and the complement.
4. If `Verify` merged the pull request first and the complement then fails, fix it on the branch,
   commit, and run `./agent unsandboxed land-fix`: it fetches `origin/main`, merges the branch into
   it with a merge commit, pushes `main`, moves the archive, and writes a receipt under
   `.artifacts/logs/land-fix/`, without a full verification. Report the push to the Developer
   with the fix.
5. Follow `Verify` with `./agent pr-checks --wait`, diagnose failures from their annotations, fix,
   and push through `open-pr --auto-merge` again. `pr-checks` polls every 30 s while partitions
   queue, every 15 s while they run, and every 10 s once one finishes, with conditional requests;
   it never waits on the post-merge `Archive` check. GitHub merges about 45 s after `Verify`
   concludes, and `open-pr` returns once it has, printing `merged_at`, or after the complement,
   whichever is later; the archive workflow records `merged/<name>` about 10 s after the merge. Never `gh pr merge` by hand, and never run
   `./agent unsandboxed land` for a `feat/<name>` branch while GitHub is reachable.

Use local checks for focused iteration, diagnosis, and the host-only complement above. When CI is
unavailable, local `land` is the fallback; offline proof does not establish remote integration or
landing, and local `land` still requires a successful fetch and push. A broad local lane is a
diagnostic, never merge evidence; reassess machine contention before starting one.

## Compare current contention

- Read `./agent board` for running lanes, landing phase, leases, load, and CPU count. High
  contention means competing work is consuming the resources the intended lane needs: overlapping
  broad verification or builds, a busy landing lock, sustained load relative to CPU capacity, or
  active contention for a required host resource. A generic busy verdict, a quarantined or stale
  lease, or one load sample alone does not establish high contention. Use recent lane summaries
  and machine-wide history when available; `overlap` identifies other Tao lanes, while
  `contention.contended` can include the lane's own load. Recheck an ambiguous snapshot before
  starting another broad lane; never stop another task's work to clear capacity.
- Inspect recent GitHub Actions runs and jobs through available read-only GitHub tools or their
  check-detail links. Compare queued/waiting jobs and their age with jobs actually starting and
  finishing; workflow creation, job start times, and recent runs reveal scheduling delay. Little
  or no contention means jobs start promptly and there is no growing runner backlog. Count runner
  demand across relevant runs, including every partition of each verification run, rather than
  assuming one pull request consumes one runner: a `Verify` run takes 20 partitions when it starts
  alone and 11 when another `Verify` run is already in flight (its `Plan the partitions` summary
  names the count and the runs it saw), and `open-pr` waits before pushing when two runs are
  already in flight or when the one other lander changed the same files (`--jump-queue` skips the
  wait). Pending `Verify` alone can mean running tests; waiting for approval or a prerequisite is
  not runner contention.
- `./agent pr-checks --pr <number>` gives the current PR's check state, not the repository-wide
  runner queue. If queue observations are unavailable, report CI contention as unknown; do not
  infer free capacity from missing data or invent a repository command. State the local evidence,
  CI evidence, coverage, and chosen route briefly.

### What a partition spends before its first test

Every partition repeats a fixed cost: checkout and cache restores, the bootstrap, and the prepare
phase. Measured before this work, on a 10-partition run: about 24 s restoring `node_modules`,
about 36 s bootstrapping, and 35–51 s of prepare-phase critical path. The bootstrap runs
`--verify-setup`, which prepares only what gates read, and skips native bindings when their
freshness check proves them current. The `node_modules` cache leaves out Jazz's other-platform
binaries. The prepare phase stays in each partition: running it once in `plan` adds more serial
time than it saves, and each partition must still fail on unformatted or stale generated files. Its
longest node, the editor build, skips when its recorded inputs and outputs both match, and Verify
caches that build; a stale or foreign restore costs only a rebuild. Read a run's per-step times
before trusting these figures.

Hosted `Verify` is the final portable proof even when a local lane would finish sooner; contention
decides only when to run a diagnostic lane, never which machine proves the merge. A failed check
still needs diagnosis; switching machines is not permission to ignore a failure.

## Coverage and readiness

`.github/workflows/verify.yml` runs `verify-full-sandbox` across N Linux runners
(`--partition k/N`) on pull request pushes, pushes to `main`, and `workflow_dispatch`; `Verify` is
the aggregate verdict and the only required check on `main`. The `plan` job resolves N: 20
(`PARTITIONS`) when no other `Verify` run is in flight, 11 (`PARTITIONS_SHARED`) when one or more
are, with the sizing reasoning beside those defaults; the repository variables `VERIFY_PARTITIONS`
and `VERIFY_PARTITIONS_SHARED` override them, and a dispatch input overrides both for that one run.
Every partition and the aggregate read that resolved count. A cancelled or failed partition records no
green tree. It proves the portable gates only; the local complement in the route above proves the
rest. Read the current workflow and lane membership when deciding what
the complement is; a gate the workflow admits leaves the local list.

The same workflow's `CI macOS` job (`macos-26`, not required, not waited for by `Verify`) runs
`verify-full-ci`: the host gates `CI_HOST_GATES` admits plus the prepare nodes they read, every
other host gate reported as `Pending CI host admission`, no green record. A dispatched run's
`host_gates` input tries one admission for that run without editing the file, which is how a gate
is measured before it is admitted. Admitting a gate removes it from the local complement, and
`CI macOS` is not required, so admit one only once its hosted run is reliable and with the
`main` ruleset requiring `CI macOS` by name; until then the complement stays the proof.

For feature work, refresh affected documents, review and commit the exact task paths, and prepare
the reviewed message at `.artifacts/merge/<branch>.msg` without paying for local broad verification
first. Until `Verify` is green on the current head, describe the branch as awaiting CI, not
verified. Do not require local `finalize` as a prerequisite for the route.

Plain `./agent unsandboxed open-pr` without `--auto-merge` exists for one case only: pushing a
branch for CI feedback before landing is authorized. It refuses a PR whose auto-merge is already
enabled; do not change another task's setting to make it proceed. Test-only authorization does not
permit `--auto-merge`.

While `Verify` runs, start diagnosing and fixing failures as they appear; a run link is not
completion. Retain logs and a run/commit-scoped failure list, address every issue, and follow
replacement runs to a complete verdict or a concrete external blocker.

## After GitHub merged

`./agent unsandboxed merge-pr` on an already merged pull request confirms the merge and archives
`merged/<name>`; on a pull request whose `Verify` is already green and whose auto-merge is off, it
merges pinned to that head. Both `open-pr` modes use the reviewed message as the pull request's
title and description; to update the message, edit it and run `open-pr --auto-merge` again. GitHub
deletes the merged feature branch; the archive workflow also records `merged/<name>` for a PR
merged another way. The commands use REST where a cloud proxy refuses GraphQL.

Failed partitions upload `verify-partition-<k>` logs. If GitHub reports a conflict with `main`,
bring `main` in with `./agent merge-main`, review what arrived, and run `open-pr --auto-merge`
again; the changed head needs CI again.

Personal `dev/<name>` branches remain on the supported local `land` lifecycle; `open-pr` and
`merge-pr` do not support that branch shape. Use `./agent unsandboxed land` for that exception, or
when the hosted route is unavailable; it integrates and verifies under the machine-wide landing
lock and still requires a successful fetch and push. An already-green portable run does not claim
the host-only lanes passed. Both routes retain the reviewed squash message and branch archive, and
`git-workflow` owns the post-merge resource review.

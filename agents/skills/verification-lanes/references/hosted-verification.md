# Hosted verification: contention and coverage

`landing` owns the route that runs hosted `Verify` and the local complement together. This covers
how to judge contention on either machine and what hosted `Verify` proves.

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
  assuming one pull request consumes one runner; a run's `Plan the partitions` summary names its
  partition count and the runs it saw. Pending `Verify` alone can mean running tests; waiting for
  approval or a prerequisite is not runner contention.
- `./agent unsandboxed pr-checks --pr <number>` gives the current PR's check state, not the repository-wide
  runner queue. If queue observations are unavailable, report CI contention as unknown; do not
  infer free capacity from missing data or invent a repository command. State the local evidence,
  CI evidence, coverage, and chosen route briefly.

Contention decides only when to run a diagnostic lane, never which machine proves the merge. A
failed check still needs diagnosis; switching machines is not permission to ignore a failure.

### What a partition spends before its first test

Every partition repeats a fixed cost: checkout and cache restores, the bootstrap, and the prepare
phase. Measured on a 10-partition run before setup was trimmed: about 71 s before the prepare
phase, including about 36 s bootstrapping, and 35–51 s of prepare-phase critical path. The bootstrap runs
`--verify-setup`, which prepares only what gates read, and skips native bindings when their
freshness check proves them current. The `node_modules` cache leaves out Jazz's other-platform
binaries. The prepare phase stays in each partition: running it once in `plan` adds more serial
time than it saves, and each partition must still fail on unformatted or stale generated files. The
fixers do not run there: `--hosted-linux` skips every `canonicalises` node, because the workflow
fails a rewritten tree, and runs each one's `checkedBy` gate (`_dprint-check`, `_tao-check`,
`_repo-lint`) in its place, since `VERIFY_FULL_GATES` names only the fixers. The generated parser and the compiled WordFlower app are restored from the Actions
cache with their stamps, and each generator re-hashes its inputs and output before trusting a stamp.
The editor build is not cached: it has no stamp, and its ~29 s runs beside the compile. Measured
after, on an 11-partition run: about 46 s before the prepare phase. Read a run's per-step times
before trusting these figures.

## Coverage

`.github/workflows/verify.yml` runs `verify-full-sandbox` across N Linux runners
(`--partition k/N`) on pull request pushes, pushes to `main`, and `workflow_dispatch`; `Verify` is
the aggregate verdict and the only required check on `main`. The `plan` job resolves N from
whether other `Verify` runs are in flight, with the sizing reasoning beside the workflow's defaults
and repository variables overriding them; read the workflow for the current numbers. Every
partition and the aggregate read that resolved count. A cancelled or failed partition records no
green tree. It proves the portable gates and, through `--hosted-linux`, the host gates the
catalog marks `runsOnHostedLinux`; the local complement proves the rest. Each hosted browser gate
reserves its whole runner (its catalog `cost` equals the runner's vCPUs): packed beside other nodes
they ran two to four times their solo time and flaked, and the idle slots cost about 40 s a gate. Read the
current workflow and lane membership when deciding what the complement is; a gate the workflow
admits leaves the local list.

The `CI macOS` workflow (`.github/workflows/ci-macos.yml`) is advisory and not required. It runs
`verify-full-ci`: the host gates `CI_HOST_GATES` admits plus the prepare nodes they read, every
other host gate reported as `Pending CI host admission`, no green record. It is a workflow of its
own so a `Verify` run ends with its Linux partitions. It runs on pushes to `main` and on dispatch;
a dispatched run's `host_gates` input tries one admission for that run without editing the file,
which is how a gate is measured before it is admitted. Admitting a gate removes it from the local
complement, and `CI macOS` is not required, so admit one only once its hosted run is reliable, in
the same change that adds the `pull_request` trigger, and with the `main` ruleset requiring
`CI macOS` by name; until then the complement stays the proof. `verify-complement` enforces the
trigger half: without a `pull_request` trigger in that workflow it ignores `CI_HOST_GATES` and
keeps every host gate.

Local checks are for focused iteration, diagnosis, and the host-only complement. When CI is
unavailable, local `land` is the fallback; offline proof does not establish remote integration or
landing. A broad local lane is a diagnostic, never merge evidence; reassess machine contention
before starting one.

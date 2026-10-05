# Hosted verification and contention

Choose where to verify before starting a costly local lane, and reassess before merging. Prefer
GitHub CI when this computer has high contention and CI has little or none, provided the hosted
gates prove the change. Keep focused local checks useful for iteration; do not run broad local
verification or `finalize` merely to duplicate sufficient CI proof.

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
  demand across relevant runs, including the twelve partitions per verification run, rather than
  assuming one pull request consumes one runner. Pending `Verify` alone can mean running tests;
  waiting for approval or a prerequisite is not runner contention.
- `./agent pr-checks --pr <number>` gives the current PR's check state, not the repository-wide
  runner queue. If queue observations are unavailable, report CI contention as unknown; do not
  infer free capacity from missing data or invent a repository command. State the local evidence,
  CI evidence, coverage, and chosen route briefly. Compare expected queue plus execution time,
  rather than preferring CI after any slow local check.

When local contention is high and CI contention is low, send the portable verification to CI
instead of queueing another full local run. If both are busy, wait or continue focused work and
reassess. If CI is unavailable, use the local route when capacity permits. A failed check still
needs diagnosis; switching machines is not permission to ignore a failure.

## Coverage and readiness

`.github/workflows/verify.yml` runs `verify-full-sandbox` across twelve Linux runners
(`--partition k/12`) on pull request pushes, merge-queue entries, and pushes to `main`; `Verify`
is the aggregate verdict. It proves the portable gates only. Read the current workflow and lane
membership when deciding whether they cover the slice; native, simulator, device, visible UI, and
other host-only acceptance remain separate. Contention does not waive them. Run needed host proof
when this machine has capacity, or report the slice as waiting for that proof.

For CI-covered feature work, refresh affected documents, review and commit the exact task paths,
and prepare the reviewed message at `.artifacts/merge/<branch>.msg` without paying for local broad
verification first. A fully successful CI run covering the current PR head replaces the covered
local per-commit and readiness gates. Until that result exists, describe the branch as awaiting
CI, not verified. Do not require local `finalize` as a prerequisite for the hosted route.

Authorization to publish or merge remains separate from route selection. `open-pr` pushes and
enables auto-merge before checks finish, so use it only after the Developer authorizes landing the
slice and every required host acceptance check has passed. If host proof is still pending, defer
`open-pr`; GitHub can merge independently of a later `merge-pr` call. Without landing authorization,
inspect an existing PR read-only or finish local preparation
and report that starting hosted verification through `open-pr` awaits authorization. A green
existing PR may be proposed as ready without rerunning local verification; authorization to merge
is still required.

## Merge the already verified pull request

At merge time, reuse a fully successful CI result when it covers the change and the PR's current
head matches the reviewed local commit. Confirm every required check, including `Verify`, has
successfully completed for that head, and required host acceptance is complete. An old green run,
superseded run, skipped or cancelled required check, pending check, or failed check is insufficient.
Commits added since the green run require new CI proof.

After landing is authorized, run `./agent unsandboxed merge-pr` directly for an existing fully
verified PR. Do not reopen it or run local `land`, `verify`, `verify-full`, or `finalize` merely
because it is time to merge. `merge-pr` confirms the clean branch and reviewed message, matches
the local commit to the pushed head, checks the latest verdict, and pins the squash merge to that
head. It archives `merged/<name>` and reports the merge, including when auto-merge already did it.
Do not change the head simply to obtain a local readiness record.

For a new authorized hosted landing, `./agent unsandboxed open-pr` pushes, opens or reuses the PR,
uses the reviewed message as its title and description and squash message, enables auto-merge,
and follows checks. When they pass, use `merge-pr`. To update the message, edit it and run `open-pr`
again. GitHub deletes the merged feature branch; the archive workflow also records `merged/<name>`
for a PR merged another way. The commands use REST where a cloud proxy refuses GraphQL; when
auto-merge cannot be enabled, `merge-pr` performs the verified merge.

Use `./agent pr-checks --wait` to follow checks and read failures from their annotations; failed
partitions upload `verify-partition-<k>` logs. Diagnose with focused local checks when practical,
commit the fix, push through `open-pr`, and wait for fresh proof. If GitHub reports a conflict with
`main`, integrate it using the repository merge workflow, review what arrived, and push again;
the changed head needs CI again. Never bypass checks with `gh pr merge` or switch to local landing
just to evade a CI or queued-merge failure.

Use `./agent unsandboxed land` for the local route when needed proof is unavailable through CI;
it integrates and verifies under the machine-wide landing lock. An already-green portable run
does not claim the host-only lanes passed. Both routes retain the reviewed squash message and
branch archive, and `git-workflow` owns the post-merge resource review.

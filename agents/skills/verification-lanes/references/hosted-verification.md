# Hosted verification and contention

Use GitHub CI by default for final portable verification and hosted landing when its gates cover the
change. Use local checks for focused iteration, diagnosis, a clearly faster appropriate proof, and
host-only acceptance. When CI is unavailable, local verification is a fallback; offline proof does
not establish remote integration or landing, and local `land` still requires a successful fetch and
push. Reassess machine and CI contention before choosing an optional broad local lane.

## Default landing route: the merge queue

`main`'s ruleset requires a pull request, the `Verify` check, and its merge queue, so an authorized
slice lands in three steps:

1. Once `verify-changed` is green, open the pull request with plain `./agent unsandboxed open-pr`,
   so hosted `Verify` starts at once.
2. While it runs, run only the host-only gates `verify-full-sandbox` skips, each by its own recipe
   unsandboxed: `./agent unsandboxed studio-smoke <file>` for the seven browser smokes `GateCatalog`
   names (`studio-smoke`, `studio-proof-real-app`, `studio-smoke-simulated-user`,
   `keyboard-navigation-smoke`, `studio-dialog-browser`, `studio-agent-browser`,
   `studio-network-simulation`), `studio-smoke --native` for `studio-smoke-native`, and
   `./agent unsandboxed studio-canary`. Do not rerun the sandbox-capable gates hosted `Verify` covers.
3. When they pass: if `Verify` already passed on the head, run `./agent unsandboxed merge-pr`, which
   enqueues the pull request pinned to that head, waits for the merge group's own `Verify` run, and
   archives the branch; if `Verify` is still running, run `./agent unsandboxed open-pr --auto-merge`
   so the queue takes it on green, then `merge-pr` to confirm and archive.

`./agent unsandboxed land` remains available only during the transition: its push to `main` passes
the ruleset through the repository admin bypass, not through the queue.

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

For final portable proof, use CI unless a local lane is clearly faster and appropriate or CI is
unavailable. If both local and CI capacity are constrained, wait or continue focused work and
reassess. A failed check still needs diagnosis; switching machines is not permission to ignore a
failure.

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

Authorization to push and authorization to land remain separate. When pushing for CI is authorized,
use plain `./agent unsandboxed open-pr` for push-only work, while required host acceptance is
pending, or while the slice is otherwise not ready to land. It pushes, opens or reuses the PR,
follows CI, and leaves auto-merge off. It refuses a PR whose auto-merge is already enabled; do not
change another task's setting to make it proceed. Without push authorization, inspect an existing
PR read-only or finish local preparation and report that starting hosted CI awaits it.

When the slice is ready to land, meaning the Developer explicitly authorized landing and every
required host acceptance check has passed, follow the merge-queue route above. With auto-merge on,
GitHub enqueues the pull request once `Verify` passes and may merge independently of a later
`merge-pr` call; continue following CI to completion, diagnose every failure, and use `merge-pr`
to wait for the queue and archive it. Do not enable or rearm auto-merge before that
ready-to-land point. A green existing PR may be proposed as ready without rerunning local
verification; merge authorization is still required.

Always poll ongoing CI through completion. Start diagnosing and fixing failures as they appear
while polling the remaining jobs; a run link is not completion. Retain logs and a run/commit-scoped
failure list, then address every issue after all jobs finish, including failures from superseded
runs. Follow replacement runs to a complete verdict or a concrete external blocker. Test-only
authorization does not permit auto-merge or landing.

## Merge the already verified pull request

At merge time, reuse a fully successful CI result when it covers the change and the PR's current
head matches the reviewed local commit. Confirm every required check, including `Verify`, has
successfully completed for that head, and required host acceptance is complete. An old green run,
superseded run, skipped or cancelled required check, pending check, or failed check is insufficient.
Commits added since the green run require new CI proof.

After landing is authorized, run `./agent unsandboxed merge-pr` directly for an existing fully
verified PR. Do not reopen it, rearm auto-merge, or run local `land`, `verify`, `verify-full`, or
`finalize` merely because it is time to merge. `merge-pr` confirms the clean branch and reviewed message, matches
the local commit to the pushed head, checks the latest verdict, and enqueues the pull request in
`main`'s merge queue pinned to that head (a squash merge pinned to it where no queue is required),
then waits for the queue to merge it and fails if the queue drops it. It archives `merged/<name>` and reports the merge, including when auto-merge already did it.
Do not change the head simply to obtain a local readiness record.

Both `open-pr` modes push, open or reuse the PR, use the reviewed message as its title and
description, and follow checks. Choose `--auto-merge` at readiness as described above. To update
the message, edit it and run `open-pr` again; updating an
intentionally armed PR requires the explicit `--auto-merge` option. GitHub deletes the merged
feature branch; the archive workflow also records `merged/<name>` for a PR merged another way.
The commands use REST where a cloud proxy refuses GraphQL.

Use `./agent pr-checks --wait` to follow checks and read failures from their annotations; failed
partitions upload `verify-partition-<k>` logs. Diagnose with focused local checks when practical,
commit the fix, push through `open-pr`, and wait for fresh proof. If GitHub reports a conflict with
`main`, integrate it using the repository merge workflow, review what arrived, and push again;
the changed head needs CI again. Never bypass checks with `gh pr merge` or switch to local landing
just to evade a CI or queued-merge failure.

Personal `dev/<name>` branches remain on the supported local `land` lifecycle; `open-pr` and
`merge-pr` do not support that branch shape. Use `./agent unsandboxed land` for that exception, or
when the hosted route is unavailable, during the transition only; it integrates and verifies under the machine-wide landing
lock and still requires a successful fetch and push. An already-green portable run does not claim
the host-only lanes passed. Both routes retain the reviewed squash message and branch archive, and
`git-workflow` owns the post-merge resource review.

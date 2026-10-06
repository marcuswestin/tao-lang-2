# Organization migration follow-up and merge queue rollout

Status: the repository remote is now `https://github.com/tao-dev-org/tao-lang.git`, and
`Justfile`'s `github-setup` recipe uses that identity. `.gitmodules` now points storage at
`https://github.com/tao-dev-org/tao-lang-storage.git`. The transfer preparation below is retained
as a follow-up audit. This document does not establish that organization settings or native merge
queue have been enabled or tested.

The current feature-branch landing route is hosted `Verify` plus the local host-only complement,
started with `./dev open-pr --auto-merge`. The checked-in workflow runs 20 partitions when no
other `Verify` run is in flight and 11 when one is; the `VERIFY_PARTITIONS` and
`VERIFY_PARTITIONS_SHARED` repository variables override those two defaults and a dispatch input
overrides both for one run, and `open-pr` waits before pushing while two runs are already in flight.
It currently has PR, main-push and dispatch triggers, but no `merge_group` trigger. Complete
the queue prerequisites before requiring native merge queue. The live landing contract is in
[`landing/SKILL.md`](../../agents/skills/landing/SKILL.md).

## Decide and prepare

- [x] Move the repository identity to `tao-dev-org/tao-lang` and update the setup recipe.
- [ ] Confirm current visibility, organization plan, queue availability and administrator access.
      Review the organization's default member access and effective repository policies.
- [x] Update the storage submodule URL to `tao-dev-org/tao-lang-storage`.
- [ ] Audit storage repository access separately; parent repository access does not prove it.
- [ ] Record current required checks, rulesets, branch protection, allowed merge methods,
      auto-merge, Apps, Actions permissions, runners, environments and package publishing.
      An earlier audit of the personal repository required `Verify`, allowed squash, and had
      strict up-to-date checking off. Re-read the transferred repository's live settings; that
      earlier audit is not evidence of the current effective policy.
- [ ] Land queue-aware repository tooling before requiring the queue. Today's `merge-pr`
      follows PR-head checks; it must enqueue, follow queue-group checks,
      report removal/failure, and archive only after the actual merge. Preserve expected-head
      matching, the reviewed message, and the branch archive. Adapt `open-pr`'s auto-merge request,
      fallback and check follower too; distinguish queue admission from completed landing and
      support the queue-disabled state during rollout.
- [ ] Keep every required workflow reporting its exact check name on `merge_group`.
      Add the missing `Verify` trigger for `checks_requested` and verify the group SHA.
      Contributor agreement is now a job inside `Verify`; adapt its PR-specific assumptions
      before making the workflow queue-required. Audit any other required checks separately.
- [ ] Audit issue/discussion links, feedback links, badges, package metadata and separate clones
      for stale repository identities. The setup recipe already points to the organization.

## Transfer audit

1. Let active verification and landing finish and inform working agents of the migration window.
   Save each task's branch, PR, and expected head; avoid changing repository identity during a push.
2. Confirm the transfer preserved the existing repository rather than replacing its history.
3. Confirm the new URL and retained PRs/issues/history. GitHub redirects the old repository URLs,
   but do not recreate a repository at the old address, because that breaks the redirects.
4. Recheck Apps and external integrations for access to the transferred repository, organization
   policies and SSO, Actions allowlists/token permissions, runners, environments, secrets/variables,
   deploy keys, webhooks and package access. GitHub retains many repository settings and credentials,
   but the destination organization's policies can change their effective access.
5. Audit Pages URLs and package publishing separately. Sync the updated storage URL in each
   affected checkout and verify its access separately.

## Update existing checkouts

Run these from an existing checkout root:

```sh
git remote -v
git config --show-origin --get-regexp '^remote\.origin\.(url|pushurl)$'
git remote set-url origin https://github.com/tao-dev-org/tao-lang.git
git remote -v
git ls-remote --exit-code origin refs/heads/main
```

Linked worktrees normally share the common Git configuration, so one origin change covers them.
Inspect worktree-specific overrides and separate clones; update those independently and check
explicit push URLs. Agents should refresh cached repository identity and PR links before their next
remote operation. New checkouts usually are unnecessary.

After integrating the reviewed `.gitmodules` change in each checkout:

```sh
git submodule sync --recursive
```

This updates submodule URL configuration; it is not a request to replace dirty submodule contents.

## Enable and prove the queue

- [ ] Re-audit the transferred repository's rulesets and branch protection; do not assume the old
      ruleset ID or effective policy remained identical.
- [ ] Enable `Require merge queue` for literal `main`, retaining required `Verify`.
- [ ] Start conservatively: squash merge, build concurrency 1, only merge non-failing PRs,
      minimum and maximum merge limits 1, and a check timeout comfortably above the observed CI tail.
      These are proposed initial settings, not GitHub defaults.
- [ ] Keep strict up-to-date checking off: queue verification checks current main plus preceding
      queued changes. Confirm no bypass role is accidentally used by the landing command.
- [ ] Land one small authorized PR through the queue. Confirm the group SHA receives successful
      `Verify`, the PR merges only afterward, and the verified branch is archived.
- [ ] Test another queued PR behind it and a controlled failed group. Confirm waiting, failure,
      removal, and archive behavior before directing all agents to the queue.
- [ ] Retire competing direct landing paths once queue behavior is proved. Native auto-merge
      may remain the way a PR enters the queue after its admission checks pass.
- [ ] Keep PR supersession cancellation separate from queue runs; never cancel queue or main
      verification merely because another group/push arrived. Native queue build concurrency limits
      queue builds, not every PR verification workflow.
- [ ] Enable or review available security features and organization defaults: dependency updates,
      secret scanning/push protection, code scanning, workflow token permissions, member permissions
      and authentication requirements.

Merge limits batch completed merges; they do not combine independent CI builds into one run.
A queue group's verification includes current main and preceding queued changes, which prevents
independently green PRs from landing an unverified combined tree. Tune concurrency and merging
limits only after observing actual queue throughput.

## Official references

- [Transfer permissions, retained data and redirects](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
- [Merge queue availability and settings](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Actions settings and organization constraints](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- [The merge_group event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group)
- [GitHub CLI queue behavior and head matching](https://cli.github.com/manual/gh_pr_merge)

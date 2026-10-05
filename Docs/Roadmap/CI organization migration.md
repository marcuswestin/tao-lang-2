# Move Tao to an organization and enable merge queue

Status: preparation only. The repository is currently public and owned by `marcuswestin`.
Choose the destination organization before carrying out this checklist. No transfer or settings
change is part of preparing this document.

## Decide and prepare

- [ ] Choose `ORG`, keep the repository name `tao-lang-2`, and confirm the desired visibility.
      Public organization repositories can use native merge queue without Enterprise. Private
      organization repositories require Enterprise Cloud for merge queue; check the plan before
      changing visibility.
- [ ] Confirm repository administrator access and permission to create repositories in `ORG`.
      The destination must not already contain a repository with this name or a fork in its network.
      Review the organization's default member access before transfer.
- [ ] Decide separately whether `tao-lang-2-storage` stays under the personal account or moves.
      Transferring the parent does not transfer the storage repository.
- [ ] Record current required checks, rulesets, branch protection, allowed merge methods,
      auto-merge, Apps, Actions permissions, runners, environments and package publishing.
      The audited main ruleset requires `Verify`, allows squash, and has strict up-to-date checking
      off. Re-read these live at migration time; the legacy protection API was unavailable to the
      installed integration during the audit.
- [ ] Land queue-aware repository tooling before requiring the queue. Today's `merge-pr`
      directly squash-merges after PR-head checks; it must enqueue, follow queue-group checks,
      report removal/failure, and archive only after the actual merge. Preserve expected-head
      matching, the reviewed message, and the branch archive. Adapt `open-pr`'s auto-merge request,
      fallback and check follower too; distinguish queue admission from completed landing and
      support the queue-disabled state during rollout.
- [ ] Keep every required workflow reporting its exact check name on `merge_group`.
      `Verify` already has that trigger; confirm it runs on `checks_requested` and verifies the
      group SHA. Contributor agreement currently is not required; if it becomes required, adapt
      its event and PR-specific assumptions first.
- [ ] Fix `Justfile`'s `github-setup` recipe and its tests: it currently resets origin to the
      personal repository. Update issue/discussion links, feedback links, badges, package metadata
      and other hardcoded repository identities. Do not run the old recipe after updating the remote.

## Transfer between verification runs

1. Let active verification and landing finish and inform working agents of the migration window.
   Save each task's branch, PR, and expected head; avoid changing repository identity during a push.
2. On GitHub, open the repository's Settings → General → Danger Zone → Transfer.
   Transfer the existing repository to `ORG`; do not create a replacement and copy history.
3. Confirm the new URL and retained PRs/issues/history. GitHub redirects the old repository URLs,
   but do not recreate a repository at the old address, because that breaks the redirects.
4. Recheck Apps and external integrations for access to the transferred repository, organization
   policies and SSO, Actions allowlists/token permissions, runners, environments, secrets/variables,
   deploy keys, webhooks and package access. GitHub retains many repository settings and credentials,
   but the destination organization's policies can change their effective access.
5. Audit Pages URLs and package publishing separately. If storage moves too, update `.gitmodules`
   and sync its URL in each affected checkout.

## Update existing checkouts

Run these from an existing checkout root, replacing `ORG` with the chosen organization:

```sh
git remote -v
git config --show-origin --get-regexp '^remote\.origin\.(url|pushurl)$'
git remote set-url origin https://github.com/ORG/tao-lang-2.git
git remote -v
git ls-remote --exit-code origin refs/heads/main
```

Linked worktrees normally share the common Git configuration, so one origin change covers them.
Inspect worktree-specific overrides and separate clones; update those independently and check
explicit push URLs. Agents should refresh cached repository identity and PR links before their next
remote operation. New checkouts usually are unnecessary.

If the storage repository also moves, after the reviewed `.gitmodules` change lands:

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

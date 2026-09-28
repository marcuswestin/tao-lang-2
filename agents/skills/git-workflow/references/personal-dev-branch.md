# Personal dev branches

Each person has one `dev/<name>`. That is where their commits go between landings. Two people each
keep their own branch; they do not share one. A `feat/<name>` branch lands once. A personal branch
lands, disappears, and comes back under the same name pointing at the new `main`.

## Land, then create the same name from `main`

`./agent unsandboxed land` squashes `dev/<name>` onto `main`, deletes the local and remote branch,
and leaves this worktree detached at the pre-squash tip. The archive of that tip is
`merged/<name>/<utc>`. `verification-lanes` owns the ref spelling and the landing gates.

The branch is gone, so create it again from `main` in this worktree:

```
./dev my-branch
```

`./dev my-branch` creates `dev/<name>` from `main` when the branch does not exist. Pass the name
when this checkout has no `tao.devBranch` and no `TAO_DEV_BRANCH`. The new branch is `main`. Do not
push it unless the Developer asks.

- Create it from `main`, which is what `./dev my-branch` does. The detached HEAD after land is the
  pre-squash tip, and a branch created there diverges from the squash.
- Do not cherry-pick the landed commits. They are already the squash on `main`. Cherry-pick only a
  commit that is not contained in `main`.
- Leave every dated archive in place. The next land writes a new timestamp, so the name does not
  have to be free. An undated `merged/<name>` ref blocks those children; move it to
  `merged/<name>/<utc>` before landing again, and keep the same commit.
- Do not recreate a `feat/<name>` branch for further commits. Its archive is the single ref
  `merged/<name>`.

## Commits belong on the personal branch

Do not commit on `main`. If this worktree is on `main` with the person's uncommitted work, and
`dev/<name>` is missing or already contained in `main`, move that work onto `dev/<name>` at current
`main` before committing. `./dev my-branch` does this when the branch is missing. When the branch
exists and is behind `main`, `git switch -C dev/<name>` resets it onto current `main` and keeps the
uncommitted work; use it only when the old tip is an ancestor of `main`.

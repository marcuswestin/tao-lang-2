---
name: project-7-merge-feature-branch
description: >-
  Merges a completed Tao feature branch into main with validation, a squash commit, remote branch archival, and local branch/worktree cleanup.
---

# Merge Feature Branch

Land a completed feature branch into `main`.

## Rules

- Run `./agent merge-feature-preflight` before mutating merge state and resolve or report any blockers it finds.
- Do not merge from `main`, `merged/...`, a detached HEAD, or a dirty worktree.
- If the feature branch has uncommitted work, stop and use `commit-all-chunks` first.
- If a merge step reports conflicts, resolve the parts that are clear from repo truth, feature scope, and existing instructions. Ask Ro only for conflict parts that require language-design, roadmap-priority, product-behavior, or destructive-operation input.
- Do not rename, remove, or clean up the feature branch until the squash commit is pushed to `main`.
- Preserve Git's generated squash appendix in the final commit message.
- Move completed roadmap task folders from `Roadmap/<Task>/` to `Roadmap/Archive/<Task>/` before the squash commit. Archive whole task folders, not individual plan files, and leave active or planned task folders in place.
- Finish with a clean local state: `main` checked out, no local feature or `merged/...` branch left behind, and any temporary feature worktree removed.

## Workflow

1. Capture the branch and state:

   ```sh
   ./agent merge-feature-preflight
   ./agent git status --short --branch
   ./agent git branch --show-current
   ./agent git worktree list --porcelain
   ```

   Stop if the branch is not a clean feature branch.

2. Validate and push the feature branch:

   ```sh
   ./agent just verify
   ./agent git push -u origin HEAD
   ```

3. Refresh `main`, merge it into the feature branch, then validate again:

   ```sh
   ./agent git checkout main
   ./agent git fetch origin main
   ./agent git merge --ff-only origin/main
   ./agent git checkout <feature-branch>
   ./agent git merge --no-edit main
   ./agent just verify
   ./agent git push -u origin HEAD
   ```

   If there are merge conflicts, resolve the clear hunks, stage the resolved files, complete the merge commit, then run `./agent just verify` and push the feature branch. Ask Ro only if a conflict cannot be resolved safely from repo truth and the feature scope.

4. Squash the feature branch into refreshed `main`:

   ```sh
   ./agent git checkout main
   ./agent git fetch origin main
   ./agent git merge --ff-only origin/main
   ./agent git merge --squash <feature-branch>
   ```

   If `main` advanced after step 3, return to step 3 before squashing. If squash conflicts occur, resolve the clear hunks and ask Ro only for conflict parts that cannot be resolved safely.

5. Archive completed roadmap task folders included in the landed feature:

   ```sh
   ./agent ls Roadmap
   ./agent git mv "Roadmap/<Completed Task>" "Roadmap/Archive/<Completed Task>"
   ```

   Archive only task folders whose project is complete after this merge. If no roadmap task folder applies, note that in the final output.

6. Build the squash commit message from `.git/SQUASH_MSG`:

   ```sh
   ./agent cat .git/SQUASH_MSG
   ```

   Use this shape:

   ```text
   <Summary line>

   - Main change one
   - Main change two

   Squashed commit of the following:

   <Git-generated commit details>
   ```

   The summary and bullets should describe the landed feature. Keep the generated squash details intact below them.
   Write the final content to a message file, for example `.artifacts/skills/project-7-merge-feature-branch/<feature-slug>-squash-message.txt`, and use that path as `<message-file>` below.

7. Validate, commit, validate again, and push `main`:

   ```sh
   ./agent just verify
   ./agent git commit -F <message-file>
   ./agent just verify
   ./agent git push origin main
   ```

   If validation changes files, review and stage only intentional changes, then rerun validation before committing.

8. Rename the feature branch to `merged/...`, sync the rename with origin, then clean up local branches and worktrees.

   If the feature branch is checked out in its own worktree, run this from that worktree:

   ```sh
   ./agent git branch -m merged/<feature-branch>
   ./agent git push -u origin HEAD
   ./agent git ls-remote --heads origin merged/<feature-branch>
   ./agent git push origin --delete <feature-branch>
   ```

   Then return to the main worktree and remove the feature worktree and local merged branch:

   ```sh
   ./agent git worktree remove <feature-worktree-path>
   ./agent git branch -D merged/<feature-branch>
   ./agent git worktree prune
   ```

   If the feature branch is not checked out anywhere, run this from `main`:

   ```sh
   ./agent git branch -m <feature-branch> merged/<feature-branch>
   ./agent git push -u origin merged/<feature-branch>
   ./agent git ls-remote --heads origin merged/<feature-branch>
   ./agent git push origin --delete <feature-branch>
   ./agent git branch -D merged/<feature-branch>
   ./agent git worktree prune
   ```

9. Verify local cleanup:

   ```sh
   ./agent git status --short --branch
   ./agent git branch --list "<feature-branch>" "merged/<feature-branch>"
   ./agent git worktree list --porcelain
   ```

   Stop and report any leftover dirty worktree, local feature branch, local `merged/...` branch, or unexpected extra worktree.

## Output

Report the landed feature branch, archived roadmap folders or why none applied, squash commit hash, validation results, `main` push status, `merged/...` remote branch name, remote sync status, local branch/worktree cleanup status, and any conflict work left unresolved.

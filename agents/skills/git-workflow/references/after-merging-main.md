# After merging `main` in

Every time `main` is merged into a feature branch, skim what arrived before carrying on. A clean
merge only proves the text did not collide; it says nothing about whether the work still makes sense.

1. List what came in: `git log --oneline ORIG_HEAD..HEAD --first-parent` for the subjects, and
   `git diff --stat ORIG_HEAD HEAD` for the paths.
2. Hold that against the task in hand and ask three questions.
   - Does anything touch the files, modules, or documents this task edits or is about to?
   - Does anything change a rule this task relies on: instructions, a plan or decision document, a
     lint, a command, a shared helper?
   - Does anything already do, undo, or contradict part of this task?
3. Three "no"s end it. This is a minute of reading subjects and paths, not a review of `main`.
4. On a "yes", read that commit's diff and adapt: rebase the plan on the new helper, drop work that
   landed elsewhere, move a fence, renumber a ledger entry, or put a changed decision to Ro.
5. Say what was found in one line of the next report to Ro, including "nothing relevant".

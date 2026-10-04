# DEVENV-A-HIDDEN-COMMAND-REAPPEARED-IN-ONE-BATCHED-WORDFLOWER-RUN — A hidden command reappeared in one batched WordFlower run

- **Status:** Incoming
- **Section:** External
- **Area:** Tao behavior tests
- **Impact:** A per-commit gate failed on a documentation-only change, because one WordFlower journey
  saw a command its view hides. The failure did not reproduce, so an author cannot tell a flake
  from a regression without re-running the lane.
- **Evidence:** On 2026-10-03 `./agent verify-changed` on `feat/staged-release-qa-2` failed
  `tao-apps` at `Apps/WordFlower/1 - Current/Workspaces.test.tao:138`:
  `expect verbs "Finish document", "Open document", "Delete document"` got
  `["Finish document","Open document","Delete document","Duplicate document"]`. The row view hides
  the inherited `Duplicate` command (`@data/Data.tao:95`). The tree differed from a green verify
  only by one new Markdown file. `./agent tao test "Apps/WordFlower/1 - Current"` then passed 38 of
  38, and the next `verify-changed` passed. The five-minute load average was about 70 during the
  failing run. Full log: `.artifacts/logs/verify-changed/2026-10-03T18-53-59-961Z-18900-c8769ac1/tao-apps.log`.
- **Workaround:** Re-run the lane once.
- **Proposed change:** Find what makes the hidden-command set order- or timing-dependent in a
  batched run, for example whether command visibility is read before the row view's promotion
  settles, and make `expect verbs` wait for or read the settled set.
- **Dependencies:** None known.
- **Acceptance:** The journey passes repeatedly in the batched `tao-apps` lane under load.
- **Source:** 2026-10-03 staged-release QA branch.

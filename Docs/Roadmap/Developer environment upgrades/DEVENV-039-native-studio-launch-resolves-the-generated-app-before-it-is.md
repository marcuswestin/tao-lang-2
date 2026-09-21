# DEVENV-039 — Native Studio launch resolves the generated app before it is written

- **Status:** Candidate
- **Section:** External
- **Area:** Studio launch
- **Impact:** The command a person runs most for device work opens with a red bundler error that is not
  one, which trains readers to ignore the place real bundler failures appear.
- **Evidence:** `just studio-native` logs `Unable to resolve "./_gen_tao-app/App"` once on startup and
  recovers on the next write; Metro reaches the entry before the first compile has written the generated
  tree.
- **Workaround:** None needed; the message is transient and the launch succeeds.
- **Proposed change:** Order the first compile ahead of the Metro start for the native launch path, or
  hold the entry until the generated tree exists.
- **Dependencies:** None.
- **Acceptance:** A clean `just studio-native` reaches a ready preview with no unresolved-module output.
- **Source:** 2026-09-04 companion Slice 2 work.

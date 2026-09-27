# DEVENV-COLD-SHELL-EVALUATION-REPEATS-PER-WORKTREE — Cold shell evaluation repeats per worktree

- **Status:** Candidate
- **Section:** External
- **Area:** Nix environment evaluation and automatic directory entry
- **Impact:** A checkout without its own devenv evaluation cache blocks its first shell activation,
  even when all tool packages are already installed in the shared Nix store.
- **Evidence:** On 2026-09-27, devenv 2.1.0 in a newly initialized linked checkout took 5.89 seconds
  for `devenv direnv-export`: 5.33 seconds evaluating/building the shell and 0.254 seconds running
  tasks. The repeat took 0.19 seconds. Three separate fresh configuration fixtures with the same
  six Nix input files and the real `.envrc` took 4.494, 4.362, and 4.546 seconds for actual
  `direnv export bash`; cached repeats took 0.386, 0.383, and 0.383 seconds. These are warm-store
  observations on a busy macOS host, not clean-machine download/build measurements or an idle-host
  speed guarantee. Current `.envrc`, `devenv.nix`, and the installed activation hook do not invoke
  dependency setup; isolated `compinit -D` took another 0.68 seconds when needed. Branch
  `feat/faster-worktree-direnv` prepares each opted-in checkout's own shell during setup, preserving
  normal devenv invalidation, trust and local state. Three preparation runs took 5.491, 4.669, and
  5.477 seconds; subsequent exports took 0.198, 0.197, and 0.199 seconds. Later, the first actual
  direnv entry into those prepared fixtures took 1.323, 1.544, and 1.612 seconds with cached Nix
  evaluation; this includes direnv importing the environment, and should not be described as the
  0.19-second export-only timing. Ordinary setup also exercised preparation successfully in the
  real linked checkout. Focused tests cover the
  opt-in boundary, checkout isolation, skipped active environments, failure/retry, and setup ordering;
  disabling ordinary preparation caused all three new behavioral regressions to fail. Preparation
  moves the cold work before interactive entry; it does not eliminate or share it. Raw measurements
  live in that task's `.artifacts/direnv-benchmark/`. The sandbox could not create timestamped global
  GC-root links, but evaluation and local roots succeeded; host GC-root creation was not measured.
- **Workaround:** Run ordinary `./agent setup` before entering an opted-in checkout. Setup now
  prepares its environment without authorizing `.envrc` or changing personal shell settings.
  A missing or inaccessible devenv remains an optional preparation failure; normal activation retries.
- **Proposed change:** Investigate whether a root-independent immutable tool payload can reduce total
  cold evaluation while proving parity for every exported tool and native environment variable.
  Keep branch-specific inputs, shell tasks, writable state, runtime paths, and garbage-collection
  roots correct. Do not share `.devenv` directories or relocate captured shell exports.
- **Dependencies:** A controlled repeated benchmark, including native environment equivalence and
  changed configuration/import invalidation, before adopting a different activation mechanism.
- **Acceptance:** Reduce total cold work across different worktrees without dropping tools or
  reusing stale branch inputs. Report provisioning time separately from interactive entry time.
- **Source:** Developer report that entering a new worktree for direnv setup takes a long time,
  investigated on 2026-09-27.

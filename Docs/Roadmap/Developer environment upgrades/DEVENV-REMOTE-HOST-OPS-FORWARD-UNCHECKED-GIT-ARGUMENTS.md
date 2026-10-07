# DEVENV-REMOTE-HOST-OPS-FORWARD-UNCHECKED-GIT-ARGUMENTS — `remote` host operations forward unchecked Git arguments

- **Status:** Candidate
- **Section:** External
- **Area:** `./agent unsandboxed remote fetch|refs|heads|exists`, `HostCommandTargets.ts`
- **Impact:** The four `remote` operations run Git on the host after a fixed prefix (`git fetch
  origin`, `git ls-remote origin`) and pass every further argument through, because they declare no
  `argsPolicy`. Git accepts options after the remote name, and `--upload-pack=<command>` runs that
  command, so an approved `remote fetch` can run an arbitrary host command outside the sandbox. The
  operations predate the unsandboxed-operation boundary, which otherwise names what each
  operation may receive.
- **Evidence:** 2026-10-07 repository pass: `HostCommandTargets.ts:109-112` declare the four targets
  with `command` and `fixedArgs` only, beside neighbours such as `reclaim --execute` (`:31`) that
  carry `argsPolicy: 'none'`. `rg -i upload-pack packages/cli packages/testing` finds no rejection.
  The forwarding was read from the source, not exercised.
- **Workaround:** None needed in practice; agents pass refs only.
- **Proposed change:** Give the four operations an `argsPolicy` that admits ref names and the few
  flags they are used with (`--prune`, `--heads`, `--tags`), rejecting any other argument that
  starts with `-`, with a test that `--upload-pack=` is refused.
- **Dependencies:** The Developer's approval, since it changes what an unsandboxed operation accepts.
- **Acceptance:** `./agent unsandboxed remote fetch --upload-pack=true` is refused before Git runs;
  `remote fetch main` and `remote heads` still work.
- **Source:** Unsandboxed-surface review in the October 7 repository pass.

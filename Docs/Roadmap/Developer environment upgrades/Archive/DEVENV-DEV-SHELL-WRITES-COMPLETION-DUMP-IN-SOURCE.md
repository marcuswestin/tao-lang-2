# DEVENV-DEV-SHELL-WRITES-COMPLETION-DUMP-IN-SOURCE — Dev shell writes completion dump in source

- **Status:** Resolved
- **Area:** Interactive development shell startup and completion cache ownership.
- **Impact:** Entering the development shell could create an untracked `.zcompdump` beside the tracked shell startup file.
- **Evidence:** The launcher set `ZDOTDIR` to `packages/cli/dev-cli/dev-cli-src/shell`. On the observed host, `/etc/zshrc:24` runs `compinit` before the repository `.zshrc` restores the user's startup directory. Real `compinit` regression coverage reproduces the default dump location; reverting the fixture to the old source-directory `ZDOTDIR` fails the cache assertions.
- **Workaround:** None needed after the fix.
- **Proposed change:** Implemented: start zsh with `ZDOTDIR` at `.artifacts/cache/dev-shell/zsh`, containing an atomically published link to the canonical `.zshrc`. Restore the user's original `ZDOTDIR` before loading their settings, including when no personal `.zshrc` exists. The existing artifact ignore and full-clean lifecycle own the cache; no source-directory ignore is added.
- **Dependencies:** None.
- **Acceptance:** Shell-entry tests exercise setup ordering, concurrent first launches, repeated startup, real early completion dumps, user startup and checkout completion. Dumps stay in the cache and the tracked source directory gains no files.
- **Source:** Developer report after entering the development shell; `feat/studio-space-drag-pan` shell follow-up on 2026-09-26.
- **Archived:** 2026-09-26.

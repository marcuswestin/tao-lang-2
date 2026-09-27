#!/bin/zsh
# Cursor runs this from .cursor/worktrees.json when it creates a worktree, before an agent works
# in it. It runs the repository's one setup entry, `./agent setup`: dependencies installed, the
# agent CLI built, the harness adapters generated. Worktrunk's pre-start hook (.config/wt.toml)
# and the Claude Code and Codex SessionStart hooks (.rulesync/hooks.jsonc) run the same entry;
# change what setup does in the Justfile `setup` recipe and keep those references in step.
# worktrees.json is plain JSON with no room for comments, which is why this script exists.
set -e
cd "${0:A:h}/.."
export TAO_DEV_SHELL_SETUP=0
exec devenv shell --no-tui ./agent setup

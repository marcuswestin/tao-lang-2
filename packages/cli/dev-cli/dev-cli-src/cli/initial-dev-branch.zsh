#!/bin/zsh

# Setup runs in every checkout and every session. Only a primary checkout still on main
# needs the person's branch; linked worktrees and existing work keep their chosen HEAD.
emulate zsh
set -e

git_dir="$(git rev-parse --absolute-git-dir)"
common_dir="$(git rev-parse --git-common-dir)"
[[ "${git_dir:A}" == "${common_dir:A}" ]] || exit 0
branch="$(git symbolic-ref --quiet --short HEAD)" || exit 0
[[ "$branch" == main ]] || exit 0

just my-branch

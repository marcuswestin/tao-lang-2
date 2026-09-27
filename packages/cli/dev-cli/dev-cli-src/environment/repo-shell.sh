# Sourced by the POSIX entrypoint before any zsh syntax is evaluated. Provisioning
# belongs to bootstrap-tao-dev-env; ordinary commands only reuse installed tools.
tao_exec_repo_zsh() {
  tao_shell_root=$1
  shift
  tao_shell_profile="$tao_shell_root/.devenv/profile/bin/zsh"
  if [ -x "$tao_shell_profile" ]; then
    tao_shell_profile=$(CDPATH= cd -- "$tao_shell_root/.devenv/profile/bin" && pwd -P)/zsh
    exec "$tao_shell_profile" "$@"
  fi

  # Older full profiles lack zsh. The existing zsh activation also knows how to
  # reuse a primary checkout's profile when this is a new linked worktree.
  tao_shell_host=$(command -v zsh) || tao_shell_host=
  if [ -n "$tao_shell_host" ]; then
    exec "$tao_shell_host" "$@"
  fi

  printf '%s\n' "Tao's pinned profile or zsh is unavailable." >&2
  printf '%s\n' 'On macOS run ./enter-tao-dev-env; on Linux run ./bootstrap-tao-dev-env --install-nix.' >&2
  exit 1
}

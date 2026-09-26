# Preserve the developer's normal interactive settings, then load checkout-local completion.
ZDOTDIR="${TAO_ORIGINAL_ZDOTDIR:-$HOME}"
if [[ -r "$ZDOTDIR/.zshrc" ]]; then
  source "$ZDOTDIR/.zshrc"
fi

if ! typeset -f compdef >/dev/null 2>&1; then
  autoload -Uz compinit
  compinit -D
fi
eval "$("$DEVENV_ROOT/dev" completion zsh)"

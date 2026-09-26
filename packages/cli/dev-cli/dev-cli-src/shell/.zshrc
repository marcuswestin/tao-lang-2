# Preserve the developer's normal interactive settings, then load checkout-local completion.
if [[ -r "$TAO_ORIGINAL_ZDOTDIR/.zshrc" ]]; then
  # Let the developer's own startup code put its completion dump beside that startup file.
  ZDOTDIR="$TAO_ORIGINAL_ZDOTDIR"
  source "$TAO_ORIGINAL_ZDOTDIR/.zshrc"
fi

if ! typeset -f compdef >/dev/null 2>&1; then
  autoload -Uz compinit
  compinit -D
fi
eval "$("$DEVENV_ROOT/dev" completion zsh)"

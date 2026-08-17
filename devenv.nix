{ pkgs, ... }:

let
  # Keep one Node pin for both devenv's JavaScript support and Expo's direct `node` usage.
  nodePkg = pkgs.nodejs_24;
in
{
  name = "tao-lang";

  # Tao's shell needs Nix-provided JS/dev tools, but native iOS builds should keep
  # using Xcode/CocoaPods directly. Nix compiler wrappers can break Apple flags.
  stdenv = if pkgs.stdenv.isDarwin then pkgs.stdenvNoCC else pkgs.stdenv;
  apple.sdk = null;

  enterShell = ''
    TAO_BIN_DIR="$DEVENV_ROOT/.artifacts/build/bin"
    TAO_FPATH_DIR="$DEVENV_ROOT/.artifacts/build/fpath"

    for bin_dir in "$DEVENV_ROOT/node_modules/.bin" "$DEVENV_ROOT/packages/shared/node_modules/.bin"; do
      if [ -d "$bin_dir" ]; then
        export PATH="$bin_dir:$PATH"
      fi
    done

    export PATH="$TAO_BIN_DIR:$PATH"
    export FPATH="$TAO_FPATH_DIR:$FPATH"

    TAO_BUILD_STAMP="$DEVENV_ROOT/.artifacts/dev/devenv-build.stamp"
    TAO_NEEDS_BUILD=false

    for required_path in "$TAO_BIN_DIR/tao" "$TAO_BIN_DIR/dev" "$TAO_FPATH_DIR/_tao" "$TAO_FPATH_DIR/_dev"; do
      if [ ! -e "$required_path" ]; then
        TAO_NEEDS_BUILD=true
      fi
    done

    if [ ! -e "$TAO_BUILD_STAMP" ]; then
      TAO_NEEDS_BUILD=true
    elif [ "$DEVENV_ROOT/Justfile" -nt "$TAO_BUILD_STAMP" ] || [ "$DEVENV_ROOT/bun.lock" -nt "$TAO_BUILD_STAMP" ]; then
      TAO_NEEDS_BUILD=true
    elif [ -n "$(find "$DEVENV_ROOT/packages" -path '*/node_modules' -prune -o -path '*/_gen_*' -prune -o \( -name '*.ts' -o -name '*.tsx' -o -name '*.langium' -o -name '*.json' \) -newer "$TAO_BUILD_STAMP" -print -quit)" ]; then
      TAO_NEEDS_BUILD=true
    fi

    if [ "$TAO_NEEDS_BUILD" = true ]; then
      mkdir -p "$DEVENV_ROOT/.artifacts/dev"
      if (cd "$DEVENV_ROOT" && just setup && just build); then
        touch "$TAO_BUILD_STAMP"
      else
        echo "warning: Tao repo-local setup/build failed; run 'just setup' and 'just build'." >&2
      fi
    fi
  '';

  languages.javascript = {
    enable = true;
    package = nodePkg;
    bun.enable = true;
    npm.enable = true;
  };

  android = {
    enable = true;
    reactNative.enable = true;
    platforms.version = [ "36" ];
    buildTools.version = [ "36.0.0" "35.0.0" ];
    ndk.version = [ "27.1.12297006" ];
    abis = [ "arm64-v8a" ];
    systemImageTypes = [ "google_apis" ];
    android-studio.enable = false;
  };

  packages = [
    nodePkg
    pkgs.cocoapods
    pkgs.dprint
    pkgs.fd
    pkgs.git
    pkgs.just
    pkgs.jq
    pkgs.oxlint
    pkgs.ripgrep
    pkgs.watchexec
  ];

  env.TAO_DEVENV = "1";
  env.LANG = "en_US.UTF-8";
  env.LC_ALL = "en_US.UTF-8";
  env.LC_CTYPE = "en_US.UTF-8";

  scripts.j = {
    exec = ''just "$@"'';
    description = "just";
  };
  scripts.t = {
    exec = ''just test "$@"'';
    description = "just test";
  };
  scripts.f = {
    exec = ''just fix "$@"'';
    description = "just fix";
  };
  scripts.b = {
    exec = ''just build "$@"'';
    description = "just build";
  };
  scripts.v = {
    exec = ''just verify "$@"'';
    description = "just verify";
  };
  scripts.c = {
    exec = ''just check "$@"'';
    description = "just check";
  };
  scripts.cl = {
    exec = ''just clean "$@"'';
    description = "just clean";
  };
}

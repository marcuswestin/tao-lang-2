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
    for bin_dir in "$DEVENV_ROOT/node_modules/.bin" "$DEVENV_ROOT/packages/shared/node_modules/.bin"; do
      if [ -d "$bin_dir" ]; then
        export PATH="$bin_dir:$PATH"
      fi
    done
  '';

  languages.javascript = {
    enable = true;
    package = nodePkg;
    bun.enable = true;
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
    # GNU coreutils for `timeout`, which repository scripts and agents use to bound a run.
    pkgs.coreutils
    pkgs.dprint
    pkgs.git
    pkgs.just
    pkgs.ripgrep
    pkgs.watchman
  ];

  env.TAO_DEVENV = "1";
  env.LANG = "en_US.UTF-8";
  env.LC_ALL = "en_US.UTF-8";
  env.LC_CTYPE = "en_US.UTF-8";

  scripts.tao = {
    exec = ''"$DEVENV_ROOT/tao" "$@" '';
    description = "Tao language CLI";
  };
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

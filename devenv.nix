{ pkgs, inputs, ... }:

let
  # Keep one Node pin for both devenv's JavaScript support and Expo's direct `node` usage.
  nodePkg = pkgs.nodejs_24;
  # Bun 1.4.2 fixes the compiled-binary signature failure on macOS 27. Keep the
  # rest of the toolchain on its existing nixpkgs pin.
  bunPkg = (import inputs.bun-nixpkgs { system = pkgs.stdenv.system; }).bun;
  hutchPkg = pkgs.callPackage ./nix/hutch.nix { };
in
{
  name = "tao-lang";

  # Tao's shell needs Nix-provided JS/dev tools, but native iOS builds should keep
  # using Xcode/CocoaPods directly. Nix compiler wrappers can break Apple flags.
  stdenv = if pkgs.stdenv.isDarwin then pkgs.stdenvNoCC else pkgs.stdenv;
  apple.sdk = null;

  enterShell = ''
    export PATH="$DEVENV_ROOT:$PATH"
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
    bun.package = bunPkg;
  };

  android = {
    enable = true;
    reactNative.enable = true;
    platforms.version = [ "36" ];
    buildTools.version = [ "36.0.0" "35.0.0" ];
    # Expo SDK 57's expo-updates plugin still requests 27.0 while React Native uses 27.1.
    ndk.version = [ "27.0.12077973" "27.1.12297006" ];
    abis = [ "arm64-v8a" ];
    systemImageTypes = [ "google_apis" ];
    android-studio.enable = false;
  };

  packages = [
    nodePkg
    # `just secrets` encrypts with age; the Secure Enclave plugin keeps the identity in hardware, so
    # decrypting asks for a fingerprint and no passphrase exists to be stored or typed.
    pkgs.age
    pkgs.cocoapods
    # GNU coreutils for `timeout`, which repository scripts and agents use to bound a run.
    pkgs.coreutils
    pkgs.dprint
    # `./agent open-pr` and `companion-host-publish` drive GitHub through gh; pinning it here gives
    # every checkout the same version rather than whatever each machine installed, if any.
    pkgs.gh
    pkgs.git
    pkgs.just
    pkgs.ripgrep
    pkgs.watchman
    hutchPkg
  ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [ pkgs.age-plugin-se ];

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

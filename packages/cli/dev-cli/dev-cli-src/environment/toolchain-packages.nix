{ pkgs, bunPkgs }:

let
  # Keep one Node pin for both devenv's JavaScript support and Expo's direct `node` usage.
  node = pkgs.nodejs_24;
  # Bun's separate existing lock fixes compiled-binary signatures on macOS 27.
  bun = bunPkgs.bun;
in
{
  inherit node bun;
  packages = [
    node
    bun
    pkgs.age
    # Repository scripts use GNU timeout to bound a run.
    pkgs.coreutils
    pkgs.dprint
    pkgs.gh
    pkgs.git
    pkgs.just
    pkgs.ripgrep
    pkgs.watchman
    pkgs.zsh
  ];
}

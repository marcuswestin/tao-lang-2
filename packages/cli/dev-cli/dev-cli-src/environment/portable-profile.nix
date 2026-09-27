{ system ? builtins.currentSystem }:

let
  lock = builtins.fromJSON (builtins.readFile ../../../../../devenv.lock);
  source = name:
    let pinned = lock.nodes.${name}.locked;
    in builtins.fetchTarball {
      url = "https://github.com/${pinned.owner}/${pinned.repo}/archive/${pinned.rev}.tar.gz";
      sha256 = pinned.narHash;
    };
  pkgs = import (source "nixpkgs-src") { inherit system; };
  bunPkgs = import (source "bun-nixpkgs") { inherit system; };
  toolchain = import ./toolchain-packages.nix { inherit pkgs bunPkgs; };
in
pkgs.buildEnv {
  name = "tao-portable-profile";
  paths = toolchain.packages;
}

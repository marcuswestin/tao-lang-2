{ lib, stdenvNoCC, fetchurl, makeWrapper }:

let
  release = builtins.fromJSON (builtins.readFile ./hutch-release.json);
  platforms = {
    aarch64-darwin = "macos-arm64";
    x86_64-linux = "linux-x64";
    aarch64-linux = "linux-arm64";
  };
  platform = platforms.${stdenvNoCC.hostPlatform.system}
    or (throw "Hutch ${release.version} has no release for ${stdenvNoCC.hostPlatform.system}");
  archive = release.platforms.${platform}.archive;
in
stdenvNoCC.mkDerivation {
  pname = "hutch";
  inherit (release) version;

  src = fetchurl {
    inherit (archive) url sha256;
  };
  nativeBuildInputs = [ makeWrapper ];
  dontBuild = true;
  # Preserve upstream native signatures and the engine's adjacent release metadata.
  dontStrip = true;
  dontPatchELF = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/libexec/hutch" "$out/bin"
    cp -R . "$out/libexec/hutch/"
    makeWrapper "$out/libexec/hutch/bin/hutch" "$out/bin/hutch" \
      --set HUTCH_ENGINE_BINARY "$out/libexec/hutch/bin/hutch-engine"
    runHook postInstall
  '';

  meta = {
    description = "Pinned native Studio build and workspace launcher";
    homepage = "https://github.com/blackboardsh/hutch";
    license = lib.licenses.mit;
    platforms = builtins.attrNames platforms;
    mainProgram = "hutch";
  };
}

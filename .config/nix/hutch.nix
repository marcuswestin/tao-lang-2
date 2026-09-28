{ lib, stdenvNoCC, fetchurl, makeWrapper, writeText, zig_0_16, nodejs }:

let
  release = builtins.fromJSON (builtins.readFile ./hutch-release.json);
  platforms = {
    aarch64-darwin = "macos-arm64";
    x86_64-linux = "linux-x64";
    aarch64-linux = "linux-arm64";
  };
  platform = platforms.${stdenvNoCC.hostPlatform.system}
    or (throw "Hutch ${release.version} has no release for ${stdenvNoCC.hostPlatform.system}");
  archiveMetadata = writeText "hutch-release.json" (builtins.toJSON {
    schema = 1;
    kind = "archive";
    product = "hutch";
    inherit (release) channel version revision;
    inherit platform;
    launcher = "bin/hutch";
    executable = "bin/hutch-engine";
  });
in
stdenvNoCC.mkDerivation {
  pname = "hutch";
  inherit (release) version;

  src = fetchurl {
    url = "https://github.com/blackboardsh/hutch/archive/${release.revision}.tar.gz";
    sha256 = "98431a46567200bf19a31e0e2a6dbb3f4504f8156422913c1e3df924b2509705";
  };
  nativeBuildInputs = [ makeWrapper zig_0_16 ];
  nativeCheckInputs = [ nodejs ];
  dontConfigure = true;
  # Patch a private compiler library, never the shared Zig installation. Preserve Hutch's
  # upstream bounded hostname connector as well as the origin-TLS repair after CONNECT.
  postPatch = ''
    mkdir -p vendors/zig
    cp -R ${zig_0_16}/lib/zig vendors/zig/lib
    chmod -R u+w vendors/zig/lib
    patch -p1 < patches/zig-0.16.0-hostname-connect.patch
    patch -d vendors/zig -p1 < ${./hutch-https-proxy.patch}
  '';
  buildPhase = ''
    runHook preBuild
    export ZIG_GLOBAL_CACHE_DIR="$TMPDIR/zig-global-cache"
    zig build -Doptimize=ReleaseSmall -Dcpu=baseline -j"$NIX_BUILD_CORES" \
      --zig-lib-dir "$PWD/vendors/zig/lib"
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    zig build-exe ${./hutch-proxy-tests/client.zig} -ODebug \
      --zig-lib-dir "$PWD/vendors/zig/lib" -femit-bin="$TMPDIR/hutch-proxy-client"
    node ${./hutch-proxy-tests}/run.mjs "$TMPDIR/hutch-proxy-client"
    runHook postCheck
  '';
  # Zig emits the Darwin ad-hoc signatures; post-build stripping invalidates them.
  dontStrip = true;
  dontPatchELF = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/libexec/hutch" "$out/bin"
    cp -R zig-out/bin "$out/libexec/hutch/"
    cp ${archiveMetadata} "$out/libexec/hutch/hutch-release.json"
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

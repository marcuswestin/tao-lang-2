#!/usr/bin/env python3
"""ZIP-backed command fixture for trusted, owned test bundles; not a ditto emulator."""
import json
import os
from pathlib import Path
import sys
import zipfile

args = sys.argv[1:]
if len(args) == 5 and args[:3] == ["-c", "-k", "--keepParent"]:
    bundle, archive = map(Path, args[3:])
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        for path in sorted(bundle.rglob("*")):
            zipped.write(path, path.relative_to(bundle.parent))
elif len(args) == 4 and args[:2] == ["-x", "-k"]:
    archive, destination = map(Path, args[2:])
    with zipfile.ZipFile(archive) as zipped:
        zipped.extractall(destination)
else:
    sys.exit("Unsupported ditto fixture arguments: " + repr(args))

with open(os.environ["TAO_ZIP_FIXTURE_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps(args) + "\n")

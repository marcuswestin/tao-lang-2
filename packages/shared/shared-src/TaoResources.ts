import { throwUserInput } from './core/Errors'
import * as FS from './FS'
import * as Platform from './Platform'

/**
 * TaoResources owns where the files Tao reads at runtime live: the stdlib sources, the runtime
 * module the CLI installs into a project, the Expo host's toolchain files, and the TextMate
 * grammar. Inside a checkout each of those sits beside the package that reads it, and every reader
 * resolved its own path from `import.meta.dirname`. A compiled binary has no such tree — that
 * directory is inside `/$bunfs`, which no child process can read — so an installed Tao unpacks
 * these once per version beside its own binary. This module is the one place that knows which of
 * the two layouts is in front of it.
 *
 * `declaredRoot` answers `undefined` rather than a repository path when neither an override nor an
 * installed layout is present, so each reader keeps its existing module-relative default. That
 * keeps the seam additive: converting a reader adds a branch rather than replacing a resolution
 * that already works, and the repository's own `./tao` and every test go on resolving as they do
 * today.
 *
 * The two rules here are `TaoStdlib`'s, for its reasons. A declared value must be absolute, because
 * the halves of such a variable's job resolve it against different directories and a relative value
 * therefore names two trees. And the root is part of the identity that `tao test` and the
 * repository build key compiled output on, because a resource root that moves without changing that
 * identity silently reuses a compile made against a different stdlib.
 */

/** DECLARED_ROOT_ENV is the one spelling of the variable that relocates Tao's runtime resources. */
const DECLARED_ROOT_ENV = 'TAO_RESOURCES'

/** INSTALLED_DIRECTORY is what an installed Tao unpacks beside its own binary, once per version. */
const INSTALLED_DIRECTORY = 'resources'

/**
 * COMPLETION_STAMP is written last, after every resource is on disk, and is what the probe below
 * actually looks for. Testing the directory alone would answer two questions wrongly: a half-written
 * unpack would be read as finished, and any unrelated `resources` directory that happened to sit
 * beside the running executable would be mistaken for ours.
 */
const COMPLETION_STAMP = '.tao-resources'

/**
 * STDLIB_DIRECTORY is where the stdlib sits inside the resource root. It is named here rather than
 * at the reader because `TaoStdlib` resolves it, and that module owns the stdlib root for every
 * scheme that has to hash it.
 */
const STDLIB_DIRECTORY = 'stdlib'

/** HOST_DIRECTORY is where the Expo host's toolchain files sit inside the resource root. */
const HOST_DIRECTORY = 'host'

/**
 * installedProbe caches a found installed root. Only a hit is cached: the binary's entry point
 * unpacks the resources before anything reads them, and a miss remembered from before that unpack
 * would outlive it. The environment variable is deliberately not cached either, because a test that
 * sets it after first use must still be answered honestly.
 */
let installedProbe: string | undefined

/** TaoResources owns the root of the files Tao reads at runtime, and how it is found. */
export const TaoResources = {
  COMPLETION_STAMP,
  DECLARED_ROOT_ENV,
  HOST_DIRECTORY,
  INSTALLED_DIRECTORY,
  STDLIB_DIRECTORY,
  declaredRoot,
  installedDirectory,
  resolve,
} as const

/**
 * declaredRoot returns the resource root in front of this process, or undefined when the caller
 * should use its own in-repository default.
 *
 * The order is override, then installed layout, then nothing. The override comes first so a test or
 * a packaged Studio can point a real binary at a tree of its own; the installed layout is found by
 * probing rather than by asking whether this is a compiled binary, because the honest question is
 * whether the resources are there and a build that has not unpacked them yet must fall through
 * rather than name a directory that does not exist.
 */
function declaredRoot(): string | undefined {
  const declared = Platform.runtimeProcess.env[DECLARED_ROOT_ENV]
  if (declared !== undefined && declared.length > 0) {
    if (!FS.isAbsolute(declared)) {
      throwUserInput(
        `${DECLARED_ROOT_ENV} must be an absolute path; it was ${JSON.stringify(declared)}. `
          + 'A relative value is read against the current directory and hashed against the '
          + 'repository root, which are not the same tree.',
      )
    }
    return declared
  }
  return installedRoot()
}

/**
 * resolve names a path inside the resource root, or undefined when there is no such root. Callers
 * read that undefined as "use the layout you already had", which is what keeps every existing
 * resolution working unchanged inside a checkout.
 */
function resolve(relativePath: string): string | undefined {
  const root = declaredRoot()
  return root === undefined ? undefined : FS.resolvePath(relativePath, root)
}

/**
 * installedDirectory is where an installed Tao keeps its resources: beside the executable, with any
 * symlink to it resolved, so a binary reached through a link on `PATH` still finds the tree it was
 * unpacked into rather than looking beside the link. It names the directory whether or not it holds
 * anything; the unpack writes it and the probe below asks whether it is complete.
 */
function installedDirectory(): string {
  const executable = Platform.runtimeProcess.execPath
  const resolved = FS.existsSync(executable) ? FS.realPathSync(executable) : executable
  return FS.resolvePath(INSTALLED_DIRECTORY, FS.dirname(resolved))
}

/** installedRoot is the completely unpacked tree beside the running binary, when one is there. */
function installedRoot(): string | undefined {
  if (installedProbe === undefined) {
    const candidate = installedDirectory()
    if (FS.existsSync(FS.resolvePath(COMPLETION_STAMP, candidate))) {
      installedProbe = candidate
    }
  }
  return installedProbe
}

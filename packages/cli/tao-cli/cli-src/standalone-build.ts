import { CLI, Errors, FS, HCI, Platform, Repo, TaoResources } from '@shared'
import { TaoAppModules } from './app-modules'
import { StandaloneResources } from './standalone-resources'

/**
 * standalone-build compiles the distributable Tao binary for this host, with the resource payload it
 * unpacks on first run embedded inside it. `just standalone-cli-build` runs it after generating the
 * parser, which the binary bundles and a fresh worktree does not yet have.
 *
 * The payload is staged as a real tree before it is packed, in the layout `TaoResources` reads, so a
 * failure can be inspected on disk and the staged tree can stand in for an installed one through
 * `TAO_RESOURCES`.
 */

const BUILD_ROOT = '.artifacts/build'
const ENTRY_POINT = 'packages/cli/tao-cli/cli-src/tao-standalone.ts'

/**
 * MINIMUM_DARWIN_BUN is the first Bun whose compiled binary macOS 27 will run: earlier ones append
 * their payload after the code signature, and the kernel kills the result on launch.
 */
const MINIMUM_DARWIN_BUN = '1.4.2'

/** Package paths the payload copies, each package to its place in the resource layout. */
const COPIED_TREES = [
  // The stdlib root is the package: its packages under `@tao/`, and the `Project.tao` that gives
  // their declarations the project identity every compiled app's navigation is keyed on.
  { source: 'packages/apps/stdlib', within: ['@tao', 'Project.tao'], target: TaoResources.STDLIB_DIRECTORY },
  { source: 'packages/apps/expo-host', within: ['.'], target: TaoResources.HOST_DIRECTORY },
] as const

try {
  await buildStandalone(Platform.runtimeProcess.argv[2] ?? `${BUILD_ROOT}/tao`)
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}

async function buildStandalone(outfile: string): Promise<void> {
  assertBunCanCompile()
  const repoRoot = Repo.getRoot()
  const staging = FS.resolvePath(`${BUILD_ROOT}/standalone/${TaoResources.INSTALLED_DIRECTORY}`, repoRoot)
  const archive = FS.resolvePath(`${BUILD_ROOT}/standalone/${StandaloneResources.PAYLOAD_FILE_NAME}`, repoRoot)

  await FS.remove(staging)
  for (const tree of COPIED_TREES) {
    for (const within of tree.within) {
      await copyVisibleFiles(FS.resolvePath(tree.source, repoRoot), within, FS.resolvePath(tree.target, staging))
    }
  }
  await TaoAppModules.packageRuntime(staging, FS.resolvePath('packages/apps/runtime', repoRoot))
  const fileCount = await packTree(staging, archive)
  HCI.logProcessInfo('standalone', `Packed ${fileCount} resource files into ${FS.relativePath(repoRoot, archive)}.`)

  await CLI.mustRun(Platform.runtimeProcess.execPath, {
    args: ['build', '--compile', '--outfile', FS.resolvePath(outfile, repoRoot), ENTRY_POINT, archive],
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

/**
 * copyVisibleFiles copies the files Git does not ignore at or under `within`, keeping their paths relative
 * to `packageRoot`. Ignored files are exactly the ones that must not ship: installed dependencies,
 * generated trees, and build state.
 */
async function copyVisibleFiles(packageRoot: string, within: string, target: string): Promise<void> {
  for (const file of await Repo.filesUnder(FS.resolvePath(within, packageRoot))) {
    await FS.copyFile(file, FS.resolvePath(FS.relativePath(packageRoot, file), target))
  }
}

/** packTree writes every file under `root` into one gzipped archive and returns how many it holds. */
async function packTree(root: string, archive: string): Promise<number> {
  const files: Record<string, Uint8Array> = {}
  for await (const path of FS.walk(root, { includeHidden: true })) {
    files[FS.relativePath(root, path)] = await FS.readFile(path)
  }
  await FS.mkdir(FS.dirname(archive))
  await Bun.Archive.write(archive, files, { compress: 'gzip' })
  return Object.keys(files).length
}

function assertBunCanCompile(): void {
  if (Platform.hostPlatform === 'darwin' && !Platform.semverSatisfies(Bun.version, `>=${MINIMUM_DARWIN_BUN}`)) {
    Errors.throwHostEnvironment(
      `Bun ${Bun.version} compiles binaries that macOS kills on launch; ${MINIMUM_DARWIN_BUN} or later is `
        + 'required, and devenv pins it. A shell still on an older Bun has a devenv profile built '
        + 'before that pin: reload it with `direnv reload`.',
    )
  }
}

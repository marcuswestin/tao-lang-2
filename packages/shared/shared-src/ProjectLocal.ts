import * as FS from './FS'
import * as Platform from './Platform'

/**
 * ProjectLocal owns a project's own `.tao/` folder: what Tao keeps for one developer beside a
 * project and never commits. The folder holds three entries and nothing else. `store/` keeps what a
 * developer would lose if it vanished: dev-session history, local dev data, and retained builds.
 * `cache/` keeps what Tao regenerates, along with the temporary files and locks Tao uses while it
 * writes anywhere in the project, so a committed folder never shows one. `.gitignore` ignores the
 * whole folder, so a project without an ignore file of its own still never commits it.
 *
 * Committed project state is `.tao-project/`; machine-wide state is `TaoHome`.
 */
export const ProjectLocal = { cacheResolve, prepare, root, stagingPath, storeResolve }

const IGNORE_FILE_CONTENT = '*\n'

/** Each entry of the layout before `store/` and `cache/`, with where it now lives; a child moves before its parent. */
const legacyEntries = [
  ['sessions', 'store/sessions'],
  ['builds', 'store/builds'],
  ['dev/data', 'store/dev-data'],
  ['dev', 'cache/dev'],
  ['bridge-check.tsconfig.json', 'cache/bridge-check.tsconfig.json'],
  ['browser-acceptance', 'cache/browser-acceptance'],
] as const

/** root is the project's `.tao/` folder. */
function root(projectRoot: string): string {
  return FS.resolvePath('.tao', projectRoot)
}

/** storeResolve names a path a developer keeps: it survives until they delete it. */
function storeResolve(relativePath: string, projectRoot: string): string {
  return FS.resolvePath(relativePath, FS.resolvePath('store', root(projectRoot)))
}

/** cacheResolve names a path Tao regenerates, safe to delete while no Tao process uses the project. */
function cacheResolve(relativePath: string, projectRoot: string): string {
  return FS.resolvePath(relativePath, FS.resolvePath('cache', root(projectRoot)))
}

/**
 * stagingPath names a fresh temporary file to write before moving it onto `targetPath`, a file in the
 * same project. It sits in the cache, so an interrupted write never leaves a stray beside the target.
 */
function stagingPath(targetPath: string, projectRoot: string): string {
  return cacheResolve(`tmp/${FS.basename(targetPath)}.${Platform.randomUUID()}.tmp`, projectRoot)
}

/**
 * prepare readies the folder before a write: it moves any entry of the older layout to where it now
 * lives and makes `.gitignore` ignore everything. It is idempotent and safe to run concurrently.
 */
async function prepare(projectRoot: string): Promise<void> {
  const folder = root(projectRoot)
  for (const [from, to] of legacyEntries) {
    await moveLegacyEntry(FS.resolvePath(from, folder), FS.resolvePath(to, folder))
  }
  const ignorePath = FS.resolvePath('.gitignore', folder)
  if (!await FS.isFile(ignorePath) || await FS.readText(ignorePath) !== IGNORE_FILE_CONTENT) {
    await FS.writeText(ignorePath, IGNORE_FILE_CONTENT)
  }
}

async function moveLegacyEntry(from: string, to: string): Promise<void> {
  if (!await FS.exists(from) || await FS.exists(to)) {
    return
  }
  try {
    await FS.move(from, to)
  } catch (error) {
    // Another process preparing the same project moved it first.
    if (await FS.exists(from)) {
      throw error
    }
  }
}

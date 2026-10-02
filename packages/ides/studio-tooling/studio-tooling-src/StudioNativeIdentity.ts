import { FS, Platform, Repo } from '@shared'
import { defaultStudioAppName, defaultStudioBundleIdentifier } from './StudioElectrobun'

const nativeHostResourcePrefix = 'studio-native-host'
const worktreeNameLimit = 40
const worktreeHashLength = 8

/**
 * StudioNativeIdentity is what makes one worktree's development Studio a different macOS app from
 * another's: its bundle identifier (and so its Electrobun user data and macOS permissions), the name
 * its Dock entry and windows show, and the machine lease that keeps one native Studio per worktree.
 */
export type StudioNativeIdentity = {
  appName: string
  bundleIdentifier: string
  hostResourceName: string
  /** Tests wait for their own host and never offer to stop its current owner. */
  testing?: boolean
}

/** StudioWorktree is the checkout a development Studio is launched from. */
type StudioWorktree = {
  /** A linked worktree's `.git` is a file; the primary checkout's is the repository directory. */
  linked: boolean
  name: string
  realPath: string
}

export const StudioNativeIdentity = {
  forTest,
  forWorktree,
  of,
} as const

/** A stable test app keeps native consent across runs while separating every checkout. */
async function forTest(repositoryRoot: string = Repo.getRoot()): Promise<StudioNativeIdentity> {
  const realPath = await FS.realPath(repositoryRoot)
  const hash = Platform.sha256Hex(realPath).slice(0, 12)
  return {
    ...identity(`${defaultStudioAppName} Test — ${hash}`, `${defaultStudioBundleIdentifier}.test-${hash}`),
    testing: true,
  }
}

/** forWorktree derives the development Studio identity of the checkout at `repositoryRoot`. */
async function forWorktree(repositoryRoot: string = Repo.getRoot()): Promise<StudioNativeIdentity> {
  const realPath = await FS.realPath(repositoryRoot)
  return of({
    linked: await FS.isFile(FS.resolvePath('.git', realPath)),
    name: FS.basename(realPath),
    realPath,
  })
}

/**
 * The primary checkout keeps the release identity so the macOS permissions already granted to it
 * stay valid. A linked worktree adds a bundle-identifier-legal form of its directory name and a
 * short hash of its real path, so two worktrees with the same directory name still differ; each new
 * identity asks macOS for Accessibility and Automation permission once.
 */
function of(worktree: StudioWorktree): StudioNativeIdentity {
  if (!worktree.linked) {
    return identity(defaultStudioAppName, defaultStudioBundleIdentifier)
  }
  const name = bundleIdentifierSegment(worktree.name)
  const hash = Platform.sha256Hex(worktree.realPath).slice(0, worktreeHashLength)
  return identity(
    `${defaultStudioAppName} — ${name}`,
    `${defaultStudioBundleIdentifier}.${name}-${hash}`,
  )
}

function identity(appName: string, bundleIdentifier: string): StudioNativeIdentity {
  return { appName, bundleIdentifier, hostResourceName: `${nativeHostResourcePrefix}:${bundleIdentifier}` }
}

/** A bundle identifier segment holds only ASCII letters, digits, and hyphens. */
function bundleIdentifierSegment(name: string): string {
  const segment = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .slice(0, worktreeNameLimit)
    .replaceAll(/^-|-$/g, '')
  return segment === '' ? 'worktree' : segment
}

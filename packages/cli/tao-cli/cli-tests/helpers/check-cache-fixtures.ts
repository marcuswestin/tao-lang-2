import { FS, Platform } from '@shared'
import { Expect } from '@shared/test'
import { type CheckWorkspaceOutcome, runCheck } from '../../cli-src/source-commands'
import { withoutInheritedNoCache, withTaoHome } from '../test-cli-files'

export const CANONICAL_VIEW = 'use Text from @tao/ui\n\nview MainView() {\n   render Text("Hello")\n}\n'

export const TWO_WORKSPACES = {
  'AppOne/Main.tao': CANONICAL_VIEW,
  'AppOne/.tao/.gitkeep': '',
  'AppTwo/Main.tao': CANONICAL_VIEW,
  'AppTwo/.tao/.gitkeep': '',
} as const

/**
 * STAMPED_WORKSPACES is the tree `withStampedWorkspaces` hands out: two clean workspaces plus the
 * sidecar, stdlib and runtime files the invalidation tests change, so every such test starts from
 * the same stamped state.
 */
const STAMPED_WORKSPACES = {
  ...TWO_WORKSPACES,
  'AppOne/@ui/Shell.ts': 'export const shell = 1\n',
  'packages/apps/stdlib/@tao/ui/Shell.ts': 'export const shell = 1\n',
  'packages/apps/runtime/package.json': '{"name":"@tao/runtime","version":"1.0.0"}\n',
} as const

export const NESTED_WORKSPACE = {
  'App/Main.tao': CANONICAL_VIEW,
  'App/.tao/.gitkeep': '',
  'App/Sub/Other.tao': CANONICAL_VIEW.replace('MainView', 'OtherView'),
} as const

/** checkedWorkspaces runs a check against a fixture-local stamp and names what it did to each workspace. */
export async function checkedWorkspaces(
  rootDir: string,
  checkedPath = rootDir,
): Promise<Record<string, CheckWorkspaceOutcome['resolution']>> {
  const outcomes: Record<string, CheckWorkspaceOutcome['resolution']> = {}
  await runCheck(checkedPath, {
    cache: { repositoryRoot: rootDir },
    onWorkspace: outcome => {
      outcomes[FS.relativePath(rootDir, outcome.workspaceRoot)] = outcome.resolution
    },
  })
  return outcomes
}

type StampedFixture = { root: string; snapshot: string }

let stampedFixture: Promise<StampedFixture> | undefined

/**
 * withStampedWorkspaces runs a test on a `STAMPED_WORKSPACES` fixture whose stamp already holds a
 * clean verdict for both workspaces. The first caller in a process checks the fixture from source
 * once and snapshots it; every caller then gets that snapshot restored at the same absolute root,
 * since the generated TypeScript config each verdict hashes names its root. Each caller proves the
 * restored stamp replays before its test runs, so a test expecting `checked` cannot pass on a stamp
 * that never replayed. Tests in this suite run one at a time within a process, which the one root
 * relies on.
 */
export async function withStampedWorkspaces(run: (rootDir: string) => Promise<void>): Promise<void> {
  const { root, snapshot } = await (stampedFixture ??= stampFixture())
  await FS.remove(root)
  await FS.copyDirectory(snapshot, root)
  await withoutInheritedNoCache(async () => {
    await withTaoHome(root, async () => {
      Expect(await checkedWorkspaces(root)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
      await run(root)
    })
  })
}

/** stampFixture checks a fresh fixture from source and keeps its snapshot for the rest of the process. */
async function stampFixture(): Promise<StampedFixture> {
  // Outside every test's directory scope: the fixture outlives the test that first stamps it.
  const base = await FS.realPath(await FS.mkTmpDir('tao-check-stamped-'))
  Platform.onProcessExit(() => FS.removeSync(base))
  const root = FS.resolvePath('root', base)
  const snapshot = FS.resolvePath('snapshot', base)
  for (const [relativePath, source] of Object.entries(STAMPED_WORKSPACES)) {
    await FS.writeText(FS.resolvePath(relativePath, root), source)
  }
  await withoutInheritedNoCache(async () => {
    await withTaoHome(root, async () => {
      Expect(await checkedWorkspaces(root)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })
    })
  })
  await FS.copyDirectory(root, snapshot)
  return { root, snapshot }
}

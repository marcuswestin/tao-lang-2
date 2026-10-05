import { FS } from '@shared'
import { type CheckWorkspaceOutcome, runCheck } from '../../cli-src/source-commands'

export const CANONICAL_VIEW = 'use Text from @tao/ui\n\nview MainView() {\n   render Text("Hello")\n}\n'

export const TWO_WORKSPACES = {
  'AppOne/Main.tao': CANONICAL_VIEW,
  'AppOne/.tao/.gitkeep': '',
  'AppTwo/Main.tao': CANONICAL_VIEW,
  'AppTwo/.tao/.gitkeep': '',
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

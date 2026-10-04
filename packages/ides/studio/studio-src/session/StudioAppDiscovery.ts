import { ASTUtils } from '@ast-utils'
import type { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { findProjectRoot } from '@project-tooling'
import { Assert, Errors, FS } from '@shared'
import type { StudioAppVariant } from '../StudioProtocol'

export type StudioAppDiscoveryRequest = {
  appName?: string
  entryPath?: string
}

export type StudioAppSelection = {
  appId: string
  appName: string
  apps: readonly StudioAppVariant[]
  /** The selected app's entry file, absolute. */
  entryPath: string
}

/** requireStudioProjectRoot resolves the project folder a session opens to its canonical real path. */
export async function requireStudioProjectRoot(input: string): Promise<string> {
  const resolved = FS.resolvePath(input)
  Assert.input(await FS.isDirectory(resolved), `Studio project folder does not exist: ${resolved}`)
  const root = await findProjectRoot(resolved)
  Assert.input(root !== undefined, `Studio project folder has no .tao marker: ${resolved}`)
  return root
}

/**
 * discoverStudioApp inventories every app declared across the project's Tao files and picks the one
 * the session opens as: the requested app or entry when the command line named one, else the only app.
 */
export async function discoverStudioApp(
  projectRoot: string,
  workspace: Workspace,
  candidatePaths: readonly string[],
  request: StudioAppDiscoveryRequest,
): Promise<StudioAppSelection> {
  const apps = await discoverAppVariants(projectRoot, workspace, candidatePaths)
  const requestedEntryPath = request.entryPath === undefined
    ? undefined
    : FS.relativePath(projectRoot, await resolveEntryPath(projectRoot, request.entryPath))
  const selection = resolveAppSelection(projectRoot, apps, request.appName, requestedEntryPath)
  return {
    appId: selection.appId,
    appName: selection.appName,
    apps: apps.map(({ appName, entryPath }) => ({ appName, entryPath })),
    entryPath: FS.resolvePath(selection.entryPath, projectRoot),
  }
}

async function discoverAppVariants(
  projectRoot: string,
  workspace: Workspace,
  candidatePaths: readonly string[],
): Promise<Array<StudioAppVariant & { appId: string }>> {
  const apps: Array<StudioAppVariant & { appId: string }> = []
  for (const entryPath of candidatePaths) {
    const parsed = await workspace.parse(entryPath)
    for (const declaration of AST.appValueDeclarationsInFile(parsed.entry.ast)) {
      const id = ASTUtils.effectiveAppConfiguration(declaration).get('id')?.value
      Assert.input(id !== undefined && AST.isStringLiteral(id), `Studio app ${declaration.name} needs an id.`)
      apps.push({ appId: id.value, appName: declaration.name, entryPath: FS.relativePath(projectRoot, entryPath) })
    }
  }
  return apps.toSorted((left, right) =>
    left.appName.localeCompare(right.appName) || left.entryPath.localeCompare(right.entryPath)
  )
}

/** Which app a project opens as, when the command line did not say. */
function resolveAppSelection(
  projectRoot: string,
  apps: readonly (StudioAppVariant & { appId: string })[],
  requestedAppName: string | undefined,
  requestedEntryPath: string | undefined,
): StudioAppVariant & { appId: string } {
  const matching = apps.filter(app =>
    (requestedAppName === undefined || app.appName === requestedAppName)
    && (requestedEntryPath === undefined || app.entryPath === requestedEntryPath)
  )
  if (matching.length === 0) {
    const available = apps.map(app => app.appName)
    Errors.throwUserInput(
      requestedAppName === undefined && requestedEntryPath === undefined
        ? `No Tao app declaration found under ${projectRoot}`
        : `No matching Tao app found. Available apps: ${available.join(', ') || 'none'}.`,
    )
  }
  Assert.input(
    matching.length === 1,
    requestedAppName === undefined && requestedEntryPath === undefined
      ? `Multiple Tao apps found: ${matching.map(app => app.appName).join(', ')}. Select an appName.`
      : `Multiple matching Tao app declarations were found. Select an appName and entryPath.`,
  )
  return matching[0]!
}

async function resolveEntryPath(projectRoot: string, input: string): Promise<string> {
  const resolved = FS.resolvePath(input, projectRoot)
  Assert.input(
    FS.extname(resolved) === '.tao' && await FS.isFile(resolved),
    `Studio entry is not a Tao file in the project: ${input}`,
  )
  const realPath = await FS.realPath(resolved)
  Assert.input(FS.pathIsWithin(realPath, projectRoot), `Studio entry resolves outside the project: ${input}`)
  return realPath
}

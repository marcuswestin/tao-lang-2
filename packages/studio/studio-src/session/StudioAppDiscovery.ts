import { AST } from '@parser'
import { Assert, Errors, FS } from '@shared'
import type { Workspace } from '@workspace'
import type { StudioAppVariant } from '../StudioProtocol'

export type StudioAppDiscoveryRequest = {
  appName?: string
  entryPath?: string
}

export type StudioAppSelection = {
  appName: string
  apps: readonly StudioAppVariant[]
  /** The selected app's entry file, absolute. */
  entryPath: string
}

/** requireStudioProjectRoot resolves the project folder a session opens to its canonical real path. */
export async function requireStudioProjectRoot(input: string): Promise<string> {
  const resolved = FS.resolvePath(input)
  Assert.input(await FS.isDirectory(resolved), `Studio project folder does not exist: ${resolved}`)
  return await FS.realPath(resolved)
}

/**
 * discoverStudioApp inventories every app declared across the project's Tao files and picks the one
 * the session opens as: the requested app or entry when the command line named one, else the project's
 * DefaultApp, else the only app there is.
 */
export async function discoverStudioApp(
  projectRoot: string,
  workspace: Workspace,
  candidatePaths: readonly string[],
  request: StudioAppDiscoveryRequest,
): Promise<StudioAppSelection> {
  const { apps, defaultAppName } = await discoverAppVariants(projectRoot, workspace, candidatePaths)
  const requestedEntryPath = request.entryPath === undefined
    ? undefined
    : FS.relativePath(projectRoot, await resolveEntryPath(projectRoot, request.entryPath))
  const selection = resolveAppSelection(projectRoot, apps, request.appName, requestedEntryPath, defaultAppName)
  return {
    appName: selection.appName,
    apps,
    entryPath: FS.resolvePath(selection.entryPath, projectRoot),
  }
}

async function discoverAppVariants(
  projectRoot: string,
  workspace: Workspace,
  candidatePaths: readonly string[],
): Promise<{ apps: StudioAppVariant[]; defaultAppName?: string }> {
  const apps: StudioAppVariant[] = []
  let defaultAppName: string | undefined
  for (const entryPath of candidatePaths) {
    const parsed = await workspace.parse(entryPath)
    for (const project of parsed.entry.ast.statements.filter(AST.isProjectDeclaration)) {
      defaultAppName ??= AST.blockStatementOf(project, { filter: AST.isProjectDefaultApp })[0]?.app.$refText
    }
    for (const declaration of AST.appValueDeclarationsInFile(parsed.entry.ast)) {
      apps.push({ appName: declaration.name, entryPath: FS.relativePath(projectRoot, entryPath) })
    }
  }
  return {
    apps: apps.toSorted((left, right) =>
      left.appName.localeCompare(right.appName) || left.entryPath.localeCompare(right.entryPath)
    ),
    ...(defaultAppName === undefined ? {} : { defaultAppName }),
  }
}

/**
 * Which app a project opens as, when the command line did not say.
 *
 * A project that declares `DefaultApp` has already answered this question for its own tooling —
 * `tao ship` reads it — so Studio reads it too rather than refusing every multi-app project until
 * someone repeats the answer as `--app`. An explicit request still wins, and a project without a
 * DefaultApp still has to be told which of several apps to open.
 */
function resolveAppSelection(
  projectRoot: string,
  apps: readonly StudioAppVariant[],
  requestedAppName: string | undefined,
  requestedEntryPath: string | undefined,
  defaultAppName?: string,
): StudioAppVariant {
  const selected = requestedAppName
    ?? (requestedEntryPath === undefined && apps.filter(app => app.appName === defaultAppName).length === 1
      ? defaultAppName
      : undefined)
  const matching = apps.filter(app =>
    (selected === undefined || app.appName === selected)
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

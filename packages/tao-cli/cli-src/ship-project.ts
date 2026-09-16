import { ASTUtils } from '@ast-utils'
import Formatter from '@formatter'
import { AST, Langium, Parser } from '@parser'
import { Errors, FS, Platform, Repo } from '@shared'
import { Workspace } from '@workspace'
import type { ShipVersion } from './ship-model'

export type ShipProjectApp = {
  baseAppName?: string
  displayName: string
  hasLocalDatasourceEndpoint: boolean
  /** icloud is present when the app mounts the iCloud datasource; its explicit container, if any. */
  icloud?: ShipICloudBinding
  isVariant: boolean
  name: string
  releaseDatasourceConfiguration?: Readonly<Record<string, string>>
  sourcePath: string
  /** The app configures the development-only `Dev` datasource, which needs a running dev server. */
  usesDevDatasource: boolean
}

export type ShipICloudBinding = {
  /** serviceBindings preserves which containers each mounted Apple provider actually uses. */
  serviceBindings: ReadonlyArray<{
    /** containers lists every explicit container mounted for this service. */
    containers: readonly string[]
    service: ShipICloudService
    /** usesDefaultContainer records a binding that defaults to the app bundle container. */
    usesDefaultContainer: boolean
  }>
}

export type ShipICloudService = 'CloudDocuments' | 'CloudKit'

/** The Apple datasource providers, each with the iCloud service its entitlement must name. */
const appleDatasourceProviders: ReadonlyArray<{ importPath: string; service: ShipICloudService; typeName: string }> = [
  { importPath: 'icloud', service: 'CloudDocuments', typeName: 'ICloud' },
  { importPath: 'cloudkit', service: 'CloudKit', typeName: 'CloudKit' },
]

export type ShipProject = {
  apps: ShipProjectApp[]
  defaultApp?: string
  id: string
  name: string
  primaryAppName: string
  projectSourcePath: string
  root: string
  version: ShipVersion
}

/** discoverShipProject climbs from a file or directory until it finds one direct project declaration. */
export async function discoverShipProject(targetPath: string): Promise<ShipProject> {
  const target = FS.resolvePath(targetPath)
  if (!await FS.exists(target)) {
    Errors.throwUserInput(`No file or directory found at ${target}`)
  }
  let directory = await FS.isFile(target) ? FS.dirname(target) : target
  // One parser context serves the whole climb; each parse would otherwise build the grammar again.
  const parserContext = Parser.createContext()
  while (true) {
    const candidates = (await Repo.filesUnder(directory, { extensions: ['.tao'] }))
      .filter(path => FS.dirname(path) === directory)
    const projectFiles: Array<{ path: string; project: AST.ProjectDeclaration }> = []
    for (const path of candidates) {
      const parsed = await Parser.parseSource(parserContext, await FS.readText(path), {
        uri: Langium.URI.file(path),
        validation: false,
      })
      for (const project of parsed.entry.ast.statements.filter(AST.isProjectDeclaration)) {
        projectFiles.push({ path, project })
      }
    }
    if (projectFiles.length > 1) {
      Errors.throwUserInput(
        `More than one Tao project declaration was found in ${directory}: ${
          projectFiles.map(item => item.path).join(', ')
        }.`,
      )
    }
    if (projectFiles.length === 1) {
      return await readShipProject(directory, projectFiles[0]!)
    }
    const parent = FS.dirname(directory)
    if (parent === directory) {
      Errors.throwUserInput(`No Tao project root was found from ${target}. Add a project block or pass its directory.`)
    }
    directory = parent
  }
}

async function readShipProject(
  root: string,
  found: { path: string; project: AST.ProjectDeclaration },
): Promise<ShipProject> {
  const statements = found.project.block.statements
  const id = oneProjectString(statements, 'ProjectId', 'id', found.path)
  const name = oneProjectString(statements, 'ProjectName', 'name', found.path)
  const version = oneProjectString(statements, 'ProjectVersion', 'version', found.path)
  if (!id || !name || !version) {
    Errors.throwUserInput(
      `Project metadata in ${found.path} must declare id, name, and version before it can ship.`,
    )
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) {
    Errors.throwUserInput(`Project version '${version}' in ${found.path} must be numeric SemVer such as "1.2.3".`)
  }
  const defaultApp = statements.find(AST.isProjectDefaultApp)?.app.$refText
  const apps: ShipProjectApp[] = []
  const workspace = await Workspace.open(root)
  for (const path of await Repo.filesUnder(root, { extensions: ['.tao'] })) {
    if (path.endsWith('.test.tao')) {
      continue
    }
    const parsed = await workspace.parse(path)
    for (const declaration of AST.appValueDeclarationsInFile(parsed.entry.ast)) {
      const declarationSource = declaration.$cstNode?.text ?? ''
      const bindings = resolvedAppDatasources(declaration)
      const icloud = deriveICloudBinding(bindings)
      apps.push({
        baseAppName: directAppBaseName(declarationSource),
        displayName: authoredAppName(declarationSource) ?? declaration.name,
        hasLocalDatasourceEndpoint: bindings.some(hasLocalInstantEndpoint),
        ...(icloud === undefined ? {} : { icloud }),
        isVariant: AST.isAliasDeclaration(declaration)
          || (AST.isAppDeclaration(declaration) && declaration.value !== undefined),
        name: declaration.name,
        releaseDatasourceConfiguration: deriveHostedDatasourceConfiguration(declaration.name, bindings),
        sourcePath: path,
        usesDevDatasource: bindings.some(binding => mountsProvider(binding, 'Dev')),
      })
    }
  }
  const unique = new Map(apps.map(app => [app.name, app]))
  const uniqueApps = [...unique.values()].toSorted((left, right) => left.name.localeCompare(right.name))
  const defaultDefinition = unique.get(defaultApp ?? '')
  const primaryAppName = defaultDefinition?.baseAppName
    ?? (defaultDefinition?.isVariant === false ? defaultDefinition.name : undefined)
    ?? uniqueApps.find(app => !app.isVariant)?.name
  if (!primaryAppName) {
    Errors.throwUserInput(`No primary Tao app declaration was found in ${root}.`)
  }
  return {
    apps: uniqueApps,
    defaultApp,
    id,
    name,
    primaryAppName,
    projectSourcePath: found.path,
    root,
    version: version as ShipVersion,
  }
}

function authoredAppName(source: string): string | undefined {
  return /\bName\s+"([^"]+)"/u.exec(source)?.[1]
}

function directAppBaseName(source: string): string | undefined {
  return /^\s*app\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s+with\b/u.exec(source)?.[1]
}

/**
 * resolvedAppDatasources reads every datasource an app mounts, following variants, named
 * declarations, reusable types, and patches to the provider each one actually is. Which provider an
 * app mounts decides its entitlements, its manifest, and whether it may ship at all, so it is read
 * from the resolved binding rather than from the shape of the source text.
 */
function resolvedAppDatasources(app: AST.AppValueDeclaration): readonly ASTUtils.ResolvedDatasource[] {
  return ASTUtils.appBoundDatasources(app).flatMap(binding => {
    // A slot supplying a value resolves that value; a reference block names declarations, and each
    // declaration's own value is what it stands for.
    const value = binding.value ?? binding.declaration?.value
    return value && !AST.isAppView(value) ? [ASTUtils.resolveDatasourceValue(value, binding.patches)] : []
  })
}

function mountsProvider(datasource: ASTUtils.ResolvedDatasource, typeName: string): boolean {
  return datasource.typeNames.includes(typeName)
}

function hasLocalInstantEndpoint(datasource: ASTUtils.ResolvedDatasource): boolean {
  if (!mountsProvider(datasource, 'InstantDB')) {
    return false
  }
  return ['ApiURI', 'WebsocketURI'].some(name => {
    const value = datasource.configuration.get(name)
    return value !== undefined && /^(?:https?|wss?):\/\/localhost(?::\d+)?/u.test(value)
  })
}

/** deriveHostedDatasourceConfiguration keeps a local InstantDB declaration intact while deriving its ship patch. */
export function deriveHostedDatasourceConfiguration(
  appName: string,
  datasources: readonly ASTUtils.ResolvedDatasource[],
): Readonly<Record<string, string>> | undefined {
  const local = datasources.filter(hasLocalInstantEndpoint)
  if (local.length === 0) {
    return undefined
  }
  const appIds = [
    ...new Set(local.flatMap(datasource => {
      const appId = datasource.configuration.get('AppId')
      return appId === undefined ? [] : [appId]
    })),
  ]
  if (appIds.length !== 1) {
    Errors.throwUserInput(
      `App '${appName}' uses a local InstantDB endpoint, but Tao could not derive one hosted AppId from its source.`,
    )
  }
  return {
    ApiURI: 'https://api.instantdb.com',
    AppId: appIds[0]!,
    WebsocketURI: 'wss://api.instantdb.com/runtime/session',
  }
}

/**
 * deriveICloudBinding reports whether an app mounts one of the Apple datasources, with the explicit
 * `Container` that binding settles on and the iCloud service the provider needs. The ship pipeline
 * turns it into the binary's iCloud entitlements, defaulting the container to the bundle identifier.
 */
export function deriveICloudBinding(
  datasources: readonly ASTUtils.ResolvedDatasource[],
): ShipICloudBinding | undefined {
  const serviceBindings: ShipICloudBinding['serviceBindings'][number][] = []
  for (const provider of appleDatasourceProviders) {
    const containers = new Set<string>()
    let usesDefaultContainer = false
    const mounted = datasources.filter(datasource => mountsProvider(datasource, provider.typeName))
    for (const bound of mounted) {
      const container = bound.configuration.get('Container')
      if (container === undefined) {
        usesDefaultContainer = true
      } else {
        containers.add(container)
      }
    }
    if (mounted.length > 0) {
      serviceBindings.push({
        containers: [...containers].toSorted(),
        service: provider.service,
        usesDefaultContainer,
      })
    }
  }
  return serviceBindings.length === 0
    ? undefined
    : { serviceBindings: serviceBindings.toSorted((left, right) => left.service.localeCompare(right.service)) }
}

function oneProjectString(
  statements: readonly AST.ProjectStatement[],
  type: string,
  label: string,
  path: string,
): string | undefined {
  const matches = statements.filter(statement => statement.$type === type) as Array<{ value?: string }>
  if (matches.length > 1) {
    Errors.throwUserInput(`Project metadata in ${path} declares ${label} more than once.`)
  }
  return matches[0]?.value
}

export function selectShipApp(project: ShipProject, requested?: string): ShipProjectApp | undefined {
  const selected = requested ?? project.defaultApp
  if (selected === undefined) {
    return undefined
  }
  const app = project.apps.find(candidate => candidate.name === selected)
  if (!app) {
    Errors.throwUserInput(
      `No runnable Tao app named '${selected}' was found. Available apps: ${
        project.apps.map(item => item.name).join(', ')
      }.`,
    )
  }
  return app
}

/** writeProjectVersion updates only the authored project version then restores canonical formatting. */
export async function writeProjectVersion(project: ShipProject, version: ShipVersion): Promise<void> {
  const source = await FS.readText(project.projectSourcePath)
  const parsed = await Parser.parseCode(source, { validation: false })
  const declaration = parsed.entry.ast.statements.find(AST.isProjectDeclaration)
  if (!declaration) {
    Errors.throwUnexpected(`Project declaration disappeared from ${project.projectSourcePath}.`)
  }
  const versionNode = declaration.block.statements.find(AST.isProjectVersion)
  const cst = versionNode?.$cstNode
  if (!cst) {
    Errors.throwUnexpected(`Project version in ${project.projectSourcePath} has no source location.`)
  }
  const replaced = `${source.slice(0, cst.offset)}version ${JSON.stringify(version)}${source.slice(cst.end)}`
  const temporary = `${project.projectSourcePath}.${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.tmp`
  try {
    await FS.writeText(temporary, await Formatter.formatCode(replaced))
    await FS.move(temporary, project.projectSourcePath)
  } finally {
    await FS.remove(temporary).catch(() => {})
  }
}

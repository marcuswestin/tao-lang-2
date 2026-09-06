import Formatter from '@formatter'
import { AST, Langium, Parser } from '@parser'
import { Errors, FS, Repo } from '@shared'
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
}

export type ShipICloudBinding = {
  container?: string
  /** services names the iCloud service the bound provider needs entitled. */
  services: readonly ShipICloudService[]
}

type ShipICloudService = 'CloudDocuments' | 'CloudKit'

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
    const source = await FS.readText(path)
    for (const declaration of AST.appValueDeclarationsInFile(parsed.entry.ast)) {
      const declarationSource = declaration.$cstNode?.text ?? ''
      const releaseDatasourceConfiguration = deriveHostedDatasourceConfiguration(declaration.name, source)
      const icloud = deriveICloudBinding(declarationSource, source)
      apps.push({
        baseAppName: directAppBaseName(declarationSource),
        displayName: authoredAppName(declarationSource) ?? declaration.name,
        hasLocalDatasourceEndpoint: declaration.name.toLowerCase().includes('instantdb')
          && /(?:ApiURI|WebsocketURI)\s+"(?:https?|wss?):\/\/localhost(?::\d+)?/u.test(source),
        ...(icloud === undefined ? {} : { icloud }),
        isVariant: AST.isAliasDeclaration(declaration)
          || (AST.isAppDeclaration(declaration) && declaration.value !== undefined),
        name: declaration.name,
        releaseDatasourceConfiguration,
        sourcePath: path,
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

/** deriveHostedDatasourceConfiguration keeps a local InstantDB declaration intact while deriving its ship patch. */
export function deriveHostedDatasourceConfiguration(
  appName: string,
  source: string,
): Readonly<Record<string, string>> | undefined {
  if (!appName.toLowerCase().includes('instantdb')) {
    return undefined
  }
  const localEndpoint = /(?:ApiURI|WebsocketURI)\s+"(?:https?|wss?):\/\/localhost(?::\d+)?/u.test(source)
  if (!localEndpoint) {
    return undefined
  }
  const appIds = [...source.matchAll(/\bAppId\s+"([^"]+)"/gu)].map(match => match[1]!).filter(Boolean)
  const uniqueAppIds = [...new Set(appIds)]
  if (uniqueAppIds.length !== 1) {
    Errors.throwUserInput(
      `App '${appName}' uses a local InstantDB endpoint, but Tao could not derive one hosted AppId from its source.`,
    )
  }
  return {
    ApiURI: 'https://api.instantdb.com',
    AppId: uniqueAppIds[0]!,
    WebsocketURI: 'wss://api.instantdb.com/runtime/session',
  }
}

/**
 * deriveICloudBinding reports whether an app declaration mounts one of the Apple datasources —
 * directly, through a named `datasource X = ICloud { … }` or a `type X is CloudKit with { … }`,
 * through a `Datasource with { … }` patch of its base, or by inheriting its direct base app's
 * binding — with the explicit `Container` that datasource declares, if any, and the iCloud
 * service the provider needs. The ship pipeline turns the binding into the binary's iCloud
 * entitlements, defaulting the container to the bundle identifier.
 */
export function deriveICloudBinding(
  declarationSource: string,
  source: string,
): ShipICloudBinding | undefined {
  const file = withoutLineComments(source)
  const own = withoutLineComments(declarationSource)
  for (const provider of appleDatasourceProviders) {
    if (!new RegExp(`\\bfrom\\s+@tao/data/providers/${provider.importPath}\\b`, 'u').test(file)) {
      continue
    }
    const binding = providerBinding(provider.typeName, own, file)
    if (binding !== undefined) {
      return { ...binding, services: [provider.service] }
    }
  }
  return undefined
}

function providerBinding(
  typeName: string,
  declarationSource: string,
  file: string,
): { container?: string } | undefined {
  // Every spelling that binds the provider by name: a configured `datasource X = T { … }` (with or
  // without `with`), and a reusable `type X is T with { … }` an app then constructs.
  const namedBindings = new Map<string, string>()
  for (
    const match of file.matchAll(
      new RegExp(
        `\\b(?:datasource\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*=|type\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+is)\\s*${typeName}\\s*(?:with\\s*)?\\{([^}]*)\\}`,
        'gu',
      ),
    )
  ) {
    namedBindings.set(match[1] ?? match[2]!, match[3]!)
  }
  const bindingOf = (appSource: string): { container?: string } | undefined => {
    const inline = new RegExp(`\\bDatasource\\s+${typeName}\\s*(?:with\\s*)?\\{([^}]*)\\}`, 'u').exec(appSource)
    if (inline) {
      return { ...containerOf(inline[1]!) }
    }
    const named = /\bDatasource\s+([A-Za-z_][A-Za-z0-9_]*)\b(?:\s*(?:with\s*)?\{([^}]*)\})?/u.exec(appSource)
    if (named === null) {
      return undefined
    }
    const [, name, patch] = named
    if (name === 'with') {
      // `Datasource with { … }` patches the base app's datasource; the base decides the provider
      // and the patch may override the container.
      const inherited = fromBase(appSource)
      return inherited === undefined ? undefined : { ...inherited, ...containerOf(patch ?? '') }
    }
    const declared = namedBindings.get(name!)
    if (declared === undefined) {
      return undefined
    }
    return { ...containerOf(declared), ...containerOf(patch ?? '') }
  }
  const fromBase = (appSource: string): { container?: string } | undefined => {
    const baseName = directAppBaseName(appSource)
    if (baseName === undefined) {
      return undefined
    }
    const base = appDeclarationText(file, baseName)
    return base === undefined ? undefined : bindingOf(base)
  }
  return /\bDatasource\b/u.test(declarationSource) ? bindingOf(declarationSource) : fromBase(declarationSource)
}

/**
 * withoutLineComments drops `//` comments so a commented-out binding never ships an entitlement.
 * A comment starts at a line start or after whitespace, which leaves the `//` inside a URL alone.
 */
function withoutLineComments(source: string): string {
  return source.replace(/(^|\s)\/\/[^\n]*/gu, '$1')
}

/** appDeclarationText finds a direct app declaration's text, whether it closes on its line or later. */
function appDeclarationText(source: string, name: string): string | undefined {
  const opening = new RegExp(`^[ \\t]*app\\s+${name}\\s*\\{.*$`, 'mu').exec(source)
  if (opening === null) {
    return undefined
  }
  if (opening[0].trimEnd().endsWith('}')) {
    return opening[0]
  }
  const closing = /^\}/mu.exec(source.slice(opening.index + opening[0].length))
  return closing === null
    ? undefined
    : source.slice(opening.index, opening.index + opening[0].length + closing.index + 1)
}

function containerOf(block: string): { container?: string } {
  const container = /\bContainer\s+"([^"]+)"/u.exec(block)?.[1]
  return container === undefined ? {} : { container }
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
  await FS.writeText(project.projectSourcePath, await Formatter.formatCode(replaced))
}

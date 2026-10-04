import { ASTUtils, Packages } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import Formatter from '@formatter'
import { AST, Parser } from '@parser'
import { ProjectTooling } from '@project-tooling'
import { Errors, FS, Platform, Repo } from '@shared'
import { TaoAppModules } from './app-modules'
import { findTaoProjectSource } from './project-root'
import type { ShipVersion } from './ship-model'

export type ShipProjectApp = {
  id: string
  version: ShipVersion
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

type ShipICloudBinding = {
  /** serviceBindings preserves which containers each mounted Apple provider actually uses. */
  serviceBindings: ReadonlyArray<{
    /** containers lists every explicit container mounted for this service. */
    containers: readonly string[]
    service: ShipICloudService
    /** usesDefaultContainer records a binding that defaults to the app bundle container. */
    usesDefaultContainer: boolean
  }>
}

type ShipICloudService = 'CloudDocuments' | 'CloudKit'

/** The Apple datasource providers, each with the iCloud service its entitlement must name. */
const appleDatasourceProviders: ReadonlyArray<{ importPath: string; service: ShipICloudService; typeName: string }> = [
  { importPath: 'icloud', service: 'CloudDocuments', typeName: 'ICloud' },
  { importPath: 'cloudkit', service: 'CloudKit', typeName: 'CloudKit' },
]

export type ShipProject = {
  apps: ShipProjectApp[]
  name: string
  primaryAppName: string
  root: string
}

/** Discover runnable apps in the nearest marked project after a fresh disk check. */
export async function discoverShipProject(targetPath: string): Promise<ShipProject> {
  const found = await findTaoProjectSource(targetPath)
  const refreshed = await ProjectTooling.refresh(found.root, { runtimeRoot: TaoAppModules.runtimeRoot() })
  if (refreshed.status !== 'fresh') {
    Errors.throwUserInput(
      refreshed.diagnostics.map(item => item.message).join('\n') || 'Tao project is not ready to ship.',
    )
  }
  return await readShipProject(found.root)
}

async function readShipProject(root: string): Promise<ShipProject> {
  const apps: ShipProjectApp[] = []
  const workspace = await Workspace.open(root)
  for (const path of await Repo.filesUnder(root, { extensions: ['.tao'] })) {
    if (path.endsWith('.test.tao')) {
      continue
    }
    if (await Packages.containingProjectRoot(FS.dirname(path)) !== root) {
      continue
    }
    const parsed = await workspace.parse(path)
    for (const declaration of AST.appValueDeclarationsInFile(parsed.entry.ast)) {
      const declarationSource = declaration.$cstNode?.text ?? ''
      const bindings = resolvedAppDatasources(declaration)
      const icloud = deriveICloudBinding(bindings)
      const configuration = ASTUtils.effectiveAppConfiguration(declaration)
      const requiredText = (field: 'id' | 'version' | 'name'): string => {
        const value = configuration.get(field)?.value
        if (value === undefined || !AST.isStringLiteral(value)) {
          Errors.throwUserInput(`App '${declaration.name}' in ${path} requires literal ${field} before shipping.`)
        }
        return value.value
      }
      apps.push({
        id: requiredText('id'),
        version: requiredText('version') as ShipVersion,
        baseAppName: directAppBaseName(declarationSource),
        displayName: requiredText('name'),
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
  const duplicates = apps.filter((app, index) => apps.findIndex(candidate => candidate.name === app.name) !== index)
  if (duplicates.length > 0) {
    const names = [...new Set(duplicates.map(app => app.name))]
    Errors.throwUserInput(`Tao app names must be unique within a ship project: ${names.join(', ')}.`)
  }
  const unique = new Map(apps.map(app => [app.name, app]))
  const uniqueApps = [...unique.values()].toSorted((left, right) => left.name.localeCompare(right.name))
  const primaryAppName = uniqueApps.find(app => !app.isVariant)?.name ?? uniqueApps[0]?.name
  if (!primaryAppName) {
    Errors.throwUserInput(`No primary Tao app declaration was found in ${root}.`)
  }
  return {
    apps: uniqueApps,
    name: FS.basename(root),
    primaryAppName,
    root,
  }
}

function directAppBaseName(source: string): string | undefined {
  return /^\s*(?:(?:file|folder|package|workspace|public)\s+)?app\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s+with\b/u
    .exec(source)?.[1]
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
function deriveHostedDatasourceConfiguration(
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
function deriveICloudBinding(
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

export function selectShipApp(project: ShipProject, requested?: string): ShipProjectApp | undefined {
  const selected = requested ?? (project.apps.length === 1 ? project.apps[0]?.name : undefined)
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

/** Update the selected app's own version, inserting an override for an inherited version. */
export async function writeProjectVersion(app: ShipProjectApp, version: ShipVersion): Promise<void> {
  const source = await FS.readText(app.sourcePath)
  const parsed = await Parser.parseCode(source, { validation: false })
  const declaration = AST.appValueDeclarationsInFile(parsed.entry.ast).find(candidate => candidate.name === app.name)
  if (!declaration) {
    Errors.throwUnexpected(`App '${app.name}' disappeared from ${app.sourcePath}.`)
  }
  const directProperty = AST.isAppDeclaration(declaration)
    ? AST.blockStatements(declaration).filter(AST.isAppProperty).find(property => property.name === 'version')
    : undefined
  const refinement = declaration.value && AST.isRefinementExpression(declaration.value)
    ? declaration.value
    : undefined
  const directEntry = refinement?.patchBlock.entries.find(entry => entry.name === 'version')
  const ownNode = directProperty?.value ?? directEntry?.value
  let replaced: string
  if (ownNode?.$cstNode) {
    const cst = ownNode.$cstNode
    replaced = `${source.slice(0, cst.offset)}${JSON.stringify(version)}${source.slice(cst.end)}`
  } else {
    const block = refinement?.patchBlock.$cstNode
      ?? (AST.isAppDeclaration(declaration) ? declaration.block?.$cstNode : undefined)
    if (!block) {
      Errors.throwUnexpected(`App '${app.name}' in ${app.sourcePath} has no editable configuration block.`)
    }
    const close = source.lastIndexOf('}', block.end - 1)
    if (close < block.offset) {
      Errors.throwUnexpected(`App '${app.name}' in ${app.sourcePath} has no closing brace.`)
    }
    replaced = `${source.slice(0, close)}\n   version ${JSON.stringify(version)}\n${source.slice(close)}`
  }
  const temporary = `${app.sourcePath}.${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.tmp`
  try {
    await FS.writeText(temporary, await Formatter.formatCode(replaced))
    await FS.move(temporary, app.sourcePath)
  } finally {
    await FS.remove(temporary).catch(() => {})
  }
}

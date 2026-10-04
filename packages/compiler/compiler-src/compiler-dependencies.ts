import { AST, type ProjectGraph, type ProjectPublication, type ProjectRequirement } from '@parser'
import { Assert, type Diagnostic, type DiagnosticRange, FS } from '@shared'
import { BridgeMetadata } from './bridge-metadata'
import { nonliteralSidecarImports, sidecarModuleSpecifiers } from './sidecar-module-specifiers'

export type DependencyEnvironment = Readonly<{
  projectRoot: string
  namespace: string
  npm: readonly Readonly<{ alias: string; packageName: string; versionRange: string }>[]
  publications: readonly Readonly<{ name?: string; version: string }>[]
}>

export type DependencySelection =
  | Readonly<{ kind: 'project' }>
  | Readonly<{ kind: 'app'; app: AST.AppValueDeclaration }>
  | Readonly<{ kind: 'publication'; publication: ProjectPublication }>

export type SidecarImport = Readonly<{
  sourcePath: string
  specifier: string
  kind: 'relative' | 'bare'
  form: 'static' | 'dynamic' | 'reexport' | 'require'
  range: DiagnosticRange
}>

export type UnresolvedSidecarImport = Readonly<{
  sourcePath: string
  form: 'dynamic' | 'require'
  range: DiagnosticRange
}>

type SidecarImportRequest = Readonly<{ sourcePath: string; sourceText: string }>

export type TaoSidecarEdge = Readonly<{
  sourcePath: string
  targetPath: string
  typeNames: readonly string[]
  valueNames: readonly string[]
  runtimeNamespace: boolean
}>

type ValidateSidecarImportsRequest =
  & SidecarImportRequest
  & Readonly<{
    requirements: readonly ProjectRequirement[]
    ownerLabel: string
    /** Host-owned runtime packages already available to every sidecar. */
    allowedHostImports?: readonly string[]
  }>

const builtInHostImports = ['react', 'react-native', 'expo', '@tao/runtime'] as const

/** Pure dependency planning and sidecar import checks shared by compilation and project tooling. */
export const CompilerDependencies = {
  /** Relative Tao module edges in one authored sidecar, with type and runtime binding intent. */
  taoSidecarEdges({ sourcePath, sourceText }: SidecarImportRequest): readonly TaoSidecarEdge[] {
    return sidecarModuleSpecifiers(sourceText, sourcePath)
      .filter(specifier => specifier.value.endsWith('.tao'))
      .filter(specifier => specifier.value.startsWith('./') || specifier.value.startsWith('../'))
      .map(specifier => ({
        sourcePath,
        targetPath: FS.resolvePath(specifier.value, FS.dirname(sourcePath)),
        typeNames: specifier.typeNames,
        valueNames: specifier.valueNames,
        runtimeNamespace: specifier.runtimeNamespace,
      }))
  },

  /** The finite Tao runtime bindings a sidecar edge can name from one source file. */
  taoSidecarValueDeclarations(
    file: AST.TaoFile,
    edge: Pick<TaoSidecarEdge, 'valueNames' | 'runtimeNamespace'>,
  ): readonly AST.Declaration[] {
    return file.statements.filter(AST.isDeclaration).filter(declaration =>
      AST.isEmittingRuntimeBinding(declaration)
      && !AST.isEntityDataDeclaration(declaration)
      && (!AST.isTypeDeclaration(declaration) || AST.isCaseSetTypeExpression(declaration.type))
      && (edge.valueNames.includes(declaration.name)
        || (edge.runtimeNamespace && AST.isTypeDeclaration(declaration)
          && AST.isCaseSetTypeExpression(declaration.type)))
    )
  },
  collect(graph: ProjectGraph, selection: DependencySelection): readonly DependencyEnvironment[] {
    const environments = new Map<string, {
      npm: Map<string, { alias: string; packageName: string; versionRange: string }>
      publications: Map<AST.PackageDeclaration, { name?: string; version: string }>
    }>()
    const environment = (projectRoot: string) => {
      const root = FS.resolvePath(projectRoot)
      let current = environments.get(root)
      if (current === undefined) {
        current = { npm: new Map(), publications: new Map() }
        environments.set(root, current)
      }
      return current
    }
    environment(graph.projectRoot)
    const visited = new Set<AST.PackageDeclaration>()
    const visitPublication = (publication: ProjectPublication): void => {
      const projectRoot = FS.dirname(AST.getDocument(publication.declaration).uri.path)
      if (publication.version !== undefined) {
        environment(projectRoot).publications.set(publication.declaration, {
          ...(publication.name === undefined ? {} : { name: publication.name }),
          version: publication.version,
        })
      }
      if (visited.has(publication.declaration)) {
        return
      }
      visited.add(publication.declaration)
      publication.requirements.forEach(visitRequirement)
    }
    const visitRequirement = (requirement: ProjectRequirement): void => {
      const declaration = requirement.declaration
      if (declaration.ts && declaration.npm) {
        const packageName = declaration.npm.replace(/^npm:/, '')
        const alias = declaration.alias ?? packageName
        const npm = environment(requirement.sourceRoot).npm
        const previous = npm.get(alias)
        Assert(
          previous === undefined || (previous.packageName === packageName
            && previous.versionRange === requirement.versionRange),
          'validated project dependency alias has one package and version range',
          { alias, projectRoot: requirement.sourceRoot },
        )
        npm.set(alias, { alias, packageName, versionRange: requirement.versionRange })
      }
      if (requirement.selectedPublication !== undefined) {
        visitPublication(requirement.selectedPublication)
      }
    }
    if (selection.kind === 'app') {
      graph.appRequirements.find(entry => entry.app === selection.app)?.requirements.forEach(visitRequirement)
    } else if (selection.kind === 'publication') {
      visitPublication(selection.publication)
    } else {
      graph.requirements.forEach(visitRequirement)
      graph.publications.filter(publication =>
        FS.dirname(AST.getDocument(publication.declaration).uri.path) === graph.projectRoot
      ).forEach(visitPublication)
    }
    return [...environments].map(([projectRoot, entry]) => ({
      projectRoot,
      namespace: BridgeMetadata.dependencyNamespace(projectRoot),
      npm: [...entry.npm.values()],
      publications: [...entry.publications.values()],
    }))
  },

  /** Returns every source import with an exact zero-based source range; callers follow relative edges. */
  sidecarImports({ sourcePath, sourceText }: SidecarImportRequest): readonly SidecarImport[] {
    return sidecarModuleSpecifiers(sourceText, sourcePath).map(specifier => ({
      sourcePath,
      specifier: specifier.value,
      form: specifier.form,
      kind: specifier.value.startsWith('./') || specifier.value.startsWith('../')
        ? 'relative' as const
        : 'bare' as const,
      range: sidecarRange(sourceText, specifier.start, specifier.end),
    }))
  },

  /** Computed import sites have no statically known dependency or relative-file edge. */
  unresolvedSidecarImports({ sourcePath, sourceText }: SidecarImportRequest): readonly UnresolvedSidecarImport[] {
    return nonliteralSidecarImports(sourceText, sourcePath).map(item => ({
      sourcePath,
      form: item.form,
      range: sidecarRange(sourceText, item.start, item.end),
    }))
  },

  /** Check one publication or app boundary; overlapping publications are checked independently. */
  validateSidecarImports(request: ValidateSidecarImportsRequest): readonly Diagnostic[] {
    const ownerRoot = request.requirements[0]?.sourceRoot
    const declared = new Set<string>()
    const visited = new Set<AST.PackageDeclaration>()
    const visit = (requirement: ProjectRequirement): void => {
      if (requirement.sourceRoot !== ownerRoot) {
        return
      }
      if (requirement.declaration.ts && requirement.declaration.npm) {
        declared.add(requirement.declaration.alias ?? requirement.declaration.npm.replace(/^npm:/, ''))
      }
      const publication = requirement.selectedPublication
      if (publication && !visited.has(publication.declaration)) {
        visited.add(publication.declaration)
        publication.requirements.forEach(visit)
      }
    }
    request.requirements.forEach(visit)
    const hostImports = [...builtInHostImports, ...request.allowedHostImports ?? []]
    const computed: Diagnostic[] = CompilerDependencies.unresolvedSidecarImports(request).map(item => ({
      filePath: request.sourcePath,
      message: `TypeScript ${
        item.form === 'dynamic' ? 'import' : 'require'
      } used by ${request.ownerLabel} needs a literal module path so its dependency can be checked.`,
      severity: 'error',
      source: 'compiler',
      code: 'computed-sidecar-import',
      range: item.range,
    }))
    const undeclared = CompilerDependencies.sidecarImports(request).flatMap(item => {
      if (
        item.kind === 'relative'
        || packageSpecifierMatches(item.specifier, declared)
        || packageSpecifierMatches(item.specifier, hostImports)
      ) {
        return []
      }
      return [{
        filePath: request.sourcePath,
        message:
          `TypeScript import '${item.specifier}' used by ${request.ownerLabel} requires a declared npm dependency.`,
        severity: 'error' as const,
        source: 'compiler' as const,
        code: 'undeclared-npm-import',
        range: item.range,
      }]
    })
    return [...computed, ...undeclared]
  },
} as const

function packageSpecifierMatches(specifier: string, packages: ReadonlySet<string> | readonly string[]): boolean {
  for (const packageName of packages) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      return true
    }
  }
  return false
}

function sidecarRange(source: string, start: number, end: number): DiagnosticRange {
  const position = (offset: number) => {
    const lines = source.slice(0, offset).split('\n')
    return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 }
  }
  return { start: position(start), end: position(end) }
}

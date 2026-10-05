import { ASTUtils, Packages, Type } from '@ast-utils'
import { AST, codeProjectRoot, type ParsedFile, type ProjectGraph } from '@parser'
import { Assert, Errors, FS, Platform, ProjectIdentity, Time } from '@shared'
import type { ValidationResult } from '@validator'
import { appMetadata } from '../../app-metadata'
import { authPolicy } from '../../auth-policy'
import {
  BridgeMetadata,
  type BridgeTypeOriginResolver,
  type QuantityCanonicalLeaf,
  type QuantityPublicationModule,
} from '../../bridge-metadata'
import { CompilerDependencies } from '../../compiler-dependencies'
import { rewriteQuantityNativeImports } from '../../quantity-native-imports'
import { sidecarModuleSpecifiers } from '../../sidecar-module-specifiers'
import {
  inspectSidecarSourceGraph,
  relativeSidecarCandidates,
  sidecarSourceBelongsToProject,
} from '../../sidecar-source-graph'
import { storedDataSchemaFile, storedDataSchemas } from '../../stored-data-schema'
import {
  compileStudioPreviewManifest,
  studioPreviewManifestModule,
} from '../../studio-preview-manifest'
import { withActionInstrumentation } from './app/action-control-flow'
import { withActionResultBridgeTypes } from './app/action-result-bridge-types'
import {
  associatedOperatorWitnessKeys,
  associatedWitnessExports,
  planAssociatedWitnessBindings,
  referencedAssociatedWitnessOwners,
} from './app/associated-witness-plan'
import { hasAssociatedWitnessPublication, withAssociatedWitnessBindings } from './app/AssociatedMethodsCompiler'
import {
  configurationAliasTargetTypeBindingName,
  configurationRuntimeBindingName,
  configurationSidecarBindingName,
  isRuntimeConfigurableDeclaration,
  isTransparentConfigurableAlias,
} from './app/ConfigurationCompiler'
import { withDataStorePlan } from './app/data-store-context'
import {
  type DeclarationIdentityProject,
  withDeclarationIdentityContext,
} from './app/declaration-identity'
import {
  bridgeBindingName,
  bridgeExportName,
  foreignActionBindingName,
  foreignActionExportName,
  foreignViewBindingName,
  type InlineInjection,
  withInlineInjectionBindings,
} from './app/injection-plan'
import { withQuantityFactoryBindings } from './app/NumericUnitsCompiler'
import { RuntimeGen } from './app/RuntimeGen'
import { LocalDataBindings, withImportedDeclarationBindings } from './codegen-util'

import type { CompiledFile, CompileOptions, CompilerContext, CompileResult } from '../../compiler'
import type { Backend } from '../Backend'

const compiledSourceOutputPathMessage = 'compiled source output path exists'
// `local only` entities live in a second emitted catalog with its own connection and storage key.
// The compiler binds it to the stdlib Local provider, which the source never names, so the owner
// module imports that provider as a sidecar exactly as a declared datasource would.
const localProviderStdlibPath = '@tao/data/providers/local/Local.ts'
const localProviderExportName = 'LocalProvider'
/** The companion catalog's bindings travel together: its schema and the datasource an app mounts. */
const localCatalogBindings = [LocalDataBindings.catalog, LocalDataBindings.datasource] as const

type ResolvedImports = {
  bySource: Map<string, Set<string>>
  scopeBindings: Map<string, string>
  declarationBindings: Map<AST.Declaration, string>
}

type DataCatalogPlan = {
  entities: readonly AST.EntityDataDeclaration[]
  access: readonly AST.AccessDeclaration[]
  /** localOnly is whether any entity carries the `local only` storage fact, which adds a catalog. */
  localOnly: boolean
  /** localUserPaths are the files that reference the companion catalog's bindings. */
  localUserPaths: ReadonlySet<string>
  ownerPath: string
  /** stores is the project's partition: one emitted schema per store the datasources declare. */
  stores: ASTUtils.DataStorePlan
  userPaths: ReadonlySet<string>
}

type PlannedSidecarCopy = {
  sourcePath: string
  relativePath: string
}

type PlannedSidecar = PlannedSidecarCopy & {
  binding: string
  exportName: string
}

type PlannedSourceOutputs = {
  injections: PlannedInjection[]
  modulePath: string
  declarationsPath?: string
  sidecars: PlannedSidecar[]
  sidecarCopies: PlannedSidecarCopy[]
  quantityPath?: string
  quantityModule?: QuantityPublicationModule
}

type PlannedInjection = {
  binding: string
  node: InlineInjection
  relativePath: string
}

type PlannedOutputs = {
  bySourcePath: ReadonlyMap<string, PlannedSourceOutputs>
  modulePathBySourcePath: ReadonlyMap<string, string>
  canonicalQuantities: ReadonlyMap<AST.TypeDeclaration, QuantityCanonicalLeaf>
  sidecarPathBySourcePath: ReadonlyMap<string, string>
}

/** ReactNativeBackend owns TypeScript planning and Expo-compatible output. */
export const ReactNativeBackend: Backend = {
  compile: ({ validation, context, app, appPath, options }) =>
    compileReactNative(validation, context, app, appPath, options),
}

function compileReactNative(
  validationResult: ValidationResult,
  context: CompilerContext,
  selectedApp: AST.AppValueDeclaration,
  selectedAppPath: string,
  options: CompileOptions,
): CompileResult {
  const studio = options.studio === true
  const journeyObservations = options.journeyObservations === true
  const selectedAppName = selectedApp.name
  const entryPath = validationResult.entry.path
  const graph = Packages.createResolver(context.packagesContext).projectGraph({
    fromFilePath: selectedAppPath,
    workspaceFiles: validationResult.files.map(file => file.ast),
  })
  const selectedRequirements = graph.appRequirements.find(entry => entry.app === selectedApp)?.requirements ?? []
  const selectedPublications = selectedPublicationSources(selectedRequirements)
  const dependencyOwnerBySourcePath = new Map(selectedPublications.projectRootBySourcePath)
  const sidecarTaoSources = selectedSidecarTaoSources(
    selectedPublications,
    validationResult.files,
    context.packagesContext.index,
  )
  for (const [path, owner] of sidecarTaoSources.projectRootBySourcePath) {
    dependencyOwnerBySourcePath.set(path, owner)
  }
  const retainedDependencyDeclarations = new Set(
    [...selectedPublications.declarationsBySourcePath.values()].flatMap(declarations => [...declarations]),
  )
  for (const declarations of sidecarTaoSources.runtimeDeclarationsBySourcePath.values()) {
    declarations.forEach(declaration => retainedDependencyDeclarations.add(declaration))
  }
  const accessBySourcePath = new Map<string, Set<AST.AccessDeclaration>>()
  for (const file of validationResult.files) {
    for (const access of file.ast.statements.filter(AST.isAccessDeclaration)) {
      const entity = access.entity.ref
      if (!entity || !retainedDependencyDeclarations.has(entity)) {
        continue
      }
      const entityPath = AST.getDocument(entity).uri.path
      const owner = dependencyOwnerBySourcePath.get(entityPath)
      if (!owner || !FS.pathIsWithin(file.path, owner)) {
        continue
      }
      const statements = accessBySourcePath.get(file.path) ?? new Set<AST.AccessDeclaration>()
      statements.add(access)
      accessBySourcePath.set(file.path, statements)
      dependencyOwnerBySourcePath.set(file.path, owner)
    }
  }
  const selectedSources = new Set([
    selectedAppPath,
    ...graph.projectFiles.map(file => AST.getDocument(file).uri.path),
    ...selectedPublications.sourcePaths,
    ...sidecarTaoSources.projectRootBySourcePath.keys(),
    ...accessBySourcePath.keys(),
    ...(studio
      ? validationResult.files
        .filter(file => file.path.endsWith('.test.tao') && FS.pathIsWithin(file.path, graph.projectRoot))
        .map(file => file.path)
      : []),
  ])
  // Private/type-only quantity owners still need their singleton leaf, independently of runtime selection.
  const availableSources = new Map(validationResult.files.map(file => [file.path, file]))
  const quantityOnlyDeclarations = new Map<string, Set<AST.TypeDeclaration>>()
  const quantitySources = [...selectedSources]
  for (let index = 0; index < quantitySources.length; index++) {
    const file = availableSources.get(quantitySources[index]!)
    if (file === undefined) {
      continue
    }
    for (const owner of BridgeMetadata.quantityReferencedOwnersOf(file.ast)) {
      const ownerPath = AST.getDocument(owner).uri.path
      if (!selectedSources.has(ownerPath)) {
        selectedSources.add(ownerPath)
        quantitySources.push(ownerPath)
        const projectRoot = Packages.projectRootForPath(context.packagesContext.index, ownerPath)
        if (
          projectRoot !== undefined && projectRoot !== graph.projectRoot
          && !FS.pathIsWithin(ownerPath, context.packagesContext.stdlibRoot)
        ) {
          dependencyOwnerBySourcePath.set(ownerPath, projectRoot)
          quantityOnlyDeclarations.set(ownerPath, new Set())
        }
      }
      quantityOnlyDeclarations.get(ownerPath)?.add(owner)
    }
  }
  const sourceFiles = validationResult.files.filter(file =>
    (selectedSources.has(file.path) || FS.pathIsWithin(file.path, context.packagesContext.stdlibRoot))
    && (sidecarTaoSources.projectRootBySourcePath.has(file.path) || file.ast.statements.length === 0
      || !file.ast.statements.every(statement =>
        (AST.isPrimitiveDeclaration(statement) && !hasAssociatedWitnessPublication(statement))
        || AST.isPackageDeclaration(statement)
      ))
  )
  const identityProjects = declarationIdentityProjects(
    sourceFiles,
    context,
    graph,
    dependencyOwnerBySourcePath,
  )
  const sourceByPath = new Map(sourceFiles.map(file => [file.path, file]))
  const operatorWitnessKeys = associatedOperatorWitnessKeys(sourceFiles.map(file => file.ast))
  const selectedStatements = (file: ParsedFile): readonly AST.Statement[] =>
    selectedPublications.declarationsBySourcePath.has(file.path) || accessBySourcePath.has(file.path)
      || sidecarTaoSources.projectRootBySourcePath.has(file.path)
      || quantityOnlyDeclarations.has(file.path)
      ? file.ast.statements.filter(statement =>
        selectedPublications.declarationsBySourcePath.get(file.path)?.has(statement as AST.Declaration)
        || sidecarTaoSources.runtimeDeclarationsBySourcePath.get(file.path)?.has(statement as AST.Declaration)
        || (AST.isAccessDeclaration(statement) && accessBySourcePath.get(file.path)?.has(statement))
        || (AST.isTypeDeclaration(statement) && quantityOnlyDeclarations.get(file.path)?.has(statement))
      )
      : file.ast.statements
  const dataCatalog = planDataCatalog(sourceFiles, entryPath, selectedStatements)
  const studioViews = studio
    ? sourceFiles.flatMap(file =>
      selectedStatements(file).filter(AST.isScenarioGroupDeclaration).flatMap(group =>
        AST.scenarioDeclarations(group).flatMap(scenario => {
          const subject = AST.scenarioSubjectDeclaration(scenario)
          return AST.isViewDeclaration(subject)
            ? [{ id: `${AST.getDocument(subject).uri.fsPath}#${subject.name}`, view: subject }]
            : []
        })
      )
    )
    : []
  const outputPaths = planOutputPaths(sourceFiles, selectedAppPath, context.sourceRoot, {
    projectRoot: graph.projectRoot,
    index: context.packagesContext.index,
    dependencyRootBySourcePath: dependencyOwnerBySourcePath,
    selectedStatements,
    localDataProvider: dataCatalog?.localOnly
      ? {
        ownerPath: dataCatalog.ownerPath,
        sourcePath: FS.resolvePath(localProviderStdlibPath, context.packagesContext.stdlibRoot),
      }
      : undefined,
  })
  const studioSourceEpochs = studio && options.studioSourceEpochs !== undefined
    ? Object.fromEntries([
      ...validationResult.files.map(file => [file.path, 0] as const),
      ...Object.entries(options.studioSourceEpochs).map(([path, epoch]) =>
        [FS.resolvePath(path, context.sourceRoot), epoch] as const
      ),
    ])
    : undefined
  const studioDesignEpochs = studioSourceEpochs === undefined
    ? undefined
    : Object.fromEntries(
      validationResult.files
        .filter(file => file.ast.statements.some(AST.isDesignDeclaration))
        .map(file => [file.path, studioSourceEpochs[file.path] ?? 0]),
    )
  const cacheFiles: NonNullable<CompileResult['emittedModuleCache']>['files'] = []
  let fingerprintContext: EmissionFingerprintContext | undefined
  const compiledFiles = sourceFiles.flatMap(file => {
    const sourceOptions: CompileSourceFileOptions = {
      dataCatalog,
      sourceByPath,
      operatorWitnessKeys,
      selectedStatements: selectedStatements(file),
      selectedStatementsFor: selectedStatements,
      sidecarRuntimeExports: sidecarTaoSources.runtimeExportsBySourcePath.get(file.path),
      outputPaths,
      identityProjects,
      identityOwnerBySourcePath: dependencyOwnerBySourcePath,
      projectRoot: context.sourceRoot,
      nativeBridgeTypeOrigins: context.nativeBridgeTypeOrigins,
      selectedAppDatasourceConfiguration: options.appDatasourceConfiguration,
      selectedAppFirebaseConfiguration: options.appFirebaseConfiguration,
      selectedAppAuthConfiguration: options.appAuthConfiguration,
      selectedAppName: file.path === selectedAppPath ? selectedAppName : undefined,
      journeyObservations,
      studio,
      studioViews,
      studioSourceEpochs,
      studioDesignEpochs,
      debug: options.debug === true,
    }
    const cache = options.emittedModuleCache
    if (cache === undefined) {
      return compileSourceFile(file, sourceOptions)
    }
    const start = Time.nowMs()
    fingerprintContext ??= createEmissionFingerprintContext(sourceOptions, sourceFiles)
    const fingerprint = emissionFingerprint(file, sourceOptions, fingerprintContext)
    const cached = fingerprint === undefined ? undefined : cache.get(file.path, fingerprint)
    if (cached !== undefined) {
      const files = [...cached, ...copySidecars(file.path, outputPaths)]
      cacheFiles.push({ sourcePath: file.path, hit: true, emitMs: 0, totalMs: Time.nowMs() - start })
      return files
    }
    const emitStart = Time.nowMs()
    const emitted = compileSourceFile(file, sourceOptions)
    const emitMs = Time.nowMs() - emitStart
    if (fingerprint !== undefined) {
      const sidecarPaths = new Set(
        outputPaths.bySourcePath.get(file.path)?.sidecarCopies.map(copy => copy.relativePath),
      )
      cache.set(file.path, fingerprint, emitted.filter(output => !sidecarPaths.has(output.relativePath)))
    }
    cacheFiles.push({ sourcePath: file.path, hit: false, emitMs, totalMs: Time.nowMs() - start })
    return emitted
  })

  if (dataCatalog?.access.length) {
    compiledFiles.push({
      relativePath: 'TaoDataPolicy.json',
      sourcePath: entryPath,
      code: JSON.stringify(authPolicy(dataCatalog.entities, dataCatalog.access), null, 2),
    })
  }

  const storedSchemas = dataCatalog === undefined ? undefined : storedDataSchemas(dataCatalog.stores)
  if (storedSchemas !== undefined && Object.keys(storedSchemas.stores).length > 0) {
    compiledFiles.push({
      relativePath: storedDataSchemaFile,
      sourcePath: entryPath,
      code: JSON.stringify(storedSchemas, null, 2),
    })
  }

  const studioManifest = studio
    ? compileStudioPreviewManifest(
      sourceFiles.filter(file => !FS.pathIsWithin(file.path, context.packagesContext.stdlibRoot)),
      selectedAppName,
      context.sourceRoot,
    )
    : undefined
  if (studioManifest !== undefined) {
    compiledFiles.push({
      code: studioPreviewManifestModule(studioManifest),
      relativePath: 'TaoStudioManifest.ts',
      sourcePath: entryPath,
    })
  }

  return {
    ...compileResultForApp(validationResult, compiledFiles, selectedApp, selectedAppPath),
    dependencyEnvironments: CompilerDependencies.collect(graph, { kind: 'app', app: selectedApp }),
    ...(studioManifest === undefined ? {} : { studioManifest }),
    ...(options.emittedModuleCache === undefined ? {} : {
      emittedModuleCache: {
        hits: cacheFiles.filter(file => file.hit).length,
        misses: cacheFiles.filter(file => !file.hit).length,
        files: cacheFiles,
      },
    }),
  }
}

function selectedPublicationSources(requirements: ProjectGraph['requirements']): {
  sourcePaths: readonly string[]
  projectRootBySourcePath: ReadonlyMap<string, string>
  declarationsBySourcePath: ReadonlyMap<string, ReadonlySet<AST.Declaration>>
} {
  const sources = new Set<string>()
  const projectRootBySourcePath = new Map<string, string>()
  const declarationsBySourcePath = new Map<string, Set<AST.Declaration>>()
  const visited = new Set<AST.PackageDeclaration>()
  const visit = (requirement: ProjectGraph['requirements'][number]): void => {
    const publication = requirement.selectedPublication
    if (publication === undefined || visited.has(publication.declaration)) {
      return
    }
    visited.add(publication.declaration)
    const projectRoot = requirement.targetProjectRoot
      ?? FS.dirname(AST.getDocument(publication.declaration).uri.path)
    for (const file of publication.sourceFiles) {
      const path = AST.getDocument(file).uri.path
      sources.add(path)
      projectRootBySourcePath.set(path, projectRoot)
    }
    for (const declaration of publication.sourceDeclarations) {
      const path = AST.getDocument(declaration).uri.path
      const selected = declarationsBySourcePath.get(path) ?? new Set<AST.Declaration>()
      selected.add(declaration)
      declarationsBySourcePath.set(path, selected)
    }
    publication.requirements.forEach(visit)
  }
  requirements.forEach(visit)
  return { sourcePaths: [...sources], projectRootBySourcePath, declarationsBySourcePath }
}

type SelectedSidecarTaoSources = {
  projectRootBySourcePath: ReadonlyMap<string, string>
  runtimeDeclarationsBySourcePath: ReadonlyMap<string, ReadonlySet<AST.Declaration>>
  runtimeExportsBySourcePath: ReadonlyMap<string, ReadonlySet<AST.Declaration>>
}

/** Authored sidecars can name internal Tao types or load exact runtime declarations. */
function selectedSidecarTaoSources(
  selected: ReturnType<typeof selectedPublicationSources>,
  availableFiles: readonly ParsedFile[],
  index: Packages.Index,
): SelectedSidecarTaoSources {
  const available = new Map(availableFiles.map(file => [file.path, file]))
  const allFiles = availableFiles.map(file => file.ast)
  const ownerBySourcePath = new Map(selected.projectRootBySourcePath)
  const projectRootBySourcePath = new Map<string, string>()
  const runtimeDeclarationsBySourcePath = new Map<string, Set<AST.Declaration>>()
  const runtimeExportsBySourcePath = new Map<string, Set<AST.Declaration>>()
  const queue = [...selected.declarationsBySourcePath.values()].flatMap(declarations => [...declarations])
  const visitedDeclarations = new Set<AST.Declaration>()
  const visitedSidecars = new Set<string>()
  while (queue.length > 0) {
    const sourceDeclaration = queue.shift()!
    if (visitedDeclarations.has(sourceDeclaration)) {
      continue
    }
    visitedDeclarations.add(sourceDeclaration)
    const sourcePath = AST.getDocument(sourceDeclaration).uri.path
    const owner = ownerBySourcePath.get(sourcePath)
    if (owner === undefined) {
      continue
    }
    for (const root of BridgeMetadata.implementationSidecarRoots([sourceDeclaration])) {
      const visitKey = `${owner}\0${root}`
      if (visitedSidecars.has(visitKey)) {
        continue
      }
      visitedSidecars.add(visitKey)
      for (const sidecarPath of sidecarSourceGraph(root, owner, index)) {
        if (!FS.existsSync(sidecarPath)) {
          continue
        }
        for (
          const edge of CompilerDependencies.taoSidecarEdges({
            sourcePath: sidecarPath,
            sourceText: FS.readTextSync(sidecarPath),
          })
        ) {
          const target = available.get(edge.targetPath)
          if (!target || Packages.projectRootForPath(index, target.path) !== owner) {
            continue
          }
          projectRootBySourcePath.set(target.path, owner)
          const seeds = CompilerDependencies.taoSidecarValueDeclarations(
            target.ast,
            edge,
            BridgeMetadata.quantitySurfaceFor(target.ast),
          )
          if (seeds.length === 0) {
            continue
          }
          const exports = runtimeExportsBySourcePath.get(target.path) ?? new Set<AST.Declaration>()
          seeds.forEach(declaration => exports.add(declaration))
          runtimeExportsBySourcePath.set(target.path, exports)
          for (
            const declaration of Packages.reachableProjectDeclarations(
              seeds,
              allFiles,
              owner,
              index,
            )
          ) {
            const path = AST.getDocument(declaration).uri.path
            projectRootBySourcePath.set(path, owner)
            ownerBySourcePath.set(path, owner)
            const reached = runtimeDeclarationsBySourcePath.get(path) ?? new Set<AST.Declaration>()
            reached.add(declaration)
            runtimeDeclarationsBySourcePath.set(path, reached)
            queue.push(declaration)
          }
        }
      }
    }
  }
  return { projectRootBySourcePath, runtimeDeclarationsBySourcePath, runtimeExportsBySourcePath }
}

/** PlanOutputPathsOptions carries sidecars the compiler owns rather than a source file naming them. */
type PlanOutputPathsOptions = {
  projectRoot: string
  index: Packages.Index
  dependencyRootBySourcePath: ReadonlyMap<string, string>
  selectedStatements: (file: ParsedFile) => readonly AST.Statement[]
  localDataProvider?: { ownerPath: string; sourcePath: string }
}

function planOutputPaths(
  sourceFiles: readonly ParsedFile[],
  entryPath: string,
  sourceRoot: string,
  options: PlanOutputPathsOptions,
): PlannedOutputs {
  // Basename buckets in moduleOutputPath can collide across distinct sources;
  // suffix deterministically instead of silently overwriting generated files.
  const modulePathBySourcePath = new Map<string, string>()
  const usedOutputPaths = new Set<string>()
  for (const file of sourceFiles) {
    const preferredPath = file.path === entryPath
      ? 'App.tsx'
      : moduleOutputPath(file.path, entryPath, sourceRoot, options)
    modulePathBySourcePath.set(
      file.path,
      reserveModuleOutputPath(file, preferredPath, usedOutputPaths, options.selectedStatements(file)),
    )
  }

  const bySourcePath = new Map<string, PlannedSourceOutputs>()
  // One foreign implementation file is one module, however many Tao files name it. The map spans
  // every file so the second namer imports the first one's copy instead of getting a second copy,
  // whose module-level state would be a separate instance of the same source at runtime.
  const sidecarPathBySourcePath = new Map<string, string>()
  for (const file of sourceFiles) {
    const modulePath = modulePathBySourcePath.get(file.path)
    Assert.defined(modulePath, compiledSourceOutputPathMessage, { sourcePath: file.path })
    const statements = options.selectedStatements(file)
    const nodes = statements.flatMap(statement => [statement, ...AST.streamAllContents(statement)])
    const injections = nodes.filter(AST.isInjection).map((node, index) => ({
      // Bindings are local to this generated module. An inherited implementation may be owned
      // by another Tao file, whose own ordinal must not collide with this file's injections.
      binding: `__tao_injection_${index + 1}__`,
      node,
      relativePath: reserveOutputPath(
        outputPathInDirectory(
          outputDirectory(modulePath),
          `${FS.basename(modulePath, FS.extname(modulePath))}.injection-${index + 1}.tsx`,
        ),
        usedOutputPaths,
      ),
    }))
    // A selected sidecar may import a private type from its owning Tao file even when no Tao
    // declaration references that type. Emit its type companion without selecting its runtime
    // implementation or copying that implementation's sidecar.
    const declarations = file.ast.statements.filter(isRuntimeConfigurableDeclaration)
    const quantitySurface = BridgeMetadata.quantitySurfaceFor(file.ast)
    const quantityPath = quantitySurface === undefined ? undefined : reserveOutputPath(
      outputPathInDirectory(
        outputDirectory(modulePath),
        `${FS.basename(modulePath, FS.extname(modulePath))}.quantities.ts`,
      ),
      usedOutputPaths,
    )
    const hasErasedCaseSets = options.dependencyRootBySourcePath.has(file.path)
      && file.ast.statements.some(statement =>
        AST.isTypeDeclaration(statement) && AST.isCaseSetTypeExpression(statement.type)
        && !statements.includes(statement)
      )
    const companionDirectory = declarations.length === 0
      ? outputDirectory(modulePath)
      : companionOutputDirectory(file.path, modulePath, usedOutputPaths)
    const declarationsPath = declarations.length === 0 && !hasErasedCaseSets && quantitySurface === undefined
      ? undefined
      : reserveOutputPath(
        outputPathInDirectory(companionDirectory, `${FS.basename(file.path)}.d.ts`),
        usedOutputPaths,
      )
    const sidecarCopies: PlannedSidecarCopy[] = []
    // A sidecar is named relative to the file that declares it, which an imported file may own, so
    // every path resolves against its own declaring document rather than this one.
    const planSidecar = (
      node: AST.Node,
      path: string,
      exportName: string,
      binding: string,
      syntheticProvider = false,
    ): PlannedSidecar => {
      const declarationPath = AST.getDocument(node).uri.path
      const sourcePath = FS.resolvePath(path, FS.dirname(declarationPath))
      const dependencyOwner = options.dependencyRootBySourcePath.get(declarationPath)
      const sourceOwner = dependencyOwner
        ?? (Packages.projectRootForPath(options.index, declarationPath) === options.projectRoot
          ? options.projectRoot
          : undefined)
      const allowUnmarkedOutside = sourceOwner === options.projectRoot && dependencyOwner === undefined
      const ownership = sourceOwner === undefined ? undefined : {
        projectRoot: sourceOwner,
        index: options.index,
        allowUnmarkedOutside,
      }
      // Ownership belongs to each binding, even when an earlier binding already copied this file.
      if (
        !syntheticProvider && ownership !== undefined
        && !sidecarSourceBelongsToProject(sourcePath, ownership)
      ) {
        Errors.throwUserInput(`Sidecar implementation '${sourcePath}' crosses a Tao project boundary.`)
      }
      let relativePath = sidecarPathBySourcePath.get(sourcePath)
      if (relativePath === undefined) {
        const graph = sidecarSourceGraph(
          sourcePath,
          syntheticProvider ? undefined : sourceOwner,
          options.index,
          allowUnmarkedOutside,
        )
        const plannedGraph = planSidecarGraphOutputs(
          graph.filter(path => !sidecarPathBySourcePath.has(path)),
          sourcePath,
          companionDirectory,
          usedOutputPaths,
        )
        relativePath = plannedGraph.get(sourcePath)
        Assert.defined(relativePath, 'planned sidecar graph contains its root', { sourcePath })
        sidecarCopies.push(...[...plannedGraph].map(([graphSourcePath, graphRelativePath]) => ({
          relativePath: graphRelativePath,
          sourcePath: graphSourcePath,
        })))
        for (const [graphSourcePath, graphRelativePath] of plannedGraph) {
          sidecarPathBySourcePath.set(graphSourcePath, graphRelativePath)
        }
      }
      return { binding, exportName, sourcePath, relativePath }
    }
    const sidecars = [
      ...statements.filter(isRuntimeConfigurableDeclaration).flatMap(declaration => {
        if (isTransparentConfigurableAlias(declaration)) {
          return []
        }
        const implementation = AST.configurationImplementationOf(declaration)
        const sidecarPath = implementation?.path
        return implementation === undefined || sidecarPath === undefined
          ? []
          : [planSidecar(
            implementation,
            sidecarPath,
            implementation.exportName,
            configurationSidecarBindingName(declaration),
          )]
      }),
      ...nodes.filter(AST.isFromExpression).map(bridge =>
        planSidecar(bridge, bridge.path, bridgeExportName(bridge), bridgeBindingName(bridge))
      ),
      ...statements.filter(AST.isViewDeclaration).filter(view => view.foreign !== undefined).map(view => {
        const foreign = view.foreign
        Assert.defined(foreign, 'planned foreign view has a sidecar implementation')
        return planSidecar(view, foreign.path, view.name, foreignViewBindingName(view))
      }),
      ...nodes.filter(AST.isActionDeclaration).filter(action => action.foreign !== undefined).map(action => {
        const foreign = action.foreign
        Assert.defined(foreign, 'planned foreign action has a sidecar implementation')
        return planSidecar(action, foreign.path, foreignActionExportName(action), foreignActionBindingName(action))
      }),
      ...(options.localDataProvider?.ownerPath === file.path
        ? [planSidecar(
          file.ast,
          options.localDataProvider.sourcePath,
          localProviderExportName,
          LocalDataBindings.provider,
          true,
        )]
        : []),
    ]
    bySourcePath.set(file.path, { injections, modulePath, declarationsPath, sidecars, sidecarCopies, quantityPath })
  }
  const canonicalQuantities = new Map<AST.TypeDeclaration, QuantityCanonicalLeaf>()
  for (const file of sourceFiles) {
    const planned = bySourcePath.get(file.path)!
    const surface = BridgeMetadata.quantitySurfaceFor(file.ast)
    if (surface === undefined || planned.quantityPath === undefined) {
      continue
    }
    const linkageByOwner = new Map(
      surface.declarations.filter(row => row.declaration === row.owner).map(row => [row.owner, row] as const),
    )
    const leaf: QuantityCanonicalLeaf = {
      path: planned.quantityPath,
      namespaceExport: surface.namespaceExport,
      linkageByOwner,
    }
    linkageByOwner.forEach((_link, owner) => canonicalQuantities.set(owner, leaf))
  }
  for (const file of sourceFiles) {
    const planned = bySourcePath.get(file.path)!
    if (planned.quantityPath !== undefined) {
      planned.quantityModule = BridgeMetadata.quantityModuleFor(
        file.ast,
        planned.quantityPath,
        { modulePrefix: '@runtime' },
        canonicalQuantities,
      )
    }
  }
  return { bySourcePath, modulePathBySourcePath, canonicalQuantities, sidecarPathBySourcePath }
}

type CompileSourceFileOptions = {
  dataCatalog: DataCatalogPlan | undefined
  sourceByPath: Map<string, ParsedFile>
  operatorWitnessKeys: ReadonlyMap<ASTUtils.AssociatedOperatorWitnessDeclaration, string>
  selectedStatements: readonly AST.Statement[]
  selectedStatementsFor: (file: ParsedFile) => readonly AST.Statement[]
  sidecarRuntimeExports: ReadonlySet<AST.Declaration> | undefined
  outputPaths: PlannedOutputs
  identityProjects: readonly DeclarationIdentityProject[]
  identityOwnerBySourcePath: ReadonlyMap<string, string>
  projectRoot: string
  nativeBridgeTypeOrigins?: CompilerContext['nativeBridgeTypeOrigins']
  selectedAppDatasourceConfiguration?: Readonly<Record<string, string>>
  selectedAppFirebaseConfiguration?: Readonly<Record<string, string>>
  selectedAppAuthConfiguration?: Readonly<Record<string, string>>
  selectedAppName: string | undefined
  journeyObservations: boolean
  studio: boolean
  studioViews: ReadonlyArray<{ id: string; view: AST.ViewDeclaration }>
  studioSourceEpochs: Readonly<Record<string, number>> | undefined
  studioDesignEpochs: Readonly<Record<string, number>> | undefined
  debug: boolean
}

function compileSourceFile(file: ParsedFile, options: CompileSourceFileOptions): CompiledFile[] {
  const {
    dataCatalog,
    sourceByPath,
    operatorWitnessKeys,
    selectedStatements,
    selectedStatementsFor,
    sidecarRuntimeExports,
    outputPaths,
    identityProjects,
    identityOwnerBySourcePath,
    projectRoot,
    selectedAppDatasourceConfiguration,
    selectedAppFirebaseConfiguration,
    selectedAppAuthConfiguration,
    selectedAppName,
    journeyObservations,
    studio,
    studioViews,
    studioSourceEpochs,
    studioDesignEpochs,
    debug,
  } = options
  const imports = resolveImports(file.path, file.ast, sourceByPath, selectedStatements, selectedStatementsFor)
  const ownsDataCatalog = dataCatalog?.ownerPath === file.path
  const needsStudioDataCatalog = studio && selectedAppName !== undefined && dataCatalog !== undefined
  // A studio preview renders any view of the app, so its root reads the catalog whether or not
  // this file names a query of its own.
  const readsCatalogRows = dataCatalog !== undefined
    && (dataCatalog.userPaths.has(file.path) || needsStudioDataCatalog)
  if (dataCatalog && !ownsDataCatalog && readsCatalogRows) {
    for (const binding of syncedCatalogBindings(dataCatalog)) {
      addResolvedImport(imports, dataCatalog.ownerPath, binding)
    }
  }
  if (studio && selectedAppName !== undefined) {
    for (const item of studioViews) {
      const ownerPath = AST.getDocument(item.view).uri.fsPath
      if (ownerPath !== file.path && !imports.bySource.has(ownerPath)) {
        imports.bySource.set(ownerPath, new Set())
      }
    }
  }
  // The companion bindings reach further than the synced catalog's: every app root binds them,
  // including an app that configures no Datasource of its own. Both travel together, because a
  // catalog user reads the local schema and an app root binds its datasource.
  const usesLocalDataCatalog = dataCatalog?.localOnly === true
    && (ownsDataCatalog || dataCatalog.localUserPaths.has(file.path))
  if (usesLocalDataCatalog && !ownsDataCatalog) {
    for (const binding of localCatalogBindings) {
      addResolvedImport(imports, dataCatalog.ownerPath, binding)
    }
  }
  const planned = outputPaths.bySourcePath.get(file.path)
  Assert.defined(planned, compiledSourceOutputPathMessage, { sourcePath: file.path })
  const associatedExports = new Map(
    [...associatedWitnessExports(file.ast)].filter(([owner]) => selectedStatements.includes(owner)),
  )
  const factoryBindings = new Map<AST.TypeDeclaration, string>()
  const quantityImports: string[] = []
  for (const [owner, leaf] of outputPaths.canonicalQuantities) {
    const link = leaf.linkageByOwner.get(owner)
    Assert.defined(link, 'compiled canonical quantity owner has its exact linkage')
    const binding = `__tao_quantity_factory_${factoryBindings.size + 1}__`
    factoryBindings.set(owner, binding)
    quantityImports.push(
      `import { ${link.factoryExport} as ${binding} } from ${
        JSON.stringify(relativeImportPath(planned.modulePath, leaf.path))
      }`,
    )
  }
  const emitWithQuantityTypes = <Result>(path: string, emit: () => Result): Result => {
    const bindings = new Map([...outputPaths.canonicalQuantities].map(([owner, leaf]) => {
      const link = leaf.linkageByOwner.get(owner)
      Assert.defined(link, 'compiled quantity type owner has its exact linkage')
      return [owner, `import(${JSON.stringify(relativeImportPath(path, leaf.path))}).${link.valueTypeExport}`] as const
    }))
    return BridgeMetadata.withQuantityTypeBindings(bindings, emit)
  }
  const nativeOrigins = new Map(
    (options.nativeBridgeTypeOrigins ?? []).map(origin =>
      [`${FS.resolvePath(origin.sourcePath)}#${origin.name}`, origin] as const
    ),
  )
  const sidecarCopies = new Map(
    [...outputPaths.bySourcePath.values()].flatMap(output =>
      output.sidecarCopies.map(copy => [FS.resolvePath(copy.sourcePath), copy.relativePath] as const)
    ),
  )
  const typeOriginResolver: BridgeTypeOriginResolver = declaration => {
    if (!AST.isTypeDeclaration(declaration)) {
      return undefined
    }
    const origin = nativeOrigins.get(`${FS.resolvePath(AST.getDocument(declaration).uri.fsPath)}#${declaration.name}`)
    return origin === undefined ? undefined : {
      exportName: origin.exportName,
      memberName: origin.memberName,
      implementationPath: sidecarCopies.get(FS.resolvePath(origin.implementationPath)) ?? origin.implementationPath,
    }
  }
  const bridgeTypeOptions = { modulePath: planned.modulePath, typeOriginResolver }
  const typeStatements = file.ast.statements.filter(statement => {
    if (!isRuntimeConfigurableDeclaration(statement)) {
      return false
    }
    if (!isTransparentConfigurableAlias(statement)) {
      return true
    }
    const target = statement.aliasTarget?.member.ref
    return target !== undefined && outputPaths.modulePathBySourcePath.has(AST.getDocument(target).uri.path)
  })
  const witnessPlan = planAssociatedWitnessBindings(
    file.ast,
    associatedExports,
    referencedAssociatedWitnessOwners(selectedStatements),
    new Map(
      [...sourceByPath.values()].flatMap(source =>
        [...associatedWitnessExports(source.ast)].filter(([owner]) => selectedStatementsFor(source).includes(owner))
      ),
    ),
    [
      ...factoryBindings.values(),
      ...imports.scopeBindings.values(),
      ...planned.injections.map(injection => injection.binding),
      ...planned.sidecars.map(sidecar => sidecar.binding),
    ],
  )
  const importLines = [
    ...witnessPlan.imports.map(witness => {
      const sourcePath = outputPaths.modulePathBySourcePath.get(witness.sourcePath)
      Assert.defined(sourcePath, 'referenced associated owner has a selected emitted source module')
      return `import { ${witness.exported} as ${witness.binding} } from ${
        JSON.stringify(relativeImportPath(planned.modulePath, sourcePath))
      }`
    }),
    ...quantityImports,
    ...importLinesForCompiledFile(imports, planned.modulePath, outputPaths.modulePathBySourcePath),
    ...configurationAliasImportLines(file, planned.modulePath, outputPaths, typeStatements),
    ...planned.injections.map(injection =>
      `import ${injection.binding} from '${relativeImportPath(planned.modulePath, injection.relativePath)}'`
    ),
    ...planned.sidecars.map(sidecar =>
      `import { ${sidecar.exportName} as ${sidecar.binding} } from '${
        relativeImportPath(planned.modulePath, sidecar.relativePath)
      }'`
    ),
  ]
  const scopeBindings = [...imports.scopeBindings].map(([binding, imported]) =>
    `TR.Use(_Scope, '${binding}', () => ${imported})`
  )
  const exportedBindings = selectedStatements
    .filter(AST.isExportableDeclaration)
    .filter(declarationEmitsRuntimeBinding)
    .filter(declaration => declarationVisibleOutsideFile(declaration) || sidecarRuntimeExports?.has(declaration))
    .map((declaration: AST.Declaration) => exportedBinding(runtimeBindingName(declaration)))
  if (ownsDataCatalog) {
    exportedBindings.push(...syncedCatalogBindings(dataCatalog).map(exportedBinding))
    if (dataCatalog.localOnly) {
      exportedBindings.push(...localCatalogBindings.map(exportedBinding))
    }
  }

  const emitted = (relativePath: string, code: string): CompiledFile => ({ code, relativePath, sourcePath: file.path })
  const module = emitted(
    planned.modulePath,
    withImportedDeclarationBindings(
      imports.declarationBindings,
      () =>
        withAssociatedWitnessBindings(witnessPlan.bindings, () =>
          withQuantityFactoryBindings(
            factoryBindings,
            () =>
              emitWithQuantityTypes(planned.modulePath, () =>
                withDataStorePlan(
                  dataCatalog?.stores,
                  () =>
                    withDeclarationIdentityContext(identityProjects, identityOwnerBySourcePath, () =>
                      withInlineInjectionBindings(
                        new Map(planned.injections.map(injection => [injection.node, injection.binding])),
                        () =>
                          withActionResultBridgeTypes(bridgeTypeOptions, () =>
                            withActionInstrumentation(debug, () =>
                              RuntimeGen.TaoFile(file.ast, {
                                bridgeTypes: BridgeMetadata.typesFor(file.ast, selectedStatements, bridgeTypeOptions),
                                configurationTypes: planned.declarationsPath === undefined
                                  ? undefined
                                  : RuntimeGen.ConfigurationTypes(file.ast, typeStatements),
                                dataEntities: ownsDataCatalog ? dataCatalog.entities : [],
                                dataAccess: ownsDataCatalog ? dataCatalog.access : [],
                                emitDataCatalog: ownsDataCatalog,
                                importLines,
                                localDataCatalog: usesLocalDataCatalog,
                                journeyObservations,
                                scopeBindings,
                                exportedBindings,
                                selectedAppDatasourceConfiguration,
                                selectedAppFirebaseConfiguration,
                                selectedAppAuthConfiguration,
                                selectedAppName,
                                projectRoot,
                                studioDataCatalog: studio && dataCatalog !== undefined
                                  && (ownsDataCatalog || needsStudioDataCatalog),
                                studio,
                                debug,
                                studioViews: studio && selectedAppName !== undefined ? studioViews : [],
                                studioSourceEpochs,
                                studioDesignEpochs,
                                viewRegistrations: RuntimeGen.ViewRegistrations(
                                  file.ast,
                                  { studio },
                                  selectedStatements,
                                ),
                                selectedStatements,
                              }))),
                      )),
                )),
          ), operatorWitnessKeys),
    ),
  )
  if (associatedExports.size > 0) {
    module.code += `\nexport { ${[...associatedExports.values()].join(', ')} }\n`
  }
  if (planned.quantityModule !== undefined) {
    module.code += `\n${BridgeMetadata.quantityExportsFor(file.ast, planned.modulePath, planned.quantityModule)}\n`
  }
  const declarationsPath = planned.declarationsPath
  const declarations = declarationsPath === undefined ? [] : [emitted(
    declarationsPath,
    emitWithQuantityTypes(declarationsPath, () =>
      RuntimeGen.ConfigurationDeclarations(
        file.ast,
        configurationAliasImportLines(file, declarationsPath, outputPaths, typeStatements),
        [
          BridgeMetadata.typesFor(file.ast, selectedStatements, { ...bridgeTypeOptions, modulePath: declarationsPath }),
          identityOwnerBySourcePath.has(file.path)
            ? BridgeMetadata.caseSetTypesFor(file.ast.statements)
            : '',
        ].filter(Boolean).join('\n'),
        typeStatements,
      )),
  )]
  if (planned.quantityModule !== undefined && declarations[0] !== undefined) {
    declarations[0].code += `\n${
      BridgeMetadata.quantityExportsFor(file.ast, declarationsPath!, planned.quantityModule)
    }\n`
  }
  const injections = planned.injections.map(injection =>
    emitted(
      injection.relativePath,
      emitWithQuantityTypes(injection.relativePath, () => RuntimeGen.InjectionBoundary(injection.node)),
    )
  )
  const quantityFiles = planned.quantityModule === undefined ? [] : [
    emitted(planned.quantityModule.path, planned.quantityModule.code),
  ]
  return [module, ...injections, ...declarations, ...quantityFiles, ...copySidecars(file.path, outputPaths)]
}

function copySidecars(sourcePath: string, outputPaths: PlannedOutputs): CompiledFile[] {
  const planned = outputPaths.bySourcePath.get(sourcePath)
  Assert.defined(planned, compiledSourceOutputPathMessage, { sourcePath })
  const copiedSidecars = new Map<string, CompiledFile>()
  for (const sidecar of planned.sidecarCopies) {
    // A synthetic in-memory source has no directory to copy from. Real compiles still assert,
    // which is what catches a missing sidecar before emitting an import of it.
    if (!FS.existsSync(FS.dirname(sidecar.sourcePath))) {
      continue
    }
    Assert(FS.existsSync(sidecar.sourcePath), 'validated sidecar exists', {
      sourcePath: sidecar.sourcePath,
    })
    copiedSidecars.set(sidecar.relativePath, {
      ...sidecar,
      code: rewriteSidecarTaoImports(
        FS.readTextSync(sidecar.sourcePath),
        sidecar.sourcePath,
        sidecar.relativePath,
        outputPaths,
      ),
    })
  }
  return [...copiedSidecars.values()]
}

type ReferenceGraphEntry = {
  sourceHash: string
  targets: readonly AST.TaoFile[]
  unresolved: boolean
}

type EmissionFingerprintContext = {
  globalFingerprint: string
  dataReferences: Array<[string, string]> | undefined
  referenceGraph: Map<string, ReferenceGraphEntry>
}

/** Cache shared graph and plan work for the duration of this one validated compile. */
function createEmissionFingerprintContext(
  options: CompileSourceFileOptions,
  sourceFiles: readonly ParsedFile[],
): EmissionFingerprintContext {
  const referenceGraph = new Map<string, ReferenceGraphEntry>()
  const dataSources = sourceFiles.filter(candidate =>
    options.selectedStatementsFor(candidate).some(statement =>
      AST.isEntityDataDeclaration(statement)
      || AST.isDatasourceDeclaration(statement)
      || AST.isAccessDeclaration(statement)
    )
  )
  const outputPlan = [...options.outputPaths.bySourcePath].map(([path, planned]) => [
    path,
    planned.modulePath,
    planned.declarationsPath,
    planned.injections.map(injection => [injection.binding, injection.relativePath]),
    planned.sidecars.map(sidecar => [sidecar.sourcePath, sidecar.relativePath, sidecar.binding, sidecar.exportName]),
    planned.sidecarCopies.map(sidecar => [sidecar.sourcePath, sidecar.relativePath]),
  ])
  return {
    globalFingerprint: Platform.sha256Hex(JSON.stringify({
      sourcePaths: sourceFiles.map(source => source.path),
      outputPlan,
      dataPlan: options.dataCatalog === undefined ? undefined : {
        ownerPath: options.dataCatalog.ownerPath,
        localOnly: options.dataCatalog.localOnly,
        userPaths: [...options.dataCatalog.userPaths],
        localUserPaths: [...options.dataCatalog.localUserPaths],
      },
      identityProjects: options.identityProjects,
      identityOwnerBySourcePath: [...options.identityOwnerBySourcePath],
      projectRoot: options.projectRoot,
      nativeBridgeTypeOrigins: options.nativeBridgeTypeOrigins,
      selectedAppDatasourceConfiguration: options.selectedAppDatasourceConfiguration,
      selectedAppFirebaseConfiguration: options.selectedAppFirebaseConfiguration,
      selectedAppAuthConfiguration: options.selectedAppAuthConfiguration,
      studio: options.studio,
      studioViewIds: options.studioViews.map(item => item.id),
      journeyObservations: options.journeyObservations,
      debug: options.debug,
    })),
    dataReferences: referencedSources(dataSources.map(source => source.ast), referenceGraph),
    referenceGraph,
  }
}

/** A missing resolved Tao reference makes reuse unsafe, so that file is emitted normally. */
function referencedSources(
  roots: readonly AST.TaoFile[],
  graph: Map<string, ReferenceGraphEntry>,
): Array<[string, string]> | undefined {
  const visited = new Map<string, string>()
  const pending = [...roots]
  while (pending.length > 0) {
    const root = pending.pop()!
    const document = AST.getDocument(root)
    const path = document.uri.fsPath
    if (visited.has(path)) {
      continue
    }
    let entry = graph.get(path)
    if (entry === undefined) {
      const targets: AST.TaoFile[] = []
      let unresolved = false
      for (const node of [root, ...AST.streamAllContents(root)]) {
        for (const reference of AST.streamReferences(node)) {
          const target = 'ref' in reference.reference ? reference.reference.ref : undefined
          if (target === undefined) {
            // A `from` expression's head names a TypeScript export, not a Tao declaration.
            // Its arguments are ordinary Tao references and still require resolved targets.
            const bridge = node.$container
            if (
              AST.isFromExpression(bridge) && bridge.expression === node
              && ((AST.isValueReference(node) && reference.property === 'target')
                || (AST.isFunctionCallExpression(node) && reference.property === 'function'))
            ) {
              continue
            }
            unresolved = true
            continue
          }
          const targetRoot = AST.findRoot(target)
          if (!AST.isTaoFile(targetRoot)) {
            unresolved = true
            continue
          }
          targets.push(targetRoot)
        }
      }
      entry = { sourceHash: Platform.sha256Hex(document.textDocument.getText()), targets, unresolved }
      graph.set(path, entry)
    }
    if (entry.unresolved) {
      return undefined
    }
    visited.set(path, entry.sourceHash)
    pending.push(...entry.targets)
  }
  return [...visited].sort(([left], [right]) => left.localeCompare(right))
}

/** The key combines this file's resolved dependencies with shared validated planning inputs. */
function emissionFingerprint(
  file: ParsedFile,
  options: CompileSourceFileOptions,
  context: EmissionFingerprintContext,
): string | undefined {
  if (context.dataReferences === undefined) {
    return undefined
  }
  const imports = resolveImports(
    file.path,
    file.ast,
    options.sourceByPath,
    options.selectedStatements,
    options.selectedStatementsFor,
  )
  const localReferences = referencedSources([
    file.ast,
    ...(options.studio && options.selectedAppName !== undefined
      ? options.studioViews.map(item => AST.findRoot(item.view)).filter(AST.isTaoFile)
      : []),
  ], context.referenceGraph)
  if (localReferences === undefined) {
    return undefined
  }
  const importedSources = [...imports.bySource.keys()].map(path => options.sourceByPath.get(path))
  if (importedSources.some(source => source === undefined)) {
    return undefined
  }
  const importedReferences = referencedSources(importedSources.map(source => source!.ast), context.referenceGraph)
  if (importedReferences === undefined) {
    return undefined
  }
  // A file containing only Design declarations contributes its emitted value through an import.
  // Its body is compiled in that file, not in an unchanged consumer. Preserve that consumer's
  // Studio source-epoch snapshot until the consumer itself changes and is emitted again.
  const dependencyReferences = (references: Array<[string, string]>): Array<[string, string]> =>
    references.map(([path, hash]) => {
      const source = options.sourceByPath.get(path)
      if (
        options.studioSourceEpochs === undefined || path === file.path || source === undefined
        || source.ast.statements.length === 0
        || !source.ast.statements.every(AST.isDesignDeclaration)
        || [file.ast, ...AST.streamAllContents(file.ast)].some(node => {
          if (!AST.isValueReference(node) || !AST.isDesignDeclaration(node.target?.ref)) {
            return false
          }
          return AST.getDocument(node.target.ref).uri.fsPath === path
            && !(AST.isAppProperty(node.$container) && node.$container.name === 'Design')
        })
      ) {
        return [path, hash]
      }
      return [
        path,
        JSON.stringify(
          source.ast.statements.filter(AST.isDesignDeclaration).map(
            declaration => [declaration.name, Packages.visibilityOf(declaration)],
          ),
        ),
      ]
    })
  const referenced = [...new Map([...context.dataReferences, ...dependencyReferences(localReferences)])]
    .sort(([left], [right]) => left.localeCompare(right))
  return Platform.sha256Hex(JSON.stringify({
    globalFingerprint: context.globalFingerprint,
    sourcePath: file.path,
    selectedStatements: options.selectedStatements.map(selectedStatementIdentity),
    studioSourceEpoch: options.studioSourceEpochs?.[file.path],
    referenced,
    importedReferences: dependencyReferences(importedReferences),
    imports: [...imports.bySource].map(([path, names]) => [path, [...names]]),
    scopeBindings: [...imports.scopeBindings],
    sidecarRuntimeExports: [...(options.sidecarRuntimeExports ?? [])].map(declaration => [
      AST.getDocument(declaration).uri.fsPath,
      declaration.$type,
      declaration.name,
      declaration.$cstNode?.offset,
    ]),
    selectedAppName: options.selectedAppName,
  }))
}

/** Selection can change without source text changing; source offsets are not selection identity. */
function selectedStatementIdentity(statement: AST.Statement): readonly (string | number | undefined)[] {
  const root = AST.findRoot(statement)
  return [
    AST.getDocument(statement).uri.fsPath,
    AST.isTaoFile(root) ? root.statements.indexOf(statement) : -1,
    statement.$type,
    'name' in statement && typeof statement.name === 'string' ? statement.name : undefined,
    AST.isDeclaration(statement) ? Packages.visibilityOf(statement) : undefined,
  ]
}

/** Keep compilation's existing user error while graph inspection stays diagnostic-only. */
function sidecarSourceGraph(
  rootPath: string,
  owner?: string,
  index?: Packages.Index,
  allowUnmarkedOutside = false,
): readonly string[] {
  const inspection = inspectSidecarSourceGraph(
    rootPath,
    owner === undefined || index === undefined
      ? undefined
      : { projectRoot: owner, index, allowUnmarkedOutside },
  )
  const first = inspection.diagnostics[0]
  if (first !== undefined) {
    Errors.throwUserInput(first.message, first.range === undefined ? undefined : { diagnostics: [first] })
  }
  return inspection.sourcePaths
}

function planSidecarGraphOutputs(
  graph: readonly string[],
  rootPath: string,
  companionDirectory: string,
  usedOutputPaths: Set<string>,
): ReadonlyMap<string, string> {
  if (graph.length <= 1) {
    return new Map([[
      rootPath,
      reserveOutputPath(
        outputPathInDirectory(companionDirectory, FS.basename(rootPath)),
        usedOutputPaths,
      ),
    ]])
  }
  const commonDirectory = commonPath(graph.map(FS.dirname))
  const graphName = `${FS.basename(rootPath, FS.extname(rootPath))}.files`
  for (let suffix = 1;; suffix++) {
    const directoryName = suffix === 1 ? graphName : `${graphName}-${suffix}`
    const directory = outputPathInDirectory(companionDirectory, directoryName)
    const outputs = new Map(graph.map(sourcePath => [
      sourcePath,
      outputPathInDirectory(directory, FS.relativePath(commonDirectory, sourcePath)),
    ]))
    if ([...outputs.values()].some(path => usedOutputPaths.has(path))) {
      continue
    }
    for (const path of outputs.values()) {
      usedOutputPaths.add(path)
    }
    return outputs
  }
}

function commonPath(paths: readonly string[]): string {
  const first = paths[0]
  Assert.defined(first, 'sidecar graph has at least one directory')
  const segments = first.split('/')
  for (const path of paths.slice(1)) {
    const candidate = path.split('/')
    while (segments.length > 0 && segments.join('/') !== candidate.slice(0, segments.length).join('/')) {
      segments.pop()
    }
  }
  return segments.join('/') || '/'
}

/** A moved sidecar still resolves generated declaration companions for authored `.tao` type imports. */
function rewriteSidecarTaoImports(
  source: string,
  sourcePath: string,
  relativePath: string,
  outputPaths: PlannedOutputs,
): string {
  source = rewriteQuantityNativeImports(source, sourcePath, relativePath, path => {
    const planned = outputPaths.bySourcePath.get(path)
    const quantity = planned?.quantityModule
    return planned === undefined || quantity === undefined ? undefined : {
      modulePath: planned.modulePath,
      declarationsPath: planned.declarationsPath,
      quantity: { path: quantity.path, ...quantity.surface },
    }
  })
  let rewritten = source
  for (const specifier of sidecarModuleSpecifiers(source, sourcePath).toReversed()) {
    if (!specifier.value.startsWith('./') && !specifier.value.startsWith('../')) {
      continue
    }
    const planned = specifier.value.endsWith('.tao')
      ? outputPaths.bySourcePath.get(FS.resolvePath(specifier.value, FS.dirname(sourcePath)))
      : undefined
    const sidecarPath = planned === undefined
      ? relativeSidecarCandidates(sourcePath, specifier.value).find(path =>
        outputPaths.sidecarPathBySourcePath.has(path)
      )
      : undefined
    const target = planned
      ? specifier.runtimeNamespace || specifier.valueNames.length > 0
        ? planned.modulePath
        : planned.declarationsPath ?? planned.modulePath
      : sidecarPath === undefined
      ? undefined
      : outputPaths.sidecarPathBySourcePath.get(sidecarPath)
    if (target === undefined) {
      continue
    }
    const quote = source[specifier.start]
    rewritten = `${rewritten.slice(0, specifier.start)}${quote}${relativeImportPath(relativePath, target)}${quote}${
      rewritten.slice(specifier.end)
    }`
  }
  return rewritten
}

function declarationIdentityProjects(
  files: readonly ParsedFile[],
  context: CompilerContext,
  graph: ProjectGraph,
  semanticOwners: ReadonlyMap<string, string>,
): DeclarationIdentityProject[] {
  const roots = [
    graph.projectRoot,
    context.packagesContext.stdlibRoot,
    ...context.packagesContext.index.projectRoots,
    ...semanticOwners.values(),
  ]
  const projects = new Map<string, DeclarationIdentityProject>()
  for (const file of files) {
    const root = semanticOwners.get(file.path)
      ?? roots.filter(candidate => FS.pathIsWithin(file.path, candidate))
        .toSorted((left, right) => right.length - left.length)[0]
      ?? FS.dirname(file.path)
    if (!projects.has(root)) {
      projects.set(root, identityProject(root))
    }
  }
  return [...projects.values()]
}

function identityProject(root: string): DeclarationIdentityProject {
  if (root === codeProjectRoot) {
    return { id: 'ephemeral:source', root }
  }
  const id = ProjectIdentity.read(root)
  if (id === undefined) {
    Errors.throwUserInput(
      `Tao project identity is missing in ${root}/.tao/store/project.json. Run tao check to initialize it.`,
    )
  }
  return { id, root }
}

function configurationAliasImportLines(
  file: ParsedFile,
  currentOutputPath: string,
  outputPaths: PlannedOutputs,
  statements: readonly AST.Statement[] = file.ast.statements,
): string[] {
  const importLines = statements.filter(isTransparentConfigurableAlias).flatMap(declaration => {
    const target = declaration.aliasTarget?.member.ref
    if (!target || !AST.isTypeDeclaration(target)) {
      return []
    }
    const targetSourcePath = AST.getDocument(target).uri.path
    const targetOutputPath = outputPaths.modulePathBySourcePath.get(targetSourcePath)
    if (!targetOutputPath) {
      return []
    }
    const targetType = `${target.name}Config`
    const localType = configurationAliasTargetTypeBindingName(declaration)
    return [
      `import type { ${targetType} as ${localType} } from '${relativeImportPath(currentOutputPath, targetOutputPath)}'`,
    ]
  })
  return [...new Set(importLines)]
}

function planDataCatalog(
  sourceFiles: readonly ParsedFile[],
  entryPath: string,
  selectedStatements: (file: ParsedFile) => readonly AST.Statement[],
): DataCatalogPlan | undefined {
  const entities = sourceFiles.flatMap(file => selectedStatements(file).filter(AST.isEntityDataDeclaration))
  const datasources = sourceFiles.flatMap(file => selectedStatements(file).filter(AST.isDatasourceDeclaration))
  const pathsOf = (matches: (file: ParsedFile) => boolean) => new Set(sourceFiles.filter(matches).map(f => f.path))
  const directUserPaths = pathsOf(file => fileUsesDataCatalog(file, selectedStatements(file)))
  if (entities.length === 0 && directUserPaths.size === 0) {
    return undefined
  }
  const stores = ASTUtils.planDataStores(entities, datasources)
  const seedsSyncedRows = stores.stores.some(store => store.kind !== 'device' && store.collections.length > 0)
  const userPaths = new Set([
    ...directUserPaths,
    // Every app root seeds the project's synced stores when a test or Studio fixture is mounted,
    // including an app that leaves its datasource at the default. A project with only local-only
    // rows does not need the empty synced catalog in those roots.
    ...pathsOf(file => seedsSyncedRows && selectedAppValues(file, selectedStatements(file)).length > 0),
  ])
  const ownerPath = sourceFiles.find(file => selectedStatements(file).some(AST.isEntityDataDeclaration))?.path
    ?? entryPath
  // Both catalogs are emitted by one owner file, so a project that mixes stores still has a single
  // module every user imports from and a single sidecar copy of the local provider. An app root
  // binds the companion catalog whether or not it configures a Datasource, so a file that declares
  // an app is a companion user even when it never names the catalog itself.
  const localUserPaths = pathsOf(file =>
    fileUsesDataCatalog(file, selectedStatements(file)) || selectedAppValues(file, selectedStatements(file)).length > 0
  )
  return {
    entities,
    access: sourceFiles.flatMap(file => selectedStatements(file).filter(AST.isAccessDeclaration)),
    localOnly: entities.some(Type.dataEntityIsLocalOnly),
    localUserPaths,
    ownerPath,
    stores,
    userPaths,
  }
}

/**
 * A file uses the catalog when it reads or writes rows, and an app file uses it because mounting a
 * store is what an app root does. The app side is read from the resolved binding rather than from a
 * slot spelled `Datasource`, so a variant that inherits its datasources still counts as a user.
 */
/**
 * The catalog bindings a module shares. Every store but the device one travels together: a file that
 * reads rows may read any of them, and an app file mounts the ones it binds, so splitting the import
 * per query would save nothing and make the owner module's exports depend on its readers.
 */
function syncedCatalogBindings(plan: DataCatalogPlan): readonly string[] {
  return plan.stores.stores.filter(store => store.kind !== 'device').map(store => store.binding)
}

function fileUsesDataCatalog(file: ParsedFile, statements: readonly AST.Statement[] = file.ast.statements): boolean {
  if (selectedAppValues(file, statements).some(app => ASTUtils.appBoundDatasources(app).length > 0)) {
    return true
  }
  return statements.some(statement =>
    [statement, ...AST.streamAllContents(statement)].some(node =>
      AST.isEntityQueryDeclaration(node) || AST.isCreateStatement(node)
      || (AST.isValueReference(node) && AST.isAuthLibraryDeclaration(node.target.ref, 'Account'))
    )
  )
}

function selectedAppValues(file: ParsedFile, statements: readonly AST.Statement[]): AST.AppValueDeclaration[] {
  return AST.appValueDeclarationsInFile(file.ast).filter(app => statements.includes(app))
}

function addResolvedImport(imports: ResolvedImports, sourcePath: string, binding: string): void {
  addImportedName(imports.bySource, sourcePath, binding)
  imports.scopeBindings.set(binding, binding)
}

function addImportedName(bySource: Map<string, Set<string>>, sourcePath: string, name: string): void {
  const names = bySource.get(sourcePath) ?? new Set<string>()
  names.add(name)
  bySource.set(sourcePath, names)
}

/** exportedBinding re-exports one generated binding under its own name. */
function exportedBinding(binding: string): { exported: string; binding: string } {
  return { exported: binding, binding }
}

/** runtimeBindingName is the binding a declaration is emitted under, which a configurable
 * declaration renames so its own name can stay the configured value. */
function runtimeBindingName(declaration: AST.Declaration): string {
  return isRuntimeConfigurableDeclaration(declaration)
    ? configurationRuntimeBindingName(declaration)
    : declaration.name
}

function importLinesForCompiledFile(
  imports: ResolvedImports,
  currentOutputPath: string,
  outputPathBySourcePath: ReadonlyMap<string, string>,
): string[] {
  return [...imports.bySource.entries()].map(([sourcePath, names]) => {
    const sourceOutputPath = outputPathBySourcePath.get(sourcePath)
    Assert.defined(sourceOutputPath, compiledSourceOutputPathMessage, { sourcePath })
    const importPath = relativeImportPath(currentOutputPath, sourceOutputPath)
    if (names.size === 0) {
      return `import '${importPath}'`
    }
    const importedNames = Array.from(names).toSorted((left, right) => left.localeCompare(right)).join(', ')
    return `import { ${importedNames} } from '${importPath}'`
  })
}

function compileResultForApp(
  validationResult: ValidationResult,
  compiledFiles: CompiledFile[],
  selectedApp: AST.AppValueDeclaration,
  selectedAppPath: string,
): Omit<CompileResult, 'dependencyEnvironments'> {
  const appNames = validationResult.files.flatMap(file => AST.appValueDeclarationsInFile(file.ast).map(app => app.name))
  const entryCode = compiledFiles.find((compiledFile: CompiledFile) =>
    compiledFile.sourcePath === selectedAppPath && compiledFile.relativePath === 'App.tsx'
  )?.code
  Assert.defined(entryCode, 'selected app compiled code exists', { selectedAppPath })
  return {
    ...appMetadata(selectedApp),
    appNames,
    validation: validationResult,
    code: entryCode,
    files: compiledFiles,
  }
}

// Selected dependency projects keep a stable physical-root namespace, so copied sidecars resolve
// their own npm environment. Other out-of-root sources use the existing fallback buckets.
function moduleOutputPath(
  filePath: string,
  entryPath: string,
  sourceRoot: string,
  options: PlanOutputPathsOptions,
): string {
  const dependencyRoot = options.dependencyRootBySourcePath.get(filePath)
  if (dependencyRoot !== undefined && dependencyRoot !== options.projectRoot) {
    const relative = FS.relativePath(dependencyRoot, filePath)
    Assert(!relative.startsWith('..'), 'dependency project contains its source', { dependencyRoot, filePath })
    return `modules/dependencies/${BridgeMetadata.dependencyNamespace(dependencyRoot)}/${relative}.tsx`
  }
  const sourceRelative = FS.relativePath(sourceRoot, filePath)
  if (!sourceRelative.startsWith('..')) {
    return `modules/${sourceRelative}.tsx`
  }
  const entryRelative = FS.relativePath(FS.dirname(entryPath), filePath)
  if (!entryRelative.startsWith('..')) {
    return `modules/app/${entryRelative}.tsx`
  }
  return `modules/external/${FS.basename(filePath)}.tsx`
}

function resolveImports(
  filePath: string,
  file: AST.TaoFile,
  sourceByPath: Map<string, ParsedFile>,
  statements: readonly AST.Statement[] = file.statements,
  selectedStatementsFor: (file: ParsedFile) => readonly AST.Statement[] = file => file.ast.statements,
): ResolvedImports {
  const bySource = new Map<string, Set<string>>()
  const scopeBindings = new Map<string, string>()
  const declarationBindings = new Map<AST.Declaration, string>()
  const referencedNames = ASTUtils.referencedNames(file, { statements })
  const reservedBindings = new Set(referencedNames)
  for (const node of AST.streamAllContents(file)) {
    if ('name' in node && typeof node.name === 'string') {
      reservedBindings.add(node.name)
    }
  }
  for (const use of file.statements.filter(AST.isUseStatement)) {
    use.importedDeclarations.forEach(specifier => reservedBindings.add(AST.importLocalName(specifier)))
  }
  const bindAliasedImport = (declaration: AST.Declaration, targetPath: string) => {
    if (declarationBindings.has(declaration)) {
      return
    }
    const preferred = `__tao_imported_${declarationBindings.size + 1}__`
    let binding = preferred
    for (let suffix = 1; reservedBindings.has(binding); suffix++) {
      binding = `${preferred}${suffix}`
    }
    reservedBindings.add(binding)
    declarationBindings.set(declaration, binding)
    addImportedName(bySource, targetPath, `${runtimeBindingName(declaration)} as ${binding}`)
    scopeBindings.set(binding, binding)
  }
  // A `folder` declaration is in scope without a `use` statement, so the generated module still
  // has to import it by name from the sibling file that declares it.
  const currentDirectory = FS.dirname(filePath)
  // Only what this file actually names: importing every folder-visible sibling declaration would
  // make each file in the folder import every other one, dead bindings and cycles included.
  for (const render of statements.flatMap(statement => AST.streamAllContents(statement)).filter(AST.isRender)) {
    const target = AST.isQuotedRender(render)
      ? render.view?.ref
      : ASTUtils.resolveRenderTarget(render)?.kind === 'text'
      ? [...sourceByPath.values()].find(source => source.path.endsWith('/@tao/ui/Views.tao'))
        ?.ast.statements.find(statement => AST.isViewDeclaration(statement) && statement.name === 'Text')
      : undefined
    if (AST.isViewDeclaration(target)) {
      const path = AST.getDocument(target).uri.path
      addImportedName(bySource, path, `${runtimeBindingName(target)} as __tao_quoted_Text$`)
    }
  }
  for (const candidate of sourceByPath.values()) {
    if (candidate.path === filePath || FS.dirname(candidate.path) !== currentDirectory) {
      continue
    }
    for (const declaration of selectedStatementsFor(candidate)) {
      if (
        !declarationEmitsRuntimeBinding(declaration)
        || Packages.visibilityOf(declaration) !== 'folder'
        || !referencedNames.has(declaration.name)
      ) {
        continue
      }
      const binding = runtimeBindingName(declaration)
      addImportedName(bySource, candidate.path, binding)
      scopeBindings.set(binding, binding)
    }
  }
  // A transparent view or configurable-type alias imports its target under a private local name;
  // the alias's own exported binding points at that exact value, preserving declaration identity.
  for (
    const declaration of statements.filter(statement =>
      AST.isViewDeclaration(statement) || isTransparentConfigurableAlias(statement)
    )
  ) {
    const aliasTarget = declaration.aliasTarget
    if (!aliasTarget) {
      continue
    }
    const target = aliasTarget.member.ref
    if (!target || !declarationEmitsRuntimeBinding(target)) {
      continue
    }
    const targetPath = AST.getDocument(target).uri.path
    if (!sourceByPath.has(targetPath)) {
      continue
    }
    const namespaceName = aliasTarget.namespace.$refText
    const memberName = aliasTarget.member.$refText
    const localBinding = `__tao_package_${namespaceName}_${memberName}`
    addImportedName(bySource, targetPath, `${runtimeBindingName(target)} as ${localBinding}`)
    scopeBindings.set(runtimeBindingName(declaration), localBinding)
  }
  // An auth provider type named only by `accepts { Kind from Auth }` is compared by name at runtime,
  // so its module — and the sign-in SDK its sidecar loads — stays out of this module's imports.
  const pairingIssuers = new Set(
    statements.flatMap(statement => AST.streamAllContents(statement)).filter(AST.isConfigurationAcceptedProof).flatMap(
      proof => proof.issuer ? [proof.issuer.root] : [],
    ),
  )
  const runtimeNames = pairingIssuers.size > 0
    ? ASTUtils.referencedNames(file, { runtimeOnly: true, statements })
    : referencedNames
  for (const useStatement of file.statements.filter(AST.isUseStatement)) {
    for (const imported of AST.resolvedImportedBindings(useStatement)) {
      const declaration = imported.declaration
      const importedName = declaration.name
      if ((useStatement.all || statements !== file.statements) && !referencedNames.has(imported.localName)) {
        continue
      }
      if (pairingIssuers.has(imported.localName) && !runtimeNames.has(imported.localName)) {
        continue
      }
      if (!declarationEmitsRuntimeBinding(declaration)) {
        continue
      }
      const targetPath = AST.getDocument(declaration).uri.path
      const targetFile = sourceByPath.get(targetPath)
      if (targetFile) {
        // A configurable type can also expose its generated same-name value. Keep both runtime
        // bindings, while the resolved reference fixes the source origin through local aliases.
        const declarations = selectedStatementsFor(targetFile).filter(declarationEmitsRuntimeBinding)
          .filter(candidate => candidate.name === importedName)
        for (const candidate of declarations) {
          if (imported.localName !== imported.sourceName) {
            bindAliasedImport(candidate, targetPath)
            continue
          }
          const binding = runtimeBindingName(candidate)
          addImportedName(bySource, targetPath, binding)
          scopeBindings.set(binding, binding)
        }
      }
    }
  }
  return { bySource, scopeBindings, declarationBindings }
}

function relativeImportPath(fromOutputPath: string, toOutputPath: string): string {
  const fromDir = FS.dirname(fromOutputPath)
  const relative = FS.relativePath(fromDir, toOutputPath)
  const withoutExtension = relative.replace(/\.(?:d\.ts|tsx?)$/, '')
  return withoutExtension.startsWith('.') ? withoutExtension : `./${withoutExtension}`
}

function companionOutputDirectory(
  sourcePath: string,
  modulePath: string,
  usedOutputPaths: ReadonlySet<string>,
): string {
  const directory = outputDirectory(modulePath)
  const declarationName = `${FS.basename(sourcePath)}.d.ts`
  if (!usedOutputPaths.has(outputPathInDirectory(directory, declarationName))) {
    return directory
  }

  const moduleName = FS.basename(modulePath, FS.extname(modulePath))
  for (let suffix = 1;; suffix++) {
    const name = suffix === 1 ? `${moduleName}.files` : `${moduleName}.files-${suffix}`
    const candidate = outputPathInDirectory(outputPathInDirectory(directory, name), declarationName)
    if (!usedOutputPaths.has(candidate)) {
      return outputPathInDirectory(directory, name)
    }
  }
}

function outputDirectory(outputPath: string): string {
  const directory = FS.dirname(outputPath)
  return directory === '.' ? '' : directory
}

function outputPathInDirectory(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`
}

function reserveOutputPath(preferredPath: string, usedOutputPaths: Set<string>): string {
  let outputPath = preferredPath
  for (let suffix = 2; usedOutputPaths.has(outputPath); suffix++) {
    outputPath = suffixedOutputPath(preferredPath, suffix)
  }
  usedOutputPaths.add(outputPath)
  return outputPath
}

function reserveModuleOutputPath(
  file: ParsedFile,
  preferredPath: string,
  usedOutputPaths: Set<string>,
  statements: readonly AST.Statement[] = file.ast.statements,
): string {
  if (!usedOutputPaths.has(preferredPath)) {
    usedOutputPaths.add(preferredPath)
    return preferredPath
  }
  if (!statements.some(isRuntimeConfigurableDeclaration)) {
    return reserveOutputPath(preferredPath, usedOutputPaths)
  }

  const directory = outputDirectory(preferredPath)
  const preferredName = FS.basename(preferredPath, FS.extname(preferredPath))
  for (let suffix = 2;; suffix++) {
    const collisionDirectory = outputPathInDirectory(directory, `${preferredName}-${suffix}.files`)
    const candidate = outputPathInDirectory(collisionDirectory, `${FS.basename(file.path)}.tsx`)
    if (!usedOutputPaths.has(candidate)) {
      usedOutputPaths.add(candidate)
      return candidate
    }
  }
}

function suffixedOutputPath(outputPath: string, suffix: number): string {
  if (outputPath.endsWith('.d.ts')) {
    return `${outputPath.slice(0, -'.d.ts'.length)}-${suffix}.d.ts`
  }
  const extension = FS.extname(outputPath)
  return extension === ''
    ? `${outputPath}-${suffix}`
    : `${outputPath.slice(0, -extension.length)}-${suffix}${extension}`
}

function declarationVisibleOutsideFile(declaration: AST.Declaration): boolean {
  return Packages.visibilityOf(declaration) !== undefined
}

// Most type declarations are erased, but a case set carries runtime case identities and a
// configurable type carries a declaration identity, so both cross file boundaries as bindings.
// Entity declarations contribute to the shared catalog rather than emitting individual bindings.
function declarationEmitsRuntimeBinding(node: AST.Node): node is AST.Declaration {
  return AST.isDeclaration(node)
    && AST.isEmittingRuntimeBinding(node)
    && !AST.isEntityDataDeclaration(node)
    && (!AST.isTypeDeclaration(node)
      || AST.isCaseSetTypeExpression(node.type)
      || isRuntimeConfigurableDeclaration(node))
}

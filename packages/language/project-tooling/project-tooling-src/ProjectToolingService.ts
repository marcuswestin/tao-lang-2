import { Packages } from '@ast-utils'
import { CompilerDependencies, type DependencyEnvironment } from '@compiler'
import { BridgeMetadata } from '@compiler/bridge-metadata'
import { inspectSidecarSourceGraph } from '@compiler/sidecar-source-graph'
import { discoverProjectTaoFiles, Workspace } from '@compiler/workspace'
import {
  AST,
  type ModuleOrigin,
  type ProjectAppRequirements,
  type ProjectPublication,
  type ProjectRequirement,
} from '@parser'
import { type Diagnostic, Diagnostics, Errors, FS, ProjectIdentity, ProjectLocal } from '@shared'
import { collectProjectDependencySnapshots, resolveRelativeSource } from './ProjectDependencySnapshots'
import { validateManagedDependencyEnvironments } from './ProjectManagedDependencies'
import {
  type ProjectPlannedOutput,
  publishProjectOutputs,
  removeLegacyAdjacentContracts,
} from './ProjectOutputPublisher'
import type { ProjectToolingOptions, ProjectToolingResult, ProjectToolingService } from './ProjectTooling'
import { checkProjectTypeScriptWithConfigInputs } from './ProjectTypeScriptCheck'
import { findProjectRoot, writeProjectTypeScriptConfigUnderLock } from './ProjectTypeScriptConfig'

const revisions = new Map<string, number>()
const lastDependencyRoots = new Map<string, readonly string[]>()
const lastPrivatePackages = new Map<string, ReadonlySet<string>>()
const lastGoodResults = new Map<string, ProjectToolingResult>()

/** ProjectTooling refreshes saved project files and owns their generated TypeScript publication. */
export const ProjectTooling: ProjectToolingService = {
  async refresh(inputRoot, options) {
    const root = await findProjectRoot(inputRoot) ?? FS.resolvePath(inputRoot)
    const markerPath = FS.resolvePath('.tao', root)
    if (!await FS.isDirectory(markerPath)) {
      const config = await writeProjectTypeScriptConfigUnderLock(root, options)
      return result(
        root,
        'stale',
        config.diagnostics,
        [],
        [],
        [],
        [],
        lastGoodResults.get(root)?.externalSidecarInputPaths ?? [],
        lastGoodResults.get(root)?.sidecarOwnershipInputPaths ?? [],
        [],
        nextRevision(root),
      )
    }
    await ProjectLocal.prepare(root)
    const lockPath = ProjectLocal.cacheResolve('locks/ts-gen-lock', root)
    const refreshed = await FS.withFileMutationLock(lockPath, root, async () => await refreshUnderLock(root, options))
    if (refreshed.status === 'fresh') {
      lastGoodResults.set(root, refreshed)
    }
    return refreshed
  },
  async watch(root, options) {
    const projectRoot = await findProjectRoot(root) ?? FS.resolvePath(root)
    const { startProjectFileWatch } = await import('./ProjectFileWatch')
    return await startProjectFileWatch(
      projectRoot,
      options,
      async () => await ProjectTooling.refresh(projectRoot, options),
    )
  },
}

async function refreshUnderLock(root: string, options: ProjectToolingOptions): Promise<ProjectToolingResult> {
  try {
    await ProjectIdentity.ensure(root)
  } catch (error) {
    if (!(error instanceof Errors.UserInputError)) {
      throw error
    }
    const previous = lastGoodResults.get(root)
    return result(
      root,
      'stale',
      [{
        filePath: ProjectLocal.storeResolve('project.json', root),
        message: error.messageForUser,
        severity: 'error',
        source: 'compiler',
      }],
      previous?.contractPaths ?? [],
      previous?.sourceMappings ?? [],
      previous?.dependencyRoots ?? lastDependencyRoots.get(root) ?? [],
      previous?.configInputPaths ?? [],
      previous?.externalSidecarInputPaths ?? [],
      previous?.sidecarOwnershipInputPaths ?? [],
      [],
      nextRevision(root),
    )
  }
  const sourcePaths = await discoverProjectTaoFiles(root)
  const sourceOwners = await Promise.all(sourcePaths.map(path => Packages.containingProjectRoot(FS.dirname(path))))
  const entryPaths = sourcePaths.filter((_, index) => sourceOwners[index] === root)
  let diagnostics: Diagnostic[] = []
  let dependencyRoots: readonly string[] = lastDependencyRoots.get(root) ?? []
  let privatePackages = lastPrivatePackages.get(root) ?? new Set<string>()
  const externalSidecarInputs = new Set<string>()
  const sidecarOwnershipInputs = new Set<string>()
  let planned: ProjectPlannedOutput[] | undefined = []
  if (entryPaths.length > 0) {
    const workspace = await Workspace.open(root)
    let validation = await workspace.validateFiles(entryPaths)
    diagnostics.push(...validation.diagnostics)
    if (Diagnostics.hasError(diagnostics)) {
      planned = undefined
    } else {
      const context = await Packages.createContext(root)
      const graph = Packages.createResolver(context).projectGraph({
        fromFilePath: entryPaths[0]!,
        workspaceFiles: validation.files.map(file => file.ast),
      })
      const ownDeclarations = new Set([
        ...graph.projectFiles.flatMap(file => file.statements.filter(AST.isDeclaration)),
        ...graph.appRequirements.flatMap(app => app.sourceDeclarations),
      ].filter(declaration => {
        const sourcePath = AST.getDocument(declaration).uri.path
        return FS.pathIsWithin(sourcePath, root) && Packages.projectRootForPath(context.index, sourcePath) === root
      }))
      for (const sidecarRoot of BridgeMetadata.implementationSidecarRoots([...ownDeclarations])) {
        const inspected = inspectSidecarSourceGraph(sidecarRoot, {
          projectRoot: root,
          index: context.index,
          allowUnmarkedOutside: true,
        })
        diagnostics.push(...inspected.diagnostics)
        for (const path of inspected.ownershipInputPaths) {
          sidecarOwnershipInputs.add(path)
        }
        for (const path of [...inspected.sourcePaths, ...inspected.unresolvedCandidatePaths]) {
          if (!FS.pathIsWithin(path, root)) {
            externalSidecarInputs.add(path)
          }
        }
      }
      const environments: DependencyEnvironment[] = [
        ...CompilerDependencies.collect(graph, { kind: 'project' }),
        ...graph.appRequirements.flatMap(app => CompilerDependencies.collect(graph, { kind: 'app', app: app.app })),
      ]
      privatePackages = new Set(
        environments.filter(environment => environment.projectRoot !== root)
          .flatMap(environment => environment.npm.map(requirement => requirement.alias)),
      )
      lastPrivatePackages.set(root, privatePackages)
      const selected = selectedPublicationSources([
        ...graph.requirements,
        ...graph.appRequirements.flatMap(app => app.requirements),
      ], root)
      dependencyRoots = selected.dependencyRoots
      lastDependencyRoots.set(root, dependencyRoots)
      for (const dependencyRoot of dependencyRoots) {
        if (dependencyRoot === root) {
          continue
        }
        try {
          await ProjectIdentity.ensure(dependencyRoot)
        } catch (error) {
          if (!(error instanceof Errors.UserInputError)) {
            throw error
          }
          diagnostics.push({
            filePath: ProjectLocal.storeResolve('project.json', dependencyRoot),
            message: error.messageForUser,
            severity: 'error',
            source: 'compiler',
          })
        }
      }
      const missingSelected = [...selected.sourcePaths].filter(path =>
        !validation.files.some(file => file.path === path)
      )
      if (missingSelected.length > 0) {
        validation = await workspace.validateFiles([...entryPaths, ...missingSelected])
        diagnostics.push(...validation.diagnostics)
      }
      if (Diagnostics.hasError(diagnostics)) {
        planned = undefined
      } else {
        const projectPaths = new Set(graph.projectFiles.map(file => AST.getDocument(file).uri.path))
        const contractSourcePaths = new Set([...projectPaths, ...selected.sourcePaths])
        const origins = new Map(selected.origins)
        const statementsBySourcePath = new Map(
          [...selected.statementsBySourcePath].map(([path, statements]) => [path, [...statements]]),
        )
        const runtimeDeclarationsByPublication = new Map<ProjectPublication, readonly AST.Declaration[]>()
        const collectContracts = () =>
          BridgeMetadata.collect(
            validation.files.filter(file => contractSourcePaths.has(file.path)),
            root,
            origins,
            { runtimeRoot: options.runtimeRoot, selectedStatementsBySourcePath: statementsBySourcePath },
          )
        let modules = collectContracts()
        let snapshots = await collectProjectDependencySnapshots(root, modules, origins)
        let changed = true
        while (changed && !Diagnostics.hasError(diagnostics)) {
          changed = false
          const additionalTypePaths = [...snapshots.taoTypeSources.keys()].filter(path =>
            !contractSourcePaths.has(path)
          )
          for (const path of additionalTypePaths) {
            contractSourcePaths.add(path)
            statementsBySourcePath.set(path, [])
            origins.set(path, snapshots.taoTypeSources.get(path)!)
          }
          if (additionalTypePaths.length > 0) {
            const missingPaths = additionalTypePaths.filter(path => !validation.files.some(file => file.path === path))
            const pathsByRoot = new Map<string, string[]>()
            for (const path of missingPaths) {
              const origin = origins.get(path)!
              const paths = pathsByRoot.get(origin.projectRoot) ?? []
              paths.push(path)
              pathsByRoot.set(origin.projectRoot, paths)
            }
            for (const [dependencyRoot, paths] of pathsByRoot) {
              const dependencyValidation = await (await Workspace.open(dependencyRoot)).validateFiles(paths)
              diagnostics.push(...dependencyValidation.diagnostics)
              const files = new Map(validation.files.map(file => [file.path, file]))
              for (const file of dependencyValidation.files) {
                if (!files.has(file.path)) {
                  files.set(file.path, file)
                }
              }
              validation = { ...validation, files: [...files.values()] }
            }
            changed = true
          }
          if (Diagnostics.hasError(diagnostics)) {
            break
          }
          const filesByPath = new Map(validation.files.map(file => [file.path, file.ast]))
          for (const publication of selected.publications) {
            const reached = runtimeSidecarDeclarations(
              publication,
              snapshots,
              filesByPath,
              validation.files.map(file => file.ast),
              context.index,
            )
            runtimeDeclarationsByPublication.set(publication, [...reached.keys()])
            for (const [declaration, origin] of reached) {
              const path = AST.getDocument(declaration).uri.path
              if (!contractSourcePaths.has(path)) {
                contractSourcePaths.add(path)
                origins.set(path, origin)
                statementsBySourcePath.set(path, [])
                changed = true
              }
              const statements = statementsBySourcePath.get(path)
              if (
                statements !== undefined && !statements.some(statement =>
                  statement === declaration
                  || (statement.$cstNode?.offset !== undefined
                    && statement.$cstNode.offset === declaration.$cstNode?.offset)
                )
              ) {
                statements.push(declaration)
                changed = true
              }
            }
          }
          if (changed) {
            modules = collectContracts()
            snapshots = await collectProjectDependencySnapshots(root, modules, origins)
          }
        }
        diagnostics.push(...snapshots.diagnostics)
        diagnostics.push(...validateSelectedPublicationImports(
          selected.publications,
          runtimeDeclarationsByPublication,
          snapshots,
        ))
        diagnostics.push(...await validateSelectedAppImports(root, graph.appRequirements))
        diagnostics.push(...await validateManagedDependencyEnvironments(root, environments))
        planned = Diagnostics.hasError(diagnostics) ? undefined : [
          ...modules.map(module => ({
            path: module.path,
            sourcePath: module.sourcePath,
            content: module.code,
            kind: 'contract' as const,
            sourceMappings: module.sourceMappings.map(mapping => ({
              generatedPath: module.path,
              generatedRange: mapping.generated,
              sourcePath: module.sourcePath,
              sourceRange: mapping.source,
            })),
          })),
          ...snapshots.outputs,
        ]
      }
    }
  }
  const config = await writeProjectTypeScriptConfigUnderLock(root, options, privatePackages)
  diagnostics.push(...config.diagnostics)
  const changedOutputPaths = [...config.changedOutputPaths]
  const published = await publishProjectOutputs(root, planned)
  changedOutputPaths.push(...published.changedOutputPaths)
  changedOutputPaths.push(...await removeLegacyAdjacentContracts(root))
  const typeCheck = await checkProjectTypeScriptWithConfigInputs(
    root,
    published.contractPaths,
    published.snapshotPaths,
    published.sourceMappings,
    options,
  )
  diagnostics.push(...typeCheck.diagnostics)
  const status = Diagnostics.hasError(diagnostics) ? 'stale' : 'fresh'
  if (status === 'stale') {
    for (const path of lastGoodResults.get(root)?.externalSidecarInputPaths ?? []) {
      externalSidecarInputs.add(path)
    }
    for (const path of lastGoodResults.get(root)?.sidecarOwnershipInputPaths ?? []) {
      sidecarOwnershipInputs.add(path)
    }
  }
  return result(
    root,
    status,
    Diagnostics.unique(diagnostics),
    published.contractPaths,
    published.sourceMappings,
    dependencyRoots,
    typeCheck.configInputPaths,
    [...externalSidecarInputs].sort(),
    [...sidecarOwnershipInputs].sort(),
    changedOutputPaths,
    nextRevision(root),
  )
}

function selectedPublicationSources(requirements: readonly ProjectRequirement[], projectRoot: string): {
  dependencyRoots: readonly string[]
  sourcePaths: ReadonlySet<string>
  origins: ReadonlyMap<string, ModuleOrigin>
  publications: readonly ProjectPublication[]
  statementsBySourcePath: ReadonlyMap<string, readonly AST.Statement[]>
} {
  const dependencyRoots = new Set<string>()
  const sourcePaths = new Set<string>()
  const origins = new Map<string, ModuleOrigin>()
  const publications: ProjectPublication[] = []
  const statementsBySourcePath = new Map<string, Set<AST.Statement>>()
  const visited = new Set<string>()
  const queue = [...requirements]
  while (queue.length > 0) {
    const requirement = queue.shift()!
    const targetRoot = requirement.targetProjectRoot
    const publication = requirement.selectedPublication
    if (targetRoot === undefined || publication === undefined) {
      continue
    }
    dependencyRoots.add(targetRoot)
    const declarationPath = AST.getDocument(publication.declaration).uri.path
    const identity = `${targetRoot}:${publication.name ?? ''}:${publication.version ?? ''}:${declarationPath}`
    if (visited.has(identity)) {
      continue
    }
    visited.add(identity)
    publications.push(publication)
    queue.push(...publication.requirements)
    if (targetRoot !== projectRoot) {
      for (const declaration of publication.sourceDeclarations) {
        const path = AST.getDocument(declaration).uri.path
        const statements = statementsBySourcePath.get(path) ?? new Set<AST.Statement>()
        statements.add(declaration)
        statementsBySourcePath.set(path, statements)
      }
    }
    for (const source of publication.sourceFiles) {
      const path = AST.getDocument(source).uri.path
      if (targetRoot === projectRoot) {
        continue
      }
      sourcePaths.add(path)
      const origin: ModuleOrigin = {
        projectRoot: targetRoot,
        packageName: publication.name,
        packageVersion: publication.version,
        modulePath: publication.includedModuleRoots.find(root => FS.pathIsWithin(path, root)) ?? targetRoot,
      }
      origins.set(path, origin)
    }
  }
  return {
    dependencyRoots: [...dependencyRoots],
    sourcePaths,
    origins,
    publications,
    statementsBySourcePath: new Map(
      [...statementsBySourcePath].map(([path, statements]) => [
        path,
        [...statements].toSorted((left, right) => (left.$cstNode?.offset ?? 0) - (right.$cstNode?.offset ?? 0)),
      ]),
    ),
  }
}

function runtimeSidecarDeclarations(
  publication: ProjectPublication,
  snapshots: Awaited<ReturnType<typeof collectProjectDependencySnapshots>>,
  filesByPath: ReadonlyMap<string, AST.TaoFile>,
  allFiles: readonly AST.TaoFile[],
  index: Packages.Index,
): ReadonlyMap<AST.Declaration, ModuleOrigin> {
  const reached = new Map<AST.Declaration, ModuleOrigin>()
  const visitedSidecars = new Set<string>()
  const queue = [...BridgeMetadata.implementationSidecarRoots(publication.sourceDeclarations)]
  while (queue.length > 0) {
    const sourcePath = queue.shift()!
    if (visitedSidecars.has(sourcePath) || !snapshots.sourceTexts.has(sourcePath)) {
      continue
    }
    visitedSidecars.add(sourcePath)
    queue.push(...snapshots.relativeEdges.get(sourcePath) ?? [])
    for (const edge of snapshots.taoEdges.get(sourcePath) ?? []) {
      const target = filesByPath.get(edge.targetPath)
      const origin = snapshots.taoTypeSources.get(edge.targetPath)
      if (target === undefined || origin === undefined) {
        continue
      }
      const seeds = CompilerDependencies.taoSidecarValueDeclarations(target, edge)
      for (const declaration of Packages.reachableProjectDeclarations(seeds, allFiles, origin.projectRoot, index)) {
        if (reached.has(declaration)) {
          continue
        }
        const path = AST.getDocument(declaration).uri.path
        reached.set(declaration, privateSourceOrigin(path, origin))
        queue.push(...BridgeMetadata.implementationSidecarRoots([declaration]))
      }
    }
  }
  return reached
}

function privateSourceOrigin(path: string, origin: ModuleOrigin): ModuleOrigin {
  const firstSegment = FS.relativePath(origin.projectRoot, path).split('/')[0] ?? ''
  return {
    ...origin,
    modulePath: firstSegment.startsWith('@')
      ? FS.resolvePath(firstSegment, origin.projectRoot)
      : origin.projectRoot,
  }
}

function validateSelectedPublicationImports(
  publications: readonly ProjectPublication[],
  runtimeDeclarationsByPublication: ReadonlyMap<ProjectPublication, readonly AST.Declaration[]>,
  snapshots: Awaited<ReturnType<typeof collectProjectDependencySnapshots>>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const publication of publications) {
    const visited = new Set<string>()
    const queue = [
      ...BridgeMetadata.implementationSidecarRoots(publication.sourceDeclarations),
      ...BridgeMetadata.implementationSidecarRoots(runtimeDeclarationsByPublication.get(publication) ?? []),
    ]
    while (queue.length > 0) {
      const sourcePath = queue.shift()!
      if (visited.has(sourcePath)) {
        continue
      }
      visited.add(sourcePath)
      const sourceText = snapshots.sourceTexts.get(sourcePath)
      if (sourceText === undefined) {
        continue
      }
      diagnostics.push(...CompilerDependencies.validateSidecarImports({
        sourcePath,
        sourceText,
        requirements: publication.requirements,
        ownerLabel: `package ${publication.name ?? '(unnamed)'} ${publication.version ?? ''}`.trim(),
      }))
      queue.push(...snapshots.relativeEdges.get(sourcePath) ?? [])
    }
  }
  return diagnostics
}

async function validateSelectedAppImports(
  projectRoot: string,
  apps: readonly ProjectAppRequirements[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  for (const app of apps) {
    const visited = new Set<string>()
    const queue = [...BridgeMetadata.implementationSidecarRoots(app.sourceDeclarations)]
    while (queue.length > 0) {
      const sourcePath = queue.shift()!
      if (visited.has(sourcePath) || !FS.pathIsWithin(sourcePath, projectRoot)) {
        continue
      }
      visited.add(sourcePath)
      if (!await FS.isFile(sourcePath)) {
        continue
      }
      const sourceText = await FS.readText(sourcePath)
      diagnostics.push(...CompilerDependencies.validateSidecarImports({
        sourcePath,
        sourceText,
        requirements: app.requirements,
        ownerLabel: `app ${app.app.name}`,
      }))
      for (const imported of CompilerDependencies.sidecarImports({ sourcePath, sourceText })) {
        if (imported.kind !== 'relative' || imported.specifier.endsWith('.tao')) {
          continue
        }
        const candidate = FS.resolvePath(imported.specifier, FS.dirname(sourcePath))
        if (!FS.pathIsWithin(candidate, projectRoot)) {
          continue
        }
        const resolved = await resolveRelativeSource(candidate)
        if (resolved !== undefined) {
          queue.push(resolved)
        }
      }
    }
  }
  return diagnostics
}

function nextRevision(root: string): number {
  const revision = (revisions.get(root) ?? 0) + 1
  revisions.set(root, revision)
  return revision
}

function result(
  root: string,
  status: ProjectToolingResult['status'],
  diagnostics: readonly Diagnostic[],
  contractPaths: ProjectToolingResult['contractPaths'],
  sourceMappings: ProjectToolingResult['sourceMappings'],
  dependencyRoots: ProjectToolingResult['dependencyRoots'],
  configInputPaths: ProjectToolingResult['configInputPaths'],
  externalSidecarInputPaths: ProjectToolingResult['externalSidecarInputPaths'],
  sidecarOwnershipInputPaths: ProjectToolingResult['sidecarOwnershipInputPaths'],
  changedOutputPaths: ProjectToolingResult['changedOutputPaths'],
  revision: number,
): ProjectToolingResult {
  return {
    root,
    status,
    diagnostics,
    contractPaths,
    sourceMappings,
    dependencyRoots,
    configInputPaths,
    externalSidecarInputPaths,
    sidecarOwnershipInputPaths,
    changedOutputPaths,
    revision,
  }
}

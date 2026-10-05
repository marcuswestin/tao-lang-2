import { Packages } from '@ast-utils'
import { CompilerDependencies, type DependencyEnvironment } from '@compiler'
import { BridgeMetadata } from '@compiler/bridge-metadata'
import { inspectSidecarSourceGraph, type SidecarSourceGraphInspection } from '@compiler/sidecar-source-graph'
import { discoverProjectTaoFiles, Workspace } from '@compiler/workspace'
import {
  AST,
  type ModuleOrigin,
  type ProjectAppRequirements,
  type ProjectPublication,
  type ProjectRequirement,
} from '@parser'
import {
  Assert,
  type Diagnostic,
  Diagnostics,
  Errors,
  FS,
  HCI,
  Platform,
  ProjectIdentity,
  ProjectLocal,
  ReleaseCapabilities,
} from '@shared'
import { collectProjectDependencySnapshots, resolveRelativeSource } from './ProjectDependencySnapshots'
import { ProjectHostModuleSession } from './ProjectHostModules'
import { validateManagedDependencyEnvironments } from './ProjectManagedDependencies'
import {
  type ProjectPlannedOutput,
  publishProjectOutputs,
  removeLegacyAdjacentContracts,
} from './ProjectOutputPublisher'
import { ProjectRefreshReceipt, type ProjectRefreshReceiptData } from './ProjectRefreshReceipt'
import type { ProjectToolingOptions, ProjectToolingResult, ProjectToolingService } from './ProjectTooling'
import { checkProjectTypeScriptWithConfigInputs, ProjectTypeScriptProgramSession } from './ProjectTypeScriptCheck'
import { findProjectRoot, writeProjectTypeScriptConfigUnderLock } from './ProjectTypeScriptConfig'

const revisions = new Map<string, number>()
const lastDependencyRoots = new Map<string, readonly string[]>()
const lastPrivatePackages = new Map<string, ReadonlySet<string>>()
const lastGoodResults = new Map<string, ProjectToolingResult>()
const typeScriptSessions = new Map<string, {
  references: number
  session: ProjectTypeScriptProgramSession
  hostModules: ProjectHostModuleSession
}>()
type WatchedWorkspaces = Map<string, Promise<Workspace>>

type ProjectToolingProfile = {
  time<Result>(name: string, action: () => Promise<Result>): Promise<Result>
  start(name: string): () => void
  reject(reason: string): void
  log(root?: string, status?: ProjectToolingResult['status'], revision?: number): void
}

function createProjectToolingProfile(): ProjectToolingProfile | undefined {
  if (Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] !== 'true') {
    return undefined
  }
  const startedAt = performance.now()
  const phases: Record<string, number> = {}
  const openPhases = new Map<number, { name: string; startedAt: number }>()
  let replayRejection: string | undefined
  let nextPhaseId = 0
  const finishPhase = (id: number): void => {
    const phase = openPhases.get(id)
    if (phase === undefined) {
      return
    }
    openPhases.delete(id)
    phases[phase.name] = (phases[phase.name] ?? 0) + performance.now() - phase.startedAt
  }
  return {
    async time<Result>(name: string, action: () => Promise<Result>): Promise<Result> {
      const phaseStartedAt = performance.now()
      try {
        return await action()
      } finally {
        phases[name] = (phases[name] ?? 0) + performance.now() - phaseStartedAt
      }
    },
    start(name) {
      const id = nextPhaseId++
      openPhases.set(id, { name, startedAt: performance.now() })
      return () => finishPhase(id)
    },
    reject(reason) {
      replayRejection ??= reason
    },
    log(root, status, revision) {
      for (const id of openPhases.keys()) {
        finishPhase(id)
      }
      HCI.logProcessInfo(
        'project-tooling',
        JSON.stringify({
          type: 'studio-project-tooling-profile',
          ...(root === undefined ? {} : { root }),
          ...(status === undefined ? {} : { status }),
          ...(revision === undefined ? {} : { revision }),
          ...(replayRejection === undefined ? {} : { replayRejection }),
          totalMs: performance.now() - startedAt,
          phases,
        }),
      )
    },
  }
}

function profileTime<Result>(
  profile: ProjectToolingProfile | undefined,
  name: string,
  action: () => Promise<Result>,
): Promise<Result> {
  return profile === undefined ? action() : profile.time(name, action)
}

/** ProjectTooling refreshes saved project files and owns their generated TypeScript publication. */
export const ProjectTooling: ProjectToolingService = {
  async refresh(inputRoot, options) {
    return await refreshProject(inputRoot, options)
  },
  async watch(root, options) {
    const projectRoot = await findProjectRoot(root) ?? FS.resolvePath(root)
    const { startProjectFileWatch } = await import('./ProjectFileWatch')
    const receipt = await FS.isDirectory(FS.resolvePath('.tao', projectRoot))
      ? new ProjectRefreshReceipt(projectRoot, (await Packages.createContext(projectRoot)).stdlibRoot)
      : undefined
    const retained = typeScriptSessions.get(projectRoot)
      ?? { references: 0, session: new ProjectTypeScriptProgramSession(), hostModules: new ProjectHostModuleSession() }
    retained.references += 1
    typeScriptSessions.set(projectRoot, retained)
    const workspaces: WatchedWorkspaces = new Map()
    const release = () => {
      receipt?.clear()
      workspaces.clear()
      retained.references -= 1
      if (retained.references === 0) {
        retained.session.clear()
        retained.hostModules.clear()
        typeScriptSessions.delete(projectRoot)
      }
    }
    try {
      const watch = await startProjectFileWatch(
        projectRoot,
        options,
        async requestOptions =>
          await refreshProject(projectRoot, options, receipt, requestOptions?.force, workspaces, retained.hostModules),
      )
      let disposal: Promise<void> | undefined
      return {
        get lastResult() {
          return watch.lastResult
        },
        requestRefresh: requestOptions => watch.requestRefresh(requestOptions),
        dispose() {
          disposal ??= watch.dispose().finally(release)
          return disposal
        },
      }
    } catch (error) {
      release()
      throw error
    }
  },
}

async function refreshProject(
  inputRoot: string,
  options: ProjectToolingOptions,
  receipt?: ProjectRefreshReceipt,
  force = false,
  workspaces?: WatchedWorkspaces,
  hostModuleSession?: ProjectHostModuleSession,
): Promise<ProjectToolingResult> {
  const profile = createProjectToolingProfile()
  let profileRoot: string | undefined
  let status: ProjectToolingResult['status'] | undefined
  let revision: number | undefined
  try {
    const root = await findProjectRoot(inputRoot) ?? FS.resolvePath(inputRoot)
    profileRoot = root
    if (force) {
      hostModuleSession?.clear()
    }
    const markerPath = FS.resolvePath('.tao', root)
    if (!await FS.isDirectory(markerPath)) {
      receipt?.clear()
      const config = await profileTime(profile, 'config', () => writeProjectTypeScriptConfigUnderLock(root, options))
      const missingProjectResult = result(
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
      status = missingProjectResult.status
      revision = missingProjectResult.revision
      return missingProjectResult
    }
    await ProjectLocal.prepare(root)
    const lockPath = ProjectLocal.cacheResolve('locks/ts-gen-lock', root)
    const refreshed = await FS.withFileMutationLock(
      lockPath,
      root,
      async () => {
        const session = typeScriptSessions.get(root)?.session
        if (force) {
          hostModuleSession?.clear()
        }
        const before = await profileTime(profile, 'audit-before', async () => await receipt?.audit(options, force))
        const auditChangedPaths: string[] = []
        const candidate = force
          ? undefined
          : await profileTime(profile, 'receipt-candidate', async () => await receipt?.candidate(before))
        if (candidate) {
          try {
            const reused = await profileTime(
              profile,
              'receipt-replay',
              () =>
                reuseReceipt(
                  root,
                  options,
                  candidate,
                  receipt!,
                  session,
                  auditChangedPaths,
                  profile,
                  hostModuleSession,
                ),
            )
            if (reused) {
              return reused
            }
          } catch {
            // An incomplete replay cannot establish equivalence. Let the authoritative
            // cold refresh produce the result or report the underlying failure.
            profile?.reject('replay-exception')
          }
        }
        receipt?.clear()
        return await profileTime(
          profile,
          'cold-refresh',
          () =>
            refreshUnderLock(
              root,
              options,
              session,
              receipt,
              before,
              auditChangedPaths,
              workspaces,
              profile,
              hostModuleSession,
            ),
        )
      },
    )
    if (refreshed.status === 'fresh') {
      lastGoodResults.set(root, refreshed)
    }
    status = refreshed.status
    revision = refreshed.revision
    return refreshed
  } catch (error) {
    receipt?.clear()
    throw error
  } finally {
    profile?.log(profileRoot, status, revision)
  }
}

async function refreshUnderLock(
  root: string,
  options: ProjectToolingOptions,
  typeScriptSession?: ProjectTypeScriptProgramSession,
  receipt?: ProjectRefreshReceipt,
  before?: Awaited<ReturnType<ProjectRefreshReceipt['audit']>>,
  auditChangedPaths: readonly string[] = [],
  workspaces?: WatchedWorkspaces,
  profile?: ProjectToolingProfile,
  hostModuleSession?: ProjectHostModuleSession,
): Promise<ProjectToolingResult> {
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
  const { sourcePaths, sourceOwners, entryPaths } = await profileTime(profile, 'source-discovery-owners', async () => {
    const sourcePaths = await discoverProjectTaoFiles(root)
    const sourceOwners = await Promise.all(sourcePaths.map(path => Packages.containingProjectRoot(FS.dirname(path))))
    return { sourcePaths, sourceOwners, entryPaths: sourcePaths.filter((_, index) => sourceOwners[index] === root) }
  })
  let diagnostics: Diagnostic[] = []
  let dependencyRoots: readonly string[] = lastDependencyRoots.get(root) ?? []
  let privatePackages = lastPrivatePackages.get(root) ?? new Set<string>()
  const externalSidecarInputs = new Set<string>()
  const sidecarOwnershipInputs = new Set<string>()
  const consumedTexts = new Map<string, string>()
  const sidecars = new Map<string, SidecarSourceGraphInspection>()
  let auditComplete = true
  let environments: readonly DependencyEnvironment[] = []
  let contextFingerprint: string | undefined
  const consume = (path: string, text: string): void => {
    const previous = consumedTexts.get(path)
    if (previous !== undefined && previous !== text) {
      auditComplete = false
    }
    consumedTexts.set(path, text)
  }
  const consumeFiles = (files: readonly { path: string; document: AST.Document }[]): void => {
    for (const file of files) {
      consume(file.path, file.document.textDocument.getText())
    }
  }
  let planned: ProjectPlannedOutput[] | undefined = []
  let finishPlanning: (() => void) | undefined
  if (entryPaths.length > 0) {
    const workspace = await openWorkspace(root, workspaces)
    let validation = await profileTime(profile, 'workspace-validation', () => workspace.validateFiles(entryPaths))
    consumeFiles(validation.files)
    diagnostics.push(...validation.diagnostics)
    if (Diagnostics.hasError(diagnostics)) {
      planned = undefined
    } else {
      const context = await profileTime(profile, 'package-context', () => Packages.createContext(root))
      contextFingerprint = ProjectRefreshReceipt.contextFingerprint(context)
      finishPlanning = profile?.start('project-graph-contract-planning')
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
        sidecars.set(sidecarRoot, inspected)
        for (const [path, text] of inspected.sourceTexts) {
          consume(path, text)
        }
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
      environments = [
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
        validation = await profileTime(
          profile,
          'workspace-validation',
          () => workspace.validateFiles([...entryPaths, ...missingSelected]),
        )
        consumeFiles(validation.files)
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
        const includeQuantityOwnerSources = async (): Promise<void> => {
          let expanded = true
          while (expanded && !Diagnostics.hasError(diagnostics)) {
            expanded = false
            const owners = validation.files.filter(file => contractSourcePaths.has(file.path))
              .flatMap(file => BridgeMetadata.quantityReferencedOwnersOf(file.ast))
            const pathsByRoot = new Map<string, Set<string>>()
            for (const owner of owners) {
              const path = AST.getDocument(owner).uri.path
              if (contractSourcePaths.has(path)) {
                continue
              }
              const projectRoot = Packages.projectRootForPath(context.index, path)
                ?? (FS.pathIsWithin(path, root)
                  ? root
                  : FS.pathIsWithin(path, context.stdlibRoot)
                  ? context.stdlibRoot
                  : undefined)
              Assert.defined(projectRoot, 'quantity owner belongs to an indexed project or standard library')
              const knownOrigin = [...origins.values()].find(origin => origin.projectRoot === projectRoot)
              Assert(
                projectRoot === root || projectRoot === context.stdlibRoot || knownOrigin !== undefined,
                'quantity dependency retains its known publication origin',
              )
              origins.set(path, privateSourceOrigin(path, knownOrigin ?? { projectRoot, modulePath: projectRoot }))
              contractSourcePaths.add(path)
              statementsBySourcePath.set(path, [])
              const paths = pathsByRoot.get(projectRoot) ?? new Set<string>()
              paths.add(path)
              pathsByRoot.set(projectRoot, paths)
              dependencyRoots = [...new Set([...dependencyRoots, projectRoot])]
              expanded = true
            }
            for (const [projectRoot, paths] of pathsByRoot) {
              const ownerValidation = await (await Workspace.open(projectRoot)).validateFiles([...paths])
              diagnostics.push(...ownerValidation.diagnostics)
              const files = new Map(validation.files.map(file => [file.path, file]))
              for (const file of ownerValidation.files) {
                files.set(file.path, file)
              }
              validation = { ...validation, files: [...files.values()] }
            }
          }
          lastDependencyRoots.set(root, dependencyRoots)
        }
        await includeQuantityOwnerSources()
        const collectContracts = () =>
          BridgeMetadata.collect(
            validation.files.filter(file => contractSourcePaths.has(file.path)),
            root,
            origins,
            { runtimeRoot: options.runtimeRoot, selectedStatementsBySourcePath: statementsBySourcePath },
          )
        let modules = Diagnostics.hasError(diagnostics) ? [] : collectContracts()
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
              const dependencyValidation = await profileTime(
                profile,
                'workspace-validation',
                async () => await (await openWorkspace(dependencyRoot, workspaces)).validateFiles(paths),
              )
              consumeFiles(dependencyValidation.files)
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
            await includeQuantityOwnerSources()
            modules = Diagnostics.hasError(diagnostics) ? [] : collectContracts()
            snapshots = await collectProjectDependencySnapshots(root, modules, origins)
          }
        }
        diagnostics.push(...snapshots.diagnostics)
        for (const [path, text] of snapshots.sourceTexts) {
          consume(path, text)
        }
        diagnostics.push(...validateSelectedPublicationImports(
          selected.publications,
          runtimeDeclarationsByPublication,
          snapshots,
        ))
        diagnostics.push(...await validateSelectedAppImports(root, graph.appRequirements))
        diagnostics.push(...await validateManagedDependencyEnvironments(root, environments))
        planned = Diagnostics.hasError(diagnostics) ? undefined : [
          ...modules.flatMap(module => [module, ...module.quantityModule === undefined ? [] : [module.quantityModule]])
            .map(module => ({
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
  finishPlanning?.()
  const config = await profileTime(
    profile,
    'config',
    () => writeProjectTypeScriptConfigUnderLock(root, options, privatePackages, hostModuleSession),
  )
  diagnostics.push(...config.diagnostics)
  const changedOutputPaths = [...auditChangedPaths, ...config.changedOutputPaths]
  const published = await profileTime(profile, 'output-publication', async () => {
    const published = await publishProjectOutputs(root, planned)
    changedOutputPaths.push(...published.changedOutputPaths)
    changedOutputPaths.push(...await removeLegacyAdjacentContracts(root))
    return published
  })
  const hasExternalSidecars = externalSidecarInputs.size > 0
    || (planned === undefined && (lastGoodResults.get(root)?.externalSidecarInputPaths.length ?? 0) > 0)
  if (hasExternalSidecars) {
    typeScriptSession?.clear()
  }
  const typeCheck = await profileTime(profile, 'native-typescript', () =>
    checkProjectTypeScriptWithConfigInputs(
      root,
      published.contractPaths,
      published.snapshotPaths,
      published.sourceMappings,
      options,
      hasExternalSidecars ? undefined : typeScriptSession,
    ))
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
  const refreshed = result(
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
  await profileTime(profile, 'receipt-remember', async () =>
    await receipt?.remember(before, options, {
      result: refreshed,
      nativeDiagnostics: typeCheck.diagnostics,
      published,
      planned: planned ?? [],
      environments,
      privatePackages,
      consumedTexts,
      sidecars,
      auditComplete,
      discovery: { sourcePaths, sourceOwners, entryPaths, contextFingerprint },
    }))
  return refreshed
}

async function openWorkspace(root: string, workspaces?: WatchedWorkspaces): Promise<Workspace> {
  if (!workspaces) {
    return await Workspace.open(root)
  }
  const key = JSON.stringify([root, ReleaseCapabilities.fingerprint()])
  let workspace = workspaces.get(key)
  if (!workspace) {
    workspace = Workspace.open(root).catch(error => {
      workspaces.delete(key)
      throw error
    })
    workspaces.set(key, workspace)
  }
  return await workspace
}

async function reuseReceipt(
  root: string,
  options: ProjectToolingOptions,
  candidate: ProjectRefreshReceiptData,
  receipt: ProjectRefreshReceipt,
  session: ProjectTypeScriptProgramSession | undefined,
  auditChangedPaths: string[],
  profile?: ProjectToolingProfile,
  hostModuleSession?: ProjectHostModuleSession,
): Promise<ProjectToolingResult | undefined> {
  await ProjectIdentity.ensure(root)
  for (const dependencyRoot of candidate.result.dependencyRoots) {
    if (dependencyRoot !== root) {
      await ProjectIdentity.ensure(dependencyRoot)
    }
  }
  if (candidate.discovery.contextFingerprint !== undefined || candidate.sidecars.size > 0) {
    const context = await Packages.createContext(root)
    if (
      candidate.discovery.contextFingerprint !== undefined
      && ProjectRefreshReceipt.contextFingerprint(context) !== candidate.discovery.contextFingerprint
    ) {
      profile?.reject('context-mismatch')
      return undefined
    }
    for (const [sidecarRoot, previous] of candidate.sidecars) {
      const current = inspectSidecarSourceGraph(sidecarRoot, {
        projectRoot: root,
        index: context.index,
        allowUnmarkedOutside: true,
      })
      if (
        JSON.stringify([
            current.sourcePaths,
            current.unresolvedCandidatePaths,
            current.ownershipInputPaths,
            current.diagnostics,
          ])
          !== JSON.stringify([
            previous.sourcePaths,
            previous.unresolvedCandidatePaths,
            previous.ownershipInputPaths,
            previous.diagnostics,
          ])
        || current.sourceTexts.size !== previous.sourceTexts.size
        || [...current.sourceTexts].some(([path, text]) => previous.sourceTexts.get(path) !== text)
      ) {
        profile?.reject('sidecar-input-mismatch')
        return undefined
      }
    }
  }
  if (Diagnostics.hasError(await validateManagedDependencyEnvironments(root, candidate.environments))) {
    profile?.reject('managed-dependency-errors')
    return undefined
  }
  // Host exports, requester overrides, automatic ambient names, and fallback roots are
  // rediscovered on every attempt; program observations alone do not cover this discovery.
  const config = await profileTime(
    profile,
    'config',
    () => writeProjectTypeScriptConfigUnderLock(root, options, candidate.privatePackages, hostModuleSession),
  )
  auditChangedPaths.push(...config.changedOutputPaths)
  if (config.changedOutputPaths.length > 0) {
    profile?.reject('config-changed')
    return undefined
  }
  if (Diagnostics.hasError(config.diagnostics)) {
    profile?.reject('config-errors')
    return undefined
  }
  const checked = await profileTime(profile, 'native-typescript', () =>
    checkProjectTypeScriptWithConfigInputs(
      root,
      candidate.published.contractPaths,
      candidate.published.snapshotPaths,
      candidate.published.sourceMappings,
      options,
      session,
    ))
  if (!checked.cacheHit) {
    profile?.reject('native-miss')
    return undefined
  }
  if (JSON.stringify(checked.diagnostics) !== JSON.stringify(candidate.nativeDiagnostics)) {
    profile?.reject('diagnostics-mismatch')
    return undefined
  }
  if (JSON.stringify(checked.configInputPaths) !== JSON.stringify(candidate.result.configInputPaths)) {
    profile?.reject('config-input-mismatch')
    return undefined
  }
  if (!await receipt.candidate(await receipt.audit(options))) {
    profile?.reject('final-receipt-mismatch')
    return undefined
  }
  return { ...candidate.result, changedOutputPaths: [] }
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
      const seeds = CompilerDependencies.taoSidecarValueDeclarations(
        target,
        edge,
        BridgeMetadata.quantitySurfaceFor(target),
      )
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

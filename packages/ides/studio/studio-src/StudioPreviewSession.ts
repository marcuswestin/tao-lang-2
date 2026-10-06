import { EmittedModuleCache } from '@compiler/compiler'
import { computeStudioDesignPaddingDelta } from '@compiler/studio-design-delta'
import { Workspace } from '@compiler/workspace'
import Runtime from '@expo-host'
import { ProjectTooling, type ProjectToolingResult, type ProjectToolingWatch } from '@project-tooling'
import { Assert, Errors, FS, HCI, Platform, Switch } from '@shared'
import SourceActions from '@source-actions'
import { createStudioBackgroundValidationScheduler } from './StudioBackgroundValidation'
import { studioPreviewFastGate } from './StudioPreviewEligibility'
import type {
  StudioParameterSchema,
  StudioPreviewManifestV2,
  StudioScenarioSubject,
  StudioTaoSource,
} from './StudioPreviewManifest'
import { StudioProjectSession, type StudioProjectSessionOptions } from './StudioProjectSession'
import { reactiveBrowserSchemeCapability, type StudioJsonObject, type StudioJsonValue } from './StudioProtocol'

export type OpenStudioPreviewSessionOptions = Omit<StudioProjectSessionOptions, 'compile'> & {
  previewPublication?: 'on' | 'off'
  experimentalPreviewFirst?: boolean
  previewRuntimeRoot: string
  validationMode?: 'development' | 'release'
}

export type StudioPreviewSession = {
  close: () => Promise<void>
  /** Explicit release for the diagnostic held-full-pass control. */
  releaseFullPass: () => Promise<void>
  session: StudioProjectSession
}

/** openStudioPreviewSession connects the serialized Studio compile lane to stable runtime publication. */
export async function openStudioPreviewSession(
  options: OpenStudioPreviewSessionOptions,
): Promise<StudioPreviewSession> {
  let session: StudioProjectSession | undefined
  let previewWorkspace: Workspace | undefined
  const emittedModuleCache = new EmittedModuleCache()
  const sourceChanges = new Map<string, { version: string; epoch: number }>()
  let toolingWatch: ProjectToolingWatch | undefined
  let toolingAcquisitions = 0
  let consumedToolingRevision = 0
  let deferredToolingResult: ProjectToolingResult | undefined
  let toolingInputEpoch = 0
  let consumedToolingInputEpoch = 0
  const pendingSourceInputs = new Set<string>()
  const previewFirstEnabled = options.experimentalPreviewFirst
    ?? Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_FIRST'] === 'true'
  const traceEnabled = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] === 'true'
  const fullPassMode = Platform.runtimeProcess.env['TAO_STUDIO_EXPERIMENT_FULL_PASS'] ?? 'immediate'
  Assert.input(
    fullPassMode === 'immediate' || fullPassMode === 'paused' || fullPassMode === 'after-paint',
    'Full-pass experiment must be immediate, paused or after-paint.',
  )
  const designDeliveryEnabled = previewFirstEnabled && fullPassMode === 'after-paint'
    && options.previewPublication === 'off' && Platform.runtimeProcess.env['TAO_STUDIO_DESIGN_DELIVERY'] === 'true'
  let fullPassPending = false
  let closing = false
  let lastFastRevision: number | undefined
  let lastPublishedRevision: number | undefined
  let previousDesignSource: string | undefined
  let designOverlayPending = false
  const trace = (event: string, values: Record<string, unknown> = {}) => {
    if (traceEnabled) {
      HCI.logProcessInfo('studio', JSON.stringify({ type: 'studio-preview-trace', at: Date.now(), event, ...values }))
    }
  }
  let heartbeatAt = Date.now()
  const heartbeat = traceEnabled
    ? setInterval(() => {
      const now = Date.now()
      const lagMs = now - heartbeatAt - 100
      heartbeatAt = now
      if (lagMs > 50) {
        trace('event-loop-lag', { lagMs })
      }
    }, 100)
    : undefined
  const releaseFullPass = async () => {
    if (!fullPassPending || session === undefined) {
      return
    }
    backgroundScheduler.complete()
    fullPassPending = false
    trace('full-pass-released')
    await session.compileInitial()
  }
  const backgroundScheduler = createStudioBackgroundValidationScheduler({
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    cancelTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onRelease: () => {
      void releaseFullPass().catch(error => HCI.logProcessError('studio-background', Errors.formatForLog(error)))
    },
  })
  trace('settings', {
    previewFirstEnabled,
    fullPassMode,
    changedValidation: Platform.runtimeProcess.env['TAO_STUDIO_CHANGED_VALIDATION'] === 'true',
    sourceReadReuse: Platform.runtimeProcess.env['TAO_STUDIO_REUSE_SOURCE_READS'] === 'true',
    nativeInspectionReuse: Platform.runtimeProcess.env['TAO_STUDIO_FAST_BINDING_INSPECTION'] === 'true',
    requestedFastHmr: Platform.runtimeProcess.env['TAO_STUDIO_FAST_HMR'],
    requestedFastFileMap: Platform.runtimeProcess.env['TAO_STUDIO_FAST_FILE_MAP'],
    publication: options.previewPublication ?? 'on',
    nodeEnv: Platform.runtimeProcess.env['NODE_ENV'],
  })
  if (previewFirstEnabled) {
    HCI.logProcessInfo(
      'studio',
      `Preview speed experiment: preview-first; full pass ${fullPassMode}; `
        + `design delivery ${designDeliveryEnabled ? 'enabled' : 'disabled'}; `
        + `whole-document replay ${
          Platform.runtimeProcess.env['TAO_STUDIO_CHANGED_VALIDATION'] === 'true' ? 'enabled' : 'disabled'
        }; `
        + `source-read reuse ${
          Platform.runtimeProcess.env['TAO_STUDIO_REUSE_SOURCE_READS'] === 'true' ? 'enabled' : 'disabled'
        }; `
        + `native inspection reuse ${
          Platform.runtimeProcess.env['TAO_STUDIO_FAST_BINDING_INSPECTION'] === 'true' ? 'enabled' : 'disabled'
        }; `
        + `publication ${options.previewPublication ?? 'on'}. Browser development mode is independent of NODE_ENV.`,
    )
  }
  const profileEnabled = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] === 'true' || traceEnabled
  const profileNow = () => profileEnabled ? performance.now() : 0
  function compileToolingChange(result: ProjectToolingResult): void {
    if (closing || result.revision <= consumedToolingRevision) {
      return
    }
    if (fullPassMode !== 'immediate') {
      fullPassPending = true
      return
    }
    void session?.compileInitial().catch(error =>
      HCI.logProcessError('studio-project-tooling', Errors.formatForLog(error))
    )
  }
  session = await StudioProjectSession.open({
    ...options,
    experimentalEnsurePublishedPreview: async () => {
      if (!designOverlayPending) {
        return
      }
      // A fresh realm cannot inherit an overlay held only by existing preview runtimes.
      // Publish authoritative bytes before registering it. The caller's old identity
      // remains subject to normal stale-manifest rejection and the fresh matrix event.
      trace('overlay-publication-barrier', { revision: lastFastRevision })
      Assert.defined(session, 'the Studio session exists before registering a preview')
      const completion = await session.compileInitial()
      Assert.input(completion.status === 'compiled', completion.message)
    },
    async compile(request) {
      Assert.defined(session, 'the Tao Studio project session to exist before its first compile')
      Assert.defined(toolingWatch, 'the project tooling watch exists before preview compilation')
      const startedAt = profileNow()
      const feedSources = session.feedSourceOverrides()
      const sourceOverrides = feedSources === undefined ? undefined : Object.freeze({ ...feedSources })
      const files = await session.files()
      const sourceVersions = Object.fromEntries(files.map(file => [file.path, file.sourceVersion]))
      for (const [path, source] of Object.entries(sourceOverrides ?? {})) {
        sourceVersions[FS.relativePath(request.project, path)] = SourceActions.studioSourceVersion(source)
      }
      // A tooling watcher can precede Studio's source watcher. Read its pending inputs so
      // an unconsumed second edit cannot be mistaken for an isolated editor save.
      const pendingInputs = [...pendingSourceInputs]
      pendingSourceInputs.clear()
      for (const path of pendingInputs) {
        const absolute = FS.resolvePath(path, request.project)
        if (await FS.isFile(absolute)) {
          sourceVersions[path] = SourceActions.studioSourceVersion(await FS.readText(absolute))
        } else {
          delete sourceVersions[path]
        }
      }
      const changedSourcePaths = Object.keys(sourceVersions).filter(path =>
        sourceChanges.get(path)?.version !== sourceVersions[path]
      )
      const requestedPath = request.changes.length === 1
        ? FS.relativePath(request.project, FS.resolvePath(request.changes[0]!.path, request.project))
        : undefined
      const fastGate = studioPreviewFastGate({
        enabled: previewFirstEnabled,
        request,
        requestedPath,
        sourceVersions,
        consumedSources: sourceChanges,
        freshTooling: toolingWatch.lastResult.status === 'fresh',
        currentToolingInputs: toolingInputEpoch === consumedToolingInputEpoch,
      })
      const previewFirst = Object.values(fastGate).every(Boolean)
      trace('attempt-start', {
        revision: request.compileRevision,
        causes: request.causes,
        changes: request.changes,
        queueMs: request.queuedAt === undefined ? undefined : Date.now() - request.queuedAt,
        previewFirst,
        fastGate,
      })
      if (previewFirst) {
        fullPassPending = true
        if (fullPassMode === 'after-paint') {
          backgroundScheduler.request(request.compileRevision)
        }
        if (fullPassMode === 'immediate') {
          fullPassPending = false
          void session.compileInitial().catch(error =>
            HCI.logProcessError('studio-preview-first', Errors.formatForLog(error))
          )
        }
      }
      let tooling = toolingWatch.lastResult
      if (!previewFirst) {
        // An authoritative attempt consumes pending background work for this input.
        // Keeping its old deadline would enqueue a redundant second full pass.
        backgroundScheduler.complete()
        fullPassPending = false
        toolingAcquisitions += 1
        try {
          const inputEpoch = toolingInputEpoch
          tooling = await toolingWatch.requestRefresh()
          consumedToolingRevision = tooling.revision
          consumedToolingInputEpoch = inputEpoch
        } finally {
          toolingAcquisitions -= 1
          if (toolingAcquisitions === 0 && deferredToolingResult !== undefined) {
            const deferred = deferredToolingResult
            deferredToolingResult = undefined
            compileToolingChange(deferred)
          }
        }
      }
      if (tooling.status !== 'fresh') {
        Errors.throwUserInput(
          tooling.diagnostics.map(diagnostic => diagnostic.message).join('\n')
            || 'Project tooling is stale; keeping the last working preview.',
        )
      }
      const toolingDoneAt = profileNow()
      const sourceEpochs: Record<string, number> = {}
      for (const [path, version] of Object.entries(sourceVersions)) {
        const previous = sourceChanges.get(path)
        const epoch = previous?.version === version ? previous.epoch : request.compileRevision
        sourceChanges.set(path, { version, epoch })
        sourceEpochs[path] = epoch
      }
      for (const path of sourceChanges.keys()) {
        if (!(path in sourceVersions)) {
          sourceChanges.delete(path)
        }
      }
      const designPath = FS.resolvePath('Design.tao', request.project)
      const designSource = designDeliveryEnabled && await FS.isFile(designPath)
        ? await FS.readText(designPath)
        : undefined
      const directDesign = previewFirst && fullPassMode === 'after-paint' && options.previewPublication === 'off'
          && Platform.runtimeProcess.env['TAO_STUDIO_DESIGN_DELIVERY'] === 'true'
          && changedSourcePaths.length === 1 && changedSourcePaths[0] === 'Design.tao'
          && previousDesignSource !== undefined && designSource !== undefined && lastPublishedRevision !== undefined
          && toolingInputEpoch === consumedToolingInputEpoch
          && ![...pendingSourceInputs].some(path => path !== 'Design.tao')
          && SourceActions.studioSourceVersion(designSource) === sourceVersions['Design.tao']
        ? computeStudioDesignPaddingDelta(previousDesignSource, designSource)
        : undefined
      previousDesignSource = designSource
      if (directDesign !== undefined) {
        designOverlayPending = true
        lastFastRevision = request.compileRevision
        session.experimentalDesignPadding({
          ...directDesign,
          revision: request.compileRevision,
          sourcePath: designPath,
        })
        trace('design-delivered', { revision: request.compileRevision, sourceVersions, ...directDesign })
        return {
          message: `Delivered experimental padding revision ${request.compileRevision}.`,
          publishedRevision: lastPublishedRevision,
        }
      }
      const sourcesDoneAt = profileNow()
      previewWorkspace ??= await Workspace.open(request.project)
      const workspaceDoneAt = profileNow()
      const generated = await Runtime.generateApp(session.entryPath, {
        appName: request.appName,
        preview: {
          experimentalChangedSourcePaths: previewFirst
            ? changedSourcePaths.map(path => FS.resolvePath(path, request.project))
            : undefined,
          publicationChecks: options.previewPublication !== 'off',
          project: request.project,
          revision: request.compileRevision,
          sourceOverrides,
          sourceVersions,
          sourceEpochs,
        },
        runtimePackageRoot: options.previewRuntimeRoot,
        validationMode: options.validationMode,
        previewWorkspace,
        emittedModuleCache,
      }).catch(error => {
        // No child can acknowledge a failed fast result. Do not leave diagnostics
        // recovery waiting for the paint deadline that can never be satisfied.
        if (previewFirst && fullPassMode === 'after-paint') {
          void releaseFullPass().catch(fullError =>
            HCI.logProcessError('studio-background', Errors.formatForLog(fullError))
          )
        }
        throw error
      })
      designOverlayPending = false
      lastPublishedRevision = generated.preview?.revision
      if (previewFirst) {
        lastFastRevision = generated.preview?.revision
      }
      trace('published', {
        sourceVersions: generated.preview?.sourceVersions,
        changes: request.changes,
        revision: request.compileRevision,
        publishedRevision: generated.preview?.revision,
        skipped: generated.previewPublicationSkipped,
        previewFirst,
      })
      if (profileEnabled) {
        const generatedAt = profileNow()
        HCI.logProcessInfo(
          'studio',
          JSON.stringify({
            type: 'studio-preview-pipeline-profile',
            revision: request.compileRevision,
            toolingRevision: tooling.revision,
            previewFirst,
            toolingMs: toolingDoneAt - startedAt,
            sourceSnapshotMs: sourcesDoneAt - toolingDoneAt,
            workspaceOpenMs: workspaceDoneAt - sourcesDoneAt,
            generateAppMs: generatedAt - workspaceDoneAt,
            totalMs: generatedAt - startedAt,
          }),
        )
      }
      if (generated.emittedModuleCache !== undefined) {
        const { hits, misses, files: emitted } = generated.emittedModuleCache
        HCI.logProcessInfo(
          'studio',
          JSON.stringify({
            type: 'studio-emitted-module-cache',
            revision: request.compileRevision,
            previewFirst,
            hits,
            misses,
            emitMs: emitted.reduce((sum, file) => sum + file.emitMs, 0),
            totalMs: emitted.reduce((sum, file) => sum + file.totalMs, 0),
          }),
        )
      }
      if (
        generated.previewPublicationSkipped !== true
        && generated.studioManifest !== undefined && generated.preview !== undefined
      ) {
        session.setMatrixManifest(matrixManifest(session, generated, request.compileRevision))
      }
      return {
        message: `Compiled ${request.appName} preview revision ${request.compileRevision}.`,
        ...(generated.previewPublicationSkipped === true && generated.preview !== undefined
          ? { publishedRevision: generated.preview.revision }
          : {}),
      }
    },
  })
  let watchReady = false
  toolingWatch = await ProjectTooling.watch(session.projectRoot, {
    automaticRefresh: fullPassMode === 'immediate',
    hostModulesRoot: FS.resolvePath('node_modules', options.previewRuntimeRoot),
    onInputChange: change => {
      if (!watchReady || closing || fullPassMode === 'immediate') {
        return
      }
      const relative = change.path === undefined ? undefined : FS.relativePath(session!.projectRoot, change.path)
      if (change.event === 'change' && relative !== undefined && sourceChanges.has(relative)) {
        pendingSourceInputs.add(relative)
        return
      }
      // Config, dependencies, source graph and native inventory changes revoke cached
      // tooling eligibility. They must refresh even when no editor save follows.
      toolingInputEpoch += 1
      fullPassPending = true
      void releaseFullPass().catch(error => HCI.logProcessError('studio-background', Errors.formatForLog(error)))
    },
    onError: error => HCI.logProcessError('studio-project-tooling', Errors.formatForLog(error)),
    onResult: result => {
      if (!watchReady || result.status !== 'fresh' || result.changedOutputPaths.length === 0) {
        return
      }
      if (toolingAcquisitions > 0) {
        deferredToolingResult = result
        return
      }
      compileToolingChange(result)
    },
  })
  session.experimentalPreviewPaint = fullPassMode !== 'after-paint' ? undefined : (revision, painted = true) => {
    if (closing || !fullPassPending || revision !== lastFastRevision) {
      return false
    }
    if (!painted) {
      previousDesignSource = undefined
      trace('design-delivery-rejected', { revision })
      void releaseFullPass().catch(error => HCI.logProcessError('studio-background', Errors.formatForLog(error)))
      return true
    }
    trace('fast-paint-observed', { revision })
    backgroundScheduler.painted(revision)
    return true
  }
  watchReady = true
  return {
    releaseFullPass,
    async close() {
      closing = true
      backgroundScheduler.complete()
      if (heartbeat !== undefined) {
        clearInterval(heartbeat)
      }
      try {
        await releaseFullPass()
      } finally {
        backgroundScheduler.close()
        await toolingWatch?.dispose()
        await Runtime.resetStudioPreviewSession({ runtimePackageRoot: options.previewRuntimeRoot })
      }
    },
    session,
  }
}

/** matrixManifest adapts compiler-owned Tao source metadata into the versioned Studio cell contract. */
function matrixManifest(
  session: Pick<StudioProjectSession, 'appName' | 'entryPath' | 'projectRoot'>,
  generated: Awaited<ReturnType<typeof Runtime.generateApp>>,
  compileRevision: number,
): StudioPreviewManifestV2 {
  const compiler = generated.studioManifest
  const publication = generated.preview
  Assert.defined(compiler, 'a Studio manifest on the compilation behind a Tao Studio matrix manifest')
  Assert.defined(publication, 'a preview publication on the compilation behind a Tao Studio matrix manifest')
  const previewScenarios = compiler.scenarios.filter(scenario =>
    scenario.subject.kind !== 'app' || scenario.subject.appName === session.appName
  )
  validatePreviewScenarios(previewScenarios)
  const subjects: StudioScenarioSubject[] = [
    ...compiler.apps.map(app => ({
      appName: app.name,
      kind: 'app' as const,
      source: taoSource(app.source),
      subjectId: app.id,
    })),
    ...compiler.views.map(view => ({
      kind: 'view' as const,
      source: taoSource(view.source),
      subjectId: view.id,
      viewName: view.name,
    })),
  ]
  const parametersBySubject: Record<string, readonly StudioParameterSchema[]> = Object.fromEntries([
    ...compiler.apps.map(app => [app.id, []] as const),
    ...compiler.views.map(view =>
      [
        view.id,
        view.parameters.map(parameter => ({
          label: parameter.name,
          parameterId: parameter.name,
          required: parameter.required,
          type: parameterType(parameter),
        })),
      ] as const
    ),
  ])
  const scenarios = previewScenarios.map(scenario => ({
    args: scenario.subject.kind === 'view'
      ? jsonObject(scenario.subject.arguments)
      : {},
    ...(scenario.fixtureId === undefined ? {} : { fixtureId: scenario.fixtureId }),
    group: scenario.group,
    label: scenario.name,
    prepare: scenario.prepare.map(update => jsonObject(update)),
    scenarioId: scenario.id,
    source: taoSource(scenario.source),
    stateLayers: [],
    steps: scenario.steps,
    subjectId: scenario.subject.subjectId,
  }))
  return {
    capabilities: {
      captureDomains: ['action-history', 'data', 'environment', 'navigation', 'persisted-state', 'scheme'],
      scheme: reactiveBrowserSchemeCapability,
    },
    cells: previewScenarios.map(scenario => ({
      args: scenario.subject.kind === 'view' ? jsonObject(scenario.subject.arguments) : {},
      cellId: `${scenario.id}#cell`,
      cellRevision: 0,
      environment: {
        network: {
          latencyMs: 0,
          outcome: scenario.environment.network === 'offline' ? 'offline' : 'normal',
        },
        scheme: {
          capability: reactiveBrowserSchemeCapability,
          requested: scenario.environment.appearance ?? 'system',
          resolved: scenario.environment.appearance ?? 'light',
          source: scenario.environment.appearance === undefined ? 'system' : 'scenario',
        },
        viewport: {
          height: scenario.environment.device.height,
          presetId: scenario.environment.device.preset,
          width: scenario.environment.device.width,
        },
      },
      scenarioId: scenario.id,
      stateLayers: [],
    })),
    compileRevision,
    fixtures: compiler.fixtures.map(fixture => ({
      fixtureId: fixture.id,
      label: fixture.name,
      plan: jsonObject({
        accounts: fixture.accounts,
        creates: fixture.creates,
        ...(fixture.signedIn === undefined ? {} : { signedIn: fixture.signedIn }),
      }),
      source: taoSource(fixture.source),
    })),
    generationDeclarations: compiler.generationDeclarations,
    manifestRevision: `compile:${compileRevision}`,
    parametersBySubject,
    project: {
      appName: session.appName,
      entryPath: session.entryPath,
      root: session.projectRoot,
    },
    renders: compiler.renders.map(render => ({
      ...render,
      source: taoSource(render.source),
    })),
    scenarios,
    sourceVersions: publication.sourceVersions,
    states: [],
    subjects,
    version: 2,
  }
}

function validatePreviewScenarios(
  scenarios: NonNullable<
    Awaited<ReturnType<typeof Runtime.generateApp>>['studioManifest']
  >['scenarios'],
): void {
  for (const scenario of scenarios) {
    if (scenario.subject.kind !== 'app') {
      continue
    }
    if (scenario.subject.destination !== undefined) {
      Errors.throwUserInput(
        `Tao Studio cannot run ${scenario.subject.appName} at destination ${scenario.subject.destination} yet. Remove the destination until destination routing is supported.`,
      )
    }
  }
}

/** One parameter as the compiler publishes it, before Studio narrows it to its own schema. */
type StudioCompilerParameter = NonNullable<
  Awaited<ReturnType<typeof Runtime.generateApp>>['studioManifest']
>['views'][number]['parameters'][number]

function parameterType(parameter: StudioCompilerParameter): StudioParameterSchema['type'] {
  return Switch.kind<StudioCompilerParameter, StudioParameterSchema['type']>(parameter, {
    boolean: () => ({ kind: 'boolean' }),
    choice: () => ({ kind: 'choice', values: parameter.choices ?? [] }),
    entity: () => ({ entity: parameter.entity ?? parameter.typeName, kind: 'json' }),
    number: () => ({ kind: 'number' }),
    text: () => ({ kind: 'text' }),
    time: () => ({ kind: 'time' }),
    // A shape Studio has no editor for still renders; its value is carried as opaque JSON.
    unsupported: () => ({ kind: 'json' }),
  })
}

function taoSource(source: { end: number; path: string; start: number }): StudioTaoSource {
  return { kind: 'tao', path: source.path, range: { end: source.end, start: source.start } }
}

function jsonObject(value: unknown): StudioJsonObject {
  Assert.is(value, isJsonObject, 'the compiler to emit JSON Studio metadata')
  return value
}

function isJsonObject(value: unknown): value is StudioJsonObject {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is StudioJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  return isJsonObject(value)
}

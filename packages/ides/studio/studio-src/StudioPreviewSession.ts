import { EmittedModuleCache } from '@compiler/compiler'
import { Workspace } from '@compiler/workspace'
import Runtime from '@expo-host'
import { Assert, Errors, FS, HCI, Switch } from '@shared'
import SourceActions from '@source-actions'
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
  previewRuntimeRoot: string
  validationMode?: 'development' | 'release'
}

export type StudioPreviewSession = {
  close: () => Promise<void>
  session: StudioProjectSession
}

/** openStudioPreviewSession connects the serialized Studio compile lane to stable runtime publication. */
export async function openStudioPreviewSession(
  options: OpenStudioPreviewSessionOptions,
): Promise<StudioPreviewSession> {
  let session: StudioProjectSession | undefined
  let previewWorkspace: Workspace | undefined
  let previewWorkspaceFiles: string | undefined
  const emittedModuleCache = new EmittedModuleCache()
  const sourceChanges = new Map<string, { version: string; epoch: number }>()
  session = await StudioProjectSession.open({
    ...options,
    async compile(request) {
      Assert.defined(session, 'the Tao Studio project session to exist before its first compile')
      const feedSources = session.feedSourceOverrides()
      const sourceOverrides = feedSources === undefined ? undefined : Object.freeze({ ...feedSources })
      const files = await session.files()
      const sourceVersions = Object.fromEntries(files.map(file => [file.path, file.sourceVersion]))
      for (const [path, source] of Object.entries(sourceOverrides ?? {})) {
        sourceVersions[FS.relativePath(request.project, path)] = SourceActions.studioSourceVersion(source)
      }
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
      if (sourceOverrides === undefined) {
        // A workspace indexes the project's `@` packages when it opens, so a Tao file added, removed,
        // or renamed (a new package above all) needs a fresh one. Edits to known files reuse it.
        const filePaths = files.map(file => file.path).toSorted().join('\n')
        if (previewWorkspace === undefined || filePaths !== previewWorkspaceFiles) {
          previewWorkspace = await Workspace.open(request.project)
          previewWorkspaceFiles = filePaths
        }
      }
      const generated = await Runtime.generateApp(session.entryPath, {
        appName: request.appName,
        preview: {
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
      })
      if (generated.emittedModuleCache !== undefined) {
        const { hits, misses, files: emitted } = generated.emittedModuleCache
        HCI.logProcessInfo(
          'studio',
          JSON.stringify({
            type: 'studio-emitted-module-cache',
            revision: request.compileRevision,
            hits,
            misses,
            emitMs: emitted.reduce((sum, file) => sum + file.emitMs, 0),
            totalMs: emitted.reduce((sum, file) => sum + file.totalMs, 0),
          }),
        )
      }
      if (generated.studioManifest !== undefined && generated.preview !== undefined) {
        session.setMatrixManifest(matrixManifest(session, generated, request.compileRevision))
      }
      return { message: `Compiled ${request.appName} preview revision ${request.compileRevision}.` }
    },
  })
  return {
    async close() {
      await Runtime.resetStudioPreviewSession({ runtimePackageRoot: options.previewRuntimeRoot })
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

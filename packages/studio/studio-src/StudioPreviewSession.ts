import Runtime from '@runtime-toolchain'
import type {
  StudioParameterSchema,
  StudioPreviewManifestV1,
  StudioScenarioSubject,
  StudioTaoSource,
} from './StudioPreviewManifest'
import { StudioProjectSession, type StudioProjectSessionOptions } from './StudioProjectSession'
import type { StudioJsonObject, StudioJsonValue } from './StudioProtocol'

export type OpenStudioPreviewSessionOptions = Omit<StudioProjectSessionOptions, 'compile'> & {
  previewRuntimeRoot: string
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
  session = await StudioProjectSession.open({
    ...options,
    async compile(request) {
      if (session === undefined) {
        throw new Error('Tao Studio project session is not ready to compile.')
      }
      const files = await session.files()
      const generated = await Runtime.generateApp(session.entryPath, {
        appName: request.appName,
        preview: {
          project: request.project,
          revision: request.compileRevision,
          sourceVersions: Object.fromEntries(files.map(file => [file.path, file.sourceVersion])),
        },
        runtimePackageRoot: options.previewRuntimeRoot,
      })
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
export function matrixManifest(
  session: Pick<StudioProjectSession, 'appName' | 'entryPath' | 'projectRoot'>,
  generated: Awaited<ReturnType<typeof Runtime.generateApp>>,
  compileRevision: number,
): StudioPreviewManifestV1 {
  const compiler = generated.studioManifest
  const publication = generated.preview
  if (compiler === undefined || publication === undefined) {
    throw new Error('Tao Studio matrix manifests require a preview compilation.')
  }
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
  const scenarios = compiler.scenarios.map(scenario => ({
    args: scenario.subject.kind === 'view'
      ? jsonObject(scenario.subject.arguments)
      : {},
    fixtureId: scenario.fixtureId,
    label: scenario.name,
    prepare: scenario.prepare.map(update => jsonObject(update)),
    scenarioId: scenario.id,
    source: taoSource(scenario.source),
    stateLayers: [],
    subjectId: scenario.subject.subjectId,
  }))
  return {
    capabilities: { captureDomains: ['data'], scheme: 'inert' },
    cells: compiler.scenarios.map(scenario => ({
      args: scenario.subject.kind === 'view' ? jsonObject(scenario.subject.arguments) : {},
      cellId: `${scenario.id}#cell`,
      cellRevision: 0,
      environment: {
        network: {
          latencyMs: 0,
          outcome: scenario.environment.network === 'offline' ? 'offline' : 'normal',
        },
        scheme: {
          requested: scenario.environment.appearance ?? 'light',
          status: 'inert',
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
      plan: jsonObject({ accounts: fixture.accounts, creates: fixture.creates }),
      source: taoSource(fixture.source),
    })),
    manifestRevision: `compile:${compileRevision}`,
    parametersBySubject,
    project: {
      appName: session.appName,
      entryPath: session.entryPath,
      root: session.projectRoot,
    },
    scenarios,
    sourceVersions: publication.sourceVersions,
    states: [],
    subjects,
    version: 1,
  }
}

function parameterType(
  parameter: NonNullable<
    Awaited<ReturnType<typeof Runtime.generateApp>>['studioManifest']
  >['views'][number]['parameters'][number],
): StudioParameterSchema['type'] {
  if (parameter.kind === 'choice') {
    return { kind: 'choice', values: parameter.choices ?? [] }
  }
  if (parameter.kind === 'unsupported') {
    return { kind: 'json' }
  }
  return { kind: parameter.kind }
}

function taoSource(source: { end: number; path: string; start: number }): StudioTaoSource {
  return { kind: 'tao', path: source.path, range: { end: source.end, start: source.start } }
}

function jsonObject(value: unknown): StudioJsonObject {
  if (!isJsonObject(value)) {
    throw new Error('Compiler emitted non-JSON Studio metadata.')
  }
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

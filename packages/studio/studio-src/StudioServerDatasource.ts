import { FS } from '@shared'
import type { StudioCompileDiagnostic } from './StudioCompileCoordinator'
import type { StudioPreviewManifestV2, StudioScenarioSubject } from './StudioPreviewManifest'
import type {
  StudioCheckpointSummary,
  StudioProjectSession,
  StudioSessionEvent,
} from './StudioProjectSession'

export type StudioServerEntityName = 'Checkpoints' | 'Files' | 'Scenarios' | 'Screens' | 'Views'

export type StudioServerDiagnosticRow = {
  Id: string
  Message: string
  Source: 'compile' | 'draft'
}

export type StudioServerFileRow = {
  DiagnosticCount: number
  Diagnostics: readonly StudioServerDiagnosticRow[]
  Dirty: boolean
  Folder: boolean
  Id: string
  Name: string
  ParentPath: string
  Path: string
  Version: string
}

export type StudioServerScreenRow = {
  Id: string
  Name: string
  SourcePath: string
}

export type StudioServerViewRow = {
  Id: string
  Name: string
  RequiredParameters: readonly string[]
  SourcePath: string
}

export type StudioServerScenarioRow = {
  FixtureId: string
  Group: string
  Id: string
  Name: string
  SourcePath: string
  SubjectId: string
}

export type StudioServerCheckpointRow = {
  AfterVersion: string
  BeforeVersion: string
  Id: string
  Path: string
  Status: StudioCheckpointSummary['status']
}

export type StudioServerEntityRow =
  | StudioServerCheckpointRow
  | StudioServerFileRow
  | StudioServerScenarioRow
  | StudioServerScreenRow
  | StudioServerViewRow

export type StudioServerFillRequest = {
  entity: StudioServerEntityName
  where?: Readonly<Record<string, boolean | number | string>>
}

export type StudioServerFillResult = {
  entity: StudioServerEntityName
  revision: number
  rows: readonly StudioServerEntityRow[]
}

export type StudioServerInvalidation = {
  entities: readonly StudioServerEntityName[]
  revision: number
}

/**
 * StudioServerDatasource is the read-only strangler boundary for Tao panels.
 * It deliberately publishes query rows and invalidations rather than pretending the runtime's
 * current full-snapshot provider protocol can mark individual fill queries stale.
 */
export class StudioServerDatasource {
  readonly #listeners = new Set<(invalidation: StudioServerInvalidation) => void>()
  readonly #session: StudioProjectSession
  readonly #unsubscribe: () => void
  #revision = 0

  constructor(session: StudioProjectSession) {
    this.#session = session
    this.#unsubscribe = session.subscribe(event => this.#invalidateFor(event))
  }

  close(): void {
    this.#unsubscribe()
    this.#listeners.clear()
  }

  async fill(request: StudioServerFillRequest): Promise<StudioServerFillResult> {
    const rows = await this.#rows(request.entity)
    return {
      entity: request.entity,
      revision: this.#revision,
      rows: filterRows(rows, request.where),
    }
  }

  subscribe(listener: (invalidation: StudioServerInvalidation) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async #rows(entity: StudioServerEntityName): Promise<readonly StudioServerEntityRow[]> {
    if (entity === 'Files') {
      return await fileRows(this.#session)
    }
    if (entity === 'Checkpoints') {
      return checkpointRows(this.#session.checkpoints())
    }
    const manifest = this.#session.previewManifest()
    if (manifest === undefined) {
      return []
    }
    if (entity === 'Screens') {
      return screenRows(manifest)
    }
    if (entity === 'Views') {
      return viewRows(manifest)
    }
    return scenarioRows(manifest)
  }

  #invalidateFor(event: StudioSessionEvent): void {
    const entities = studioServerEntitiesForEvent(event)
    if (entities.length === 0) {
      return
    }
    this.#revision += 1
    const invalidation = { entities, revision: this.#revision }
    for (const listener of this.#listeners) {
      listener(invalidation)
    }
  }
}

/** Maps the session event stream to the query families a StudioServer mirror must refresh. */
export function studioServerEntitiesForEvent(event: StudioSessionEvent): readonly StudioServerEntityName[] {
  return event.type === 'file-changed' || event.type === 'files-changed'
    ? ['Files']
    : event.type === 'compile-state'
    ? ['Files']
    : event.type === 'preview-manifest-changed'
    ? ['Scenarios', 'Screens', 'Views']
    : event.type === 'checkpoint-changed'
    ? ['Checkpoints']
    : []
}

async function fileRows(session: StudioProjectSession): Promise<StudioServerFileRow[]> {
  const compileDiagnostics = session.compileSnapshot().diagnostics
  const files = await Promise.all((await session.files()).map(async file => {
    const draft = session.fileDraftState(file.path)
    const diagnostics = [
      ...diagnosticsForFile(compileDiagnostics, session.projectRoot, file.path),
      ...draft.diagnostics.map((message, index) => ({
        Id: `${file.path}#draft:${index}`,
        Message: message,
        Source: 'draft' as const,
      })),
    ]
    return {
      DiagnosticCount: diagnostics.length,
      Diagnostics: diagnostics,
      Dirty: draft.dirty,
      Folder: false,
      Id: file.path,
      Name: pathName(file.path),
      ParentPath: parentPath(file.path),
      Path: file.path,
      Version: file.sourceVersion,
    }
  }))
  const folders = new Set<string>()
  for (const file of files) {
    let parent = file.ParentPath
    while (parent !== '') {
      folders.add(parent)
      parent = parentPath(parent)
    }
  }
  return [
    ...[...folders].sort().map(path => ({
      DiagnosticCount: 0,
      Diagnostics: [],
      Dirty: false,
      Folder: true,
      Id: `$folder:${path}`,
      Name: pathName(path),
      ParentPath: parentPath(path),
      Path: path,
      Version: '',
    })),
    ...files,
  ].sort((left, right) => left.Path.localeCompare(right.Path) || Number(right.Folder) - Number(left.Folder))
}

function pathName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? '' : path.slice(0, separator)
}

function diagnosticsForFile(
  diagnostics: readonly StudioCompileDiagnostic[],
  projectRoot: string,
  path: string,
): StudioServerDiagnosticRow[] {
  return diagnostics.flatMap((diagnostic, index) => {
    const diagnosticPath = diagnostic.filePath === undefined
      ? undefined
      : relativeProjectPath(projectRoot, diagnostic.filePath)
    return diagnosticPath === path
      ? [{ Id: `${path}#compile:${index}`, Message: diagnostic.message, Source: 'compile' as const }]
      : []
  })
}

function relativeProjectPath(projectRoot: string, path: string): string | undefined {
  const absolute = FS.resolvePath(path, projectRoot)
  return FS.pathIsWithin(absolute, projectRoot) ? FS.relativePath(projectRoot, absolute) : undefined
}

function screenRows(manifest: StudioPreviewManifestV2): StudioServerScreenRow[] {
  return manifest.subjects.filter(subject => subject.kind === 'app').map(subject => ({
    Id: subject.subjectId,
    Name: subject.appName,
    SourcePath: subject.source.path,
  }))
}

function viewRows(manifest: StudioPreviewManifestV2): StudioServerViewRow[] {
  return manifest.subjects.filter(isProjectView(manifest)).map(subject => ({
    Id: subject.subjectId,
    Name: subject.viewName,
    RequiredParameters: (manifest.parametersBySubject[subject.subjectId] ?? [])
      .filter(parameter => parameter.required)
      .map(parameter => parameter.parameterId),
    SourcePath: subject.source.path,
  }))
}

function isProjectView(
  manifest: StudioPreviewManifestV2,
): (subject: StudioScenarioSubject) => subject is Extract<StudioScenarioSubject, { kind: 'view' }> {
  const root = manifest.project.root.replace(/\/$/, '')
  return (subject): subject is Extract<StudioScenarioSubject, { kind: 'view' }> =>
    subject.kind === 'view' && subject.source.path.startsWith(`${root}/`)
}

function scenarioRows(manifest: StudioPreviewManifestV2): StudioServerScenarioRow[] {
  return manifest.scenarios.map(scenario => ({
    FixtureId: scenario.fixtureId,
    Group: scenario.group,
    Id: scenario.scenarioId,
    Name: scenario.label,
    SourcePath: scenario.source.path,
    SubjectId: scenario.subjectId,
  }))
}

function checkpointRows(checkpoints: readonly StudioCheckpointSummary[]): StudioServerCheckpointRow[] {
  return checkpoints.map(checkpoint => ({
    AfterVersion: checkpoint.afterSourceVersion,
    BeforeVersion: checkpoint.beforeSourceVersion,
    Id: checkpoint.id,
    Path: checkpoint.path,
    Status: checkpoint.status,
  }))
}

function filterRows(
  rows: readonly StudioServerEntityRow[],
  where: StudioServerFillRequest['where'],
): readonly StudioServerEntityRow[] {
  if (where === undefined) {
    return rows
  }
  return rows.filter(row => Object.entries(where).every(([field, value]) => row[field as keyof typeof row] === value))
}

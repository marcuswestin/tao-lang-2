import { Expect, Test, withTaoFiles } from '@shared/test'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import { StudioProjectSession } from '../studio-src/StudioProjectSession'
import {
  studioProtocolChannel,
  studioProtocolVersion,
  studioSourceActionVersion,
} from '../studio-src/StudioProtocol'
import { StudioServerProvider } from '../studio-src/StudioServerDataProvider'
import {
  type StudioServerCheckpointRow,
  StudioServerDatasource,
  type StudioServerFileRow,
  type StudioServerScenarioRow,
  type StudioServerScreenRow,
  type StudioServerViewRow,
} from '../studio-src/StudioServerDatasource'
import {
  StudioForeignActionFailure,
  studioServerForeignActionContract,
  StudioServerForeignActions,
} from '../studio-src/TaoStudioServerActions'

Test('StudioServer datasource fills file metadata without leaking contents and pushes dirty invalidation', async () => {
  await withSession(async session => {
    const datasource = new StudioServerDatasource(session)
    const invalidations: string[][] = []
    datasource.subscribe(event => invalidations.push([...event.entities]))
    const before = await datasource.fill({ entity: 'Files' })
    const rows = before.rows as StudioServerFileRow[]
    const file = rows.find(row => row.Path === 'Garden.tao')!
    const folder = rows.find(row => row.Path === 'Features')!

    Expect(file.Path).toBe('Garden.tao')
    Expect(file.Name).toBe('Garden.tao')
    Expect(file.ParentPath).toBe('')
    Expect(file.Dirty).toBe(false)
    Expect(file.Folder).toBe(false)
    Expect('Content' in file).toBe(false)
    Expect(folder).toMatchObject({ Folder: true, Name: 'Features', ParentPath: '' })

    const source = await session.readFile(file.Path)
    const invalid = await session.syncDraft({
      content: 'app Garden {',
      path: file.Path,
      sourceVersion: source.sourceVersion,
      writeId: 'invalid-draft',
    })
    const after = await datasource.fill({ entity: 'Files', where: { Path: 'Garden.tao' } })
    const dirty = after.rows[0] as StudioServerFileRow

    Expect(invalid.saved).toBe(false)
    Expect(after.revision).toBeGreaterThan(before.revision)
    Expect(dirty.Dirty).toBe(true)
    Expect(dirty.Diagnostics.every(diagnostic => diagnostic.Source === 'draft')).toBe(true)
    Expect(invalidations).toContainEqual(['Files'])
    datasource.close()
  })
})

Test('StudioServer Tao provider replaces its complete mirror after pushed invalidation', async () => {
  const listeners = new Map<string, (event: { data: unknown }) => void>()
  let files = [{
    DiagnosticCount: 1,
    Diagnostics: [{ Id: 'Garden.tao#compile:0', Message: 'Broken', Source: 'compile' }],
    Dirty: false,
    Folder: false,
    Id: 'Garden.tao',
    Name: 'Garden.tao',
    ParentPath: '',
    Path: 'Garden.tao',
    Version: 'one',
  }]
  const requests: string[] = []
  const provider = StudioServerProvider({
    fetch: (async (input, init) => {
      requests.push(String(input))
      const entity = JSON.parse(String(init?.body))['entity'] as string
      return response(200, { entity, revision: 1, rows: entity === 'Files' ? files : [] }) as Response
    }) as typeof fetch,
    openSocket: url => {
      Expect(url).toBe('ws://studio.test/sessions/window_one/events')
      return {
        addEventListener: ((type: string, listener: (event: { data: unknown }) => void) => {
          listeners.set(type, listener)
        }) as WebSocket['addEventListener'],
        close() {},
      }
    },
  })
  const connection = provider.connect({
    configuration: { ServerOrigin: 'http://studio.test/sessions/window_one' },
    schema: {
      entities: {
        Diagnostic: {
          collection: 'Diagnostics',
          fields: {
            File: { kind: 'relation', relation: 'File' },
            Message: { kind: 'text' },
            Source: { kind: 'text' },
          },
          inverseFields: {},
        },
        File: {
          collection: 'Files',
          fields: {
            DiagnosticCount: { kind: 'number' },
            Dirty: { kind: 'boolean' },
            Folder: { kind: 'boolean' },
            Name: { kind: 'text' },
            ParentPath: { kind: 'text' },
            Path: { kind: 'text' },
            StableId: { kind: 'text', unique: true },
            Version: { kind: 'text' },
          },
          inverseFields: { Diagnostics: { inverseField: 'File', relation: 'Diagnostic' } },
        },
      },
      name: 'StudioServer',
      schemaVersion: 1,
    },
    storageKey: 'StudioServer',
  })
  const snapshots: string[] = []
  const stop = connection.subscribe!({
    error: error => {
      throw error
    },
    snapshot: value => snapshots.push(value!),
  })

  listeners.get('message')?.({ data: JSON.stringify({ entities: ['Files'], revision: 1, type: 'data-invalidated' }) })
  await eventually(() => snapshots.length === 1)
  const first = JSON.parse(snapshots[0]!)
  Expect(first.rows.File).toHaveLength(1)
  Expect(first.rows.Diagnostic).toEqual([{
    File: 'File:Garden.tao',
    Id: 'Diagnostic:Garden.tao#compile:0',
    Message: 'Broken',
    Source: 'compile',
  }])

  files = []
  listeners.get('message')?.({ data: JSON.stringify({ entities: ['Files'], revision: 2, type: 'data-invalidated' }) })
  await eventually(() => snapshots.length === 2)
  Expect(JSON.parse(snapshots[1]!).rows.File).toEqual([])
  Expect(requests.every(path => path === 'http://studio.test/sessions/window_one/api/data/fill')).toBe(true)
  stop()
})

Test(
  'StudioServer datasource derives screens, project views, scenarios, and checkpoints from live session state',
  async () => {
    await withSession(async session => {
      const datasource = new StudioServerDatasource(session)
      const invalidations: string[][] = []
      datasource.subscribe(event => invalidations.push([...event.entities]))
      session.setMatrixManifest(manifest(session))

      const screens = await datasource.fill({ entity: 'Screens' })
      const views = await datasource.fill({ entity: 'Views' })
      const scenarios = await datasource.fill({ entity: 'Scenarios' })

      Expect((screens.rows as StudioServerScreenRow[]).map(row => row.Name)).toEqual(['Garden'])
      Expect((views.rows as StudioServerViewRow[]).map(row => [row.Name, row.RequiredParameters]))
        .toEqual([['Card', ['Title']]])
      Expect((scenarios.rows as StudioServerScenarioRow[]).map(row => [row.Group, row.Name])).toEqual([[
        'states',
        'empty',
      ]])
      Expect(invalidations).toContainEqual(['Scenarios', 'Screens', 'Views'])

      const file = await session.readFile('Garden.tao')
      await session.applySourceAction({
        action: { component: 'Text', kind: 'insert-component' },
        channel: studioProtocolChannel,
        checkpoint: { id: 'component-insert', phase: 'single' },
        identity: {
          ...session.identity(),
          path: file.path,
          previewInstanceId: 'preview-1',
          sourceVersion: file.sourceVersion,
        },
        protocolVersion: studioProtocolVersion,
        requestId: 'component-insert-request',
        sourceActionVersion: studioSourceActionVersion,
        type: 'source-action',
      })
      const checkpoints = await datasource.fill({ entity: 'Checkpoints' })
      Expect((checkpoints.rows as StudioServerCheckpointRow[]).map(row => [row.Id, row.Status])).toEqual([
        ['component-insert', 'committed'],
      ])
      Expect(invalidations).toContainEqual(['Checkpoints'])
      datasource.close()
    })
  },
)

Test('Studio foreign-action adapters preserve endpoint policy and map optimistic conflicts', async () => {
  const requests: string[] = []
  const actions = new StudioServerForeignActions({
    basePath: '/sessions/window_one',
    fetch: async input => {
      requests.push(input)
      return input.endsWith('/api/source-action')
        ? response(409, { error: 'internal conflict wording' })
        : response(200, { saved: true })
    },
  })

  Expect(studioServerForeignActionContract.SyncDraft.runs).toBe('latest')
  Expect(studioServerForeignActionContract.DeleteFile.endpoint).toBe('/api/file/delete')
  Expect(studioServerForeignActionContract.RenameFile.failures.Conflict).toBe('This file changed under this edit.')
  await Expect(actions.createFile({ path: 'New.tao', writeId: 'create-1' })).resolves.toEqual({ saved: true })
  await Expect(actions.renameFile({
    path: 'New.tao',
    sourceVersion: 'source-new',
    targetPath: 'Renamed.tao',
    writeId: 'rename-1',
  })).resolves.toEqual({ saved: true })
  await Expect(actions.deleteFile({
    path: 'Renamed.tao',
    sourceVersion: 'source-new',
    writeId: 'delete-1',
  })).resolves.toEqual({ saved: true })
  await Expect(actions.syncDraft({
    content: 'view Main() { }',
    path: 'Garden.tao',
    sourceVersion: 'source-1',
    writeId: 'draft-1',
  })).resolves.toEqual({ saved: true })
  await Expect(actions.applySourceAction({} as never)).rejects.toMatchObject(
    {
      caseName: 'Conflict',
      message: 'This file changed under this edit.',
    } satisfies Partial<StudioForeignActionFailure>,
  )
  Expect(requests).toEqual([
    '/sessions/window_one/api/file/create',
    '/sessions/window_one/api/file/rename',
    '/sessions/window_one/api/file/delete',
    '/sessions/window_one/api/file/draft',
    '/sessions/window_one/api/source-action',
  ])
})

function response(status: number, body: unknown): Pick<Response, 'json' | 'ok' | 'status'> {
  return { json: async () => body, ok: status >= 200 && status < 300, status }
}

async function withSession(use: (session: StudioProjectSession) => Promise<void>): Promise<void> {
  await withTaoFiles('studio-server-datasource-', {
    'Features/Card.tao': 'view CardFeature() { render Text("Card") }',
    'Garden.tao': `
      app Garden { view Main }
      view Main() { render Stack() { Text("Garden") } }
      view Card(Title text) { render Text(Title) }
    `,
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    await use(session)
  })
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    if (predicate()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for provider refresh.')
}

function manifest(session: StudioProjectSession): StudioPreviewManifestV2 {
  const source = (path: string) => ({ kind: 'tao' as const, path, range: { end: 10, start: 0 } })
  const appId = `${session.entryPath}#app:Garden`
  const viewId = `${session.entryPath}#Card`
  const scenarioId = `${session.entryPath}#scenario:states:empty`
  return {
    capabilities: { captureDomains: [], scheme: 'inert' },
    cells: [{
      args: { Title: 'Empty' },
      cellId: `${scenarioId}#cell`,
      cellRevision: 0,
      environment: {
        network: { latencyMs: 0, outcome: 'normal' },
        scheme: { requested: 'light', status: 'inert' },
        viewport: { height: 844, width: 390 },
      },
      scenarioId,
      stateLayers: [],
    }],
    compileRevision: 1,
    fixtures: [{ fixtureId: 'fixture-empty', label: 'Empty', plan: {}, source: source(session.entryPath) }],
    generationDeclarations: [],
    manifestRevision: 'manifest-1',
    parametersBySubject: {
      [appId]: [],
      [viewId]: [{ label: 'Title', parameterId: 'Title', required: true, type: { kind: 'text' } }],
      '/stdlib/Text.tao#Text': [],
    },
    project: { appName: session.appName, entryPath: session.entryPath, root: session.projectRoot },
    scenarios: [{
      args: { Title: 'Empty' },
      fixtureId: 'fixture-empty',
      group: 'states',
      label: 'empty',
      prepare: [],
      scenarioId,
      source: source(session.entryPath),
      stateLayers: [],
      subjectId: viewId,
    }],
    sourceVersions: { [session.entryPath]: 'source-1' },
    states: [],
    subjects: [
      { appName: 'Garden', kind: 'app', source: source(session.entryPath), subjectId: appId },
      { kind: 'view', source: source(session.entryPath), subjectId: viewId, viewName: 'Card' },
      { kind: 'view', source: source('/stdlib/Text.tao'), subjectId: '/stdlib/Text.tao#Text', viewName: 'Text' },
    ],
    version: 2,
  }
}

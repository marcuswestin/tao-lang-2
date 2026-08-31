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
  type StudioServerDesignTokenRow,
  type StudioServerFileRow,
  type StudioServerProblemRow,
  type StudioServerScenarioRow,
  type StudioServerScreenRow,
  type StudioServerViewRow,
} from '../studio-src/StudioServerDatasource'
import {
  StudioForeignActionFailure,
  studioServerForeignActionContract,
  StudioServerForeignActions,
} from '../studio-src/TaoStudioServerActions'

Test('StudioServer datasource fills source-bound design and problem metadata without leaking contents', async () => {
  await withSession(async session => {
    const datasource = new StudioServerDatasource(session)
    const invalidations: string[][] = []
    datasource.subscribe(event => invalidations.push([...event.entities]))
    const before = await datasource.fill({ entity: 'Files' })
    const design = await datasource.fill({ entity: 'DesignTokens' })
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
    Expect(design.rows).toHaveLength(1)
    Expect((design.rows as StudioServerDesignTokenRow[])[0]).toMatchObject({
      DesignName: 'GardenDesign',
      Id: 'Garden.tao#design-token:ink',
      Kind: 'token',
      Name: 'ink',
      SourcePath: 'Garden.tao',
      SourceVersion: file.Version,
      Value: '#121826',
    })

    const source = await session.readFile(file.Path)
    const changed = await session.syncDraft({
      content: source.content.replace('Text("Garden")', 'Text("Garden updated")'),
      path: file.Path,
      sourceVersion: source.sourceVersion,
      writeId: 'valid-draft',
    })
    const refreshedDesign = await datasource.fill({ entity: 'DesignTokens' })
    Expect(changed.saved).toBe(true)
    Expect(refreshedDesign.rows).toHaveLength(1)
    Expect((refreshedDesign.rows as StudioServerDesignTokenRow[])[0]).toMatchObject({
      DesignName: 'GardenDesign',
      Id: 'Garden.tao#design-token:ink',
      Kind: 'token',
      Name: 'ink',
      SourcePath: 'Garden.tao',
      SourceVersion: changed.file.sourceVersion,
      Value: '#121826',
    })
    const invalid = await session.syncDraft({
      content: 'app Garden {',
      path: file.Path,
      sourceVersion: changed.file.sourceVersion,
      writeId: 'invalid-draft',
    })
    const after = await datasource.fill({ entity: 'Files', where: { Path: 'Garden.tao' } })
    const dirty = after.rows[0] as StudioServerFileRow
    const problems = await datasource.fill({ entity: 'Problems' })

    Expect(invalid.saved).toBe(false)
    Expect(after.revision).toBeGreaterThan(before.revision)
    Expect(dirty.Dirty).toBe(true)
    Expect(dirty.Diagnostics.every(diagnostic => diagnostic.Source === 'draft')).toBe(true)
    Expect(problems.rows as StudioServerProblemRow[]).toEqual([Expect['objectContaining']({
      Message: Expect['any'](String),
      ProjectFile: true,
      Source: 'draft',
      SourcePath: 'Garden.tao',
    })])
    Expect((problems.rows[0] as StudioServerProblemRow).SourceVersion).toBeUndefined()
    Expect(invalidations).toContainEqual(['Files', 'DesignTokens', 'Problems'])
    datasource.close()
  })
})

Test('StudioServer datasource publishes structured design kinds with revision-bound source ranges', async () => {
  await withTaoFiles('studio-server-structured-design-', {
    'Garden.tao': `
      design GardenDesign {
         colors { ink #121826 }
         sizes { md 12.px }
         text { body [size md, ink ink] }
         screens { wide }
         styles { card [radius md] Text [ink ink] }
      }
      app Garden { view Main Design GardenDesign }
      view Main() { render Text("Garden") [card, body] }
    `,
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    const file = await session.readFile('Garden.tao')
    const rows = (await new StudioServerDatasource(session).fill({ entity: 'DesignTokens' }))
      .rows as StudioServerDesignTokenRow[]
    Expect(
      rows.map(row => ({ id: row.Id, kind: row.Kind, name: row.Name })).sort((left, right) =>
        left.id.localeCompare(right.id)
      ),
    ).toEqual([
      { id: 'Garden.tao#design-color:ink', kind: 'color', name: 'ink' },
      { id: 'Garden.tao#design-default:Text', kind: 'default', name: 'Text' },
      { id: 'Garden.tao#design-screen:wide', kind: 'screen', name: 'wide' },
      { id: 'Garden.tao#design-size:md', kind: 'size', name: 'md' },
      { id: 'Garden.tao#design-style:card', kind: 'style', name: 'card' },
      { id: 'Garden.tao#design-text:body', kind: 'text', name: 'body' },
    ])
    for (const row of rows) {
      Expect(row.DesignName).toBe('GardenDesign')
      Expect(row.SourcePath).toBe('Garden.tao')
      Expect(row.SourceVersion).toBe(file.sourceVersion)
      Expect(row.Start).toBeLessThan(row.End!)
      Expect(file.content.slice(row.Start, row.End)).toContain(row.Name)
    }
  })
})

Test('StudioServer Problems retains project diagnostics and revision-bound source locations', async () => {
  await withSession(async session => {
    await session.compileInitial()
    const problems = (await new StudioServerDatasource(session).fill({ entity: 'Problems' }))
      .rows as StudioServerProblemRow[]
    const file = await session.readFile('Garden.tao')

    Expect(problems).toEqual([
      {
        EndCharacter: 5,
        EndLine: 2,
        Id: '$compile:1:0',
        Message: 'Garden problem',
        ProjectFile: true,
        Source: 'compile',
        SourcePath: 'Garden.tao',
        SourceVersion: file.sourceVersion,
        StartCharacter: 1,
        StartLine: 2,
      },
      {
        Id: '$compile:1:1',
        Message: 'Project problem',
        ProjectFile: false,
        Source: 'compile',
      },
    ])
  }, async request => {
    throw Object.assign(new Error('compile failed'), {
      details: {
        diagnostics: [
          {
            filePath: 'Garden.tao',
            message: 'Garden problem',
            range: { end: { character: 5, line: 2 }, start: { character: 1, line: 2 } },
          },
          { message: 'Project problem' },
        ],
        revision: request.compileRevision,
      },
    })
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
      const rows = entity === 'Files'
        ? files
        : entity === 'DesignTokens'
        ? [{
          Id: 'Garden.tao#design-token:ink',
          Name: 'ink',
          SourcePath: 'Garden.tao',
          SourceVersion: 'one',
          Value: '#121826',
        }]
        : entity === 'Problems'
        ? [{
          Id: '$compile:1:0',
          Message: 'Broken',
          ProjectFile: true,
          Source: 'compile',
          SourcePath: 'Garden.tao',
          SourceVersion: 'one',
        }]
        : []
      return response(200, { entity, revision: 1, rows }) as Response
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
        DesignToken: {
          collection: 'DesignTokens',
          fields: {
            Name: { kind: 'text' },
            SourcePath: { kind: 'text' },
            SourceVersion: { kind: 'text' },
            StableId: { kind: 'text', unique: true },
            Value: { kind: 'text' },
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
        Problem: {
          collection: 'Problems',
          fields: {
            Message: { kind: 'text' },
            ProjectFile: { kind: 'boolean' },
            Source: { kind: 'text' },
            SourcePath: { kind: 'text' },
            SourceVersion: { kind: 'text' },
            StableId: { kind: 'text', unique: true },
          },
          inverseFields: {},
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
  Expect(first.rows.DesignToken).toEqual([{
    Id: 'DesignToken:Garden.tao#design-token:ink',
    Name: 'ink',
    SourcePath: 'Garden.tao',
    SourceVersion: 'one',
    StableId: 'Garden.tao#design-token:ink',
    Value: '#121826',
  }])
  Expect(first.rows.Problem).toEqual([{
    Id: 'Problem:$compile:1:0',
    Message: 'Broken',
    ProjectFile: true,
    Source: 'compile',
    SourcePath: 'Garden.tao',
    SourceVersion: 'one',
    StableId: '$compile:1:0',
  }])

  files = []
  listeners.get('message')?.({ data: JSON.stringify({ entities: ['Files'], revision: 2, type: 'data-invalidated' }) })
  await eventually(() => snapshots.length === 2)
  Expect(JSON.parse(snapshots[1]!).rows.File).toEqual([])
  listeners.get('message')?.({ data: JSON.stringify({ entities: ['Files'], revision: 2, type: 'data-invalidated' }) })
  await Promise.resolve()
  Expect(snapshots).toHaveLength(2)
  listeners.get('message')?.({ data: JSON.stringify({ entities: ['Files'], revision: 1, type: 'data-invalidated' }) })
  await eventually(() => snapshots.length === 3)
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
      return input.includes('/api/source-action')
        ? response(409, {
          details: { code: 'render-owner-mismatch', expected: 'Card', renderId: 'render-1' },
          error: 'internal conflict wording',
        })
        : response(200, { saved: true })
    },
  })

  Expect(studioServerForeignActionContract.SyncDraft.runs).toBe('latest')
  Expect(studioServerForeignActionContract.DeleteFile.endpoint).toBe('/api/file/delete')
  Expect(studioServerForeignActionContract.RenameFile.failures.Conflict).toBe('This file changed under this edit.')
  Expect(studioServerForeignActionContract.UndoSourceAction.failures.Conflict)
    .toBe('This file changed under this edit.')
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
      details: { code: 'render-owner-mismatch', expected: 'Card', renderId: 'render-1' },
      message: 'This file changed under this edit.',
    } satisfies Partial<StudioForeignActionFailure>,
  )
  await Expect(actions.undoSourceAction({} as never)).rejects.toMatchObject(
    {
      caseName: 'Conflict',
      details: { code: 'render-owner-mismatch', expected: 'Card', renderId: 'render-1' },
      message: 'This file changed under this edit.',
    } satisfies Partial<StudioForeignActionFailure>,
  )
  Expect(requests).toEqual([
    '/sessions/window_one/api/file/create',
    '/sessions/window_one/api/file/rename',
    '/sessions/window_one/api/file/delete',
    '/sessions/window_one/api/file/draft',
    '/sessions/window_one/api/source-action',
    '/sessions/window_one/api/source-action/undo',
  ])
})

function response(status: number, body: unknown): Pick<Response, 'json' | 'ok' | 'status'> {
  return { json: async () => body, ok: status >= 200 && status < 300, status }
}

async function withSession(
  use: (session: StudioProjectSession) => Promise<void>,
  compile: (request: { compileRevision: number }) => Promise<void> = async () => {},
): Promise<void> {
  await withTaoFiles('studio-server-datasource-', {
    'Features/Card.tao': 'view CardFeature() { render Text("Card") }',
    'Garden.tao': `
      design GardenDesign {
        ink #121826
      }
      app Garden { view Main }
      view Main() { render Stack() { Text("Garden") } }
      view Card(Title text) { render Text(Title) }
    `,
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      compile,
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
    capabilities: { captureDomains: [], scheme: 'reactive-browser' },
    cells: [{
      args: { Title: 'Empty' },
      cellId: `${scenarioId}#cell`,
      cellRevision: 0,
      environment: {
        network: { latencyMs: 0, outcome: 'normal' },
        scheme: {
          capability: 'reactive-browser' as const,
          requested: 'system' as const,
          resolved: 'light' as const,
          source: 'system' as const,
        },
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

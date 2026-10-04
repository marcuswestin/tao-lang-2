import { Workspace } from '@compiler/workspace'
import { Errors, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions from '@source-actions'
import { StudioProjectFiles } from '../studio-src/session/StudioProjectFiles'
import type { StudioWrite } from '../studio-src/StudioCompileCoordinator'
import { StudioFeedSession } from '../studio-src/StudioFeedSession'
import { studioGeneratedSourceHeader, StudioGeneratedSources } from '../studio-src/StudioGeneratedSources'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import { StudioSketchCatalog } from '../studio-src/StudioSketchCatalog'

const originalView =
  `${studioGeneratedSourceHeader}\nuse Placeholder from @tao/ui\npublic view View1() { render Placeholder("Existing") }\nscenarios View1 "sketch" { device phone scenario "draft" { render View1() } }\n\n`

Describe('Studio Feed session transactions', () => {
  Test('previews without disk writes, keeps all sources once, and undoes exact original bytes', async () => {
    await fixture(async f => {
      const selected = await f.select()
      Expect(selected.pending).toBe(true)
      Expect(f.compiles[0]).toEqual([])
      Expect(await FS.readText(f.view)).toBe(originalView)
      Expect(await FS.exists(f.sketches)).toBe(false)
      const overlay = f.feed.sourceOverrides()!
      Expect(overlay[f.sketches]).toContain('Transient title')
      const compiled = await (await Workspace.open(f.root, { sourceOverrides: overlay }))
        .compileFiles([f.entryPath, f.view], { studio: true })
      Expect(compiled.studioManifest?.views.find(view => view.name === 'View1')?.parameters)
        .toContainEqual({ name: 'Playlist', kind: 'entity', entity: 'Playlist', required: true, typeName: 'Playlist' })
      const kept = await f.action('keep', 'keep', selected.draftRevision)
      Expect(kept).toMatchObject({ pending: false, canUndo: true, draftRevision: 2 })
      Expect(await FS.readText(f.view)).toBe(overlay[f.view]!)
      Expect(await FS.readText(f.sketches)).toBe(overlay[f.sketches]!)
      const count = f.compiles.length
      Expect(await f.action('keep', 'keep', selected.draftRevision, 1)).toEqual(kept)
      Expect(f.compiles).toHaveLength(count)
      const undone = await f.action('undo', 'undo', 2, 2)
      Expect(undone).toMatchObject({ pending: false, canUndo: false, draftRevision: 3 })
      Expect(await FS.readText(f.view)).toBe(originalView)
      Expect(await FS.exists(f.sketches)).toBe(false)
      Expect((await f.catalog.read()).revision).toBe(3)
      Expect(f.files.list().map(file => file.path)).not.toContain('@/studio/Sketches.tao')
    })
  })

  Test('refuses stale dependency and catalog revisions without overwriting external edits', async () => {
    await fixture(async f => {
      await f.select()
      await FS.writeText(f.data, 'public data Playlists / Playlist { Title text Extra number? }\n')
      await Expect(f.action('keep', 'stale-data', 1)).rejects.toThrow('dependency changed')
      Expect(await FS.readText(f.data)).toContain('Extra number?')
      Expect(await FS.readText(f.view)).toBe(originalView)
      Expect(await FS.exists(f.sketches)).toBe(false)
      await f.action('discard', 'discard', 1)
      await f.catalog.apply({
        action: { kind: 'delete-sketch', id: 'card' },
        expectedRevision: 1,
        requestId: 'external',
      })
      await Expect(f.action('undo', 'stale-catalog', 2)).rejects.toThrow('catalog changed')
    })
  })

  for (const failure of ['write', 'catalog', 'compile'] as const) {
    Test(`rolls back every Keep source after ${failure} failure and permits retry`, async () => {
      await fixture(async f => {
        await f.select()
        const expected = f.feed.sourceOverrides()!
        f.fail(failure)
        await Expect(f.action('keep', `failed-${failure}`, 1)).rejects.toThrow('injected')
        Expect(await FS.readText(f.view)).toBe(originalView)
        Expect(await FS.exists(f.sketches)).toBe(false)
        Expect((await f.catalog.read()).revision).toBe(1)
        Expect(f.feed.sourceOverrides()).toEqual(expected)
        const kept = await f.action('keep', `retry-${failure}`, 1)
        Expect(kept.catalog.revision).toBe(2)
        Expect(await FS.readText(f.sketches)).toBe(expected[f.sketches]!)
      })
    })
  }

  Test('restores the exact kept fixture bytes when undo compilation fails after removing it', async () => {
    await fixture(async f => {
      await f.select()
      await f.action('keep', 'keep', 1)
      const before = await FS.readText(f.sketches)
      f.fail('compile')
      await Expect(f.action('undo', 'undo-failure', 2, 2)).rejects.toThrow('injected')
      Expect(await FS.readText(f.sketches)).toBe(before)
      Expect((await f.catalog.read()).revision).toBe(2)
      const retried = await f.action('undo', 'retry-undo', 2, 2)
      Expect(retried.canUndo).toBe(false)
      Expect(await FS.exists(f.sketches)).toBe(false)
    })
  })

  Test('refuses a dependency edited during Keep compilation and preserves that edit', async () => {
    await fixture(async f => {
      await f.select()
      f.onCompile(async () => {
        await FS.writeText(f.data, 'external schema edit')
      })
      await Expect(f.action('keep', 'changed-during-compile', 1)).rejects.toThrow('dependency changed')
      Expect(await FS.readText(f.data)).toBe('external schema edit')
      Expect(await FS.readText(f.view)).toBe(originalView)
      Expect(await FS.exists(f.sketches)).toBe(false)
      Expect((await f.catalog.read()).revision).toBe(1)
    })
  })

  Test('restores an absent draft after preview compile failure and permits the same request retry', async () => {
    await fixture(async f => {
      f.fail('compile')
      await Expect(f.select()).rejects.toThrow('injected')
      Expect(f.feed.sourceOverrides()).toBeUndefined()
      Expect(await FS.readText(f.view)).toBe(originalView)
      Expect(await FS.exists(f.sketches)).toBe(false)
      Expect((await f.select()).draftRevision).toBe(1)
    })
  })

  Test('refuses a preview cell belonging to another sketch before publishing a draft', async () => {
    await fixture(async f => {
      const source = { kind: 'tao' as const, path: 'Other.tao', range: { start: 0, end: 1 } }
      f.manifest.subjects = [{ kind: 'view', source, subjectId: 'other-view', viewName: 'Other' }]
      f.manifest.scenarios = [{
        args: {},
        group: 'sketch',
        label: 'draft',
        prepare: [],
        scenarioId: 'other-scenario',
        source,
        stateLayers: [],
        subjectId: 'other-view',
      }]
      f.manifest.cells = [{
        args: {},
        cellId: 'other-cell',
        cellRevision: 0,
        scenarioId: 'other-scenario',
        stateLayers: [],
        environment: {
          network: { latencyMs: 0, outcome: 'normal' },
          scheme: { capability: 'reactive-browser', requested: 'system', resolved: 'light', source: 'system' },
          viewport: { height: 844, width: 390, presetId: 'phone' },
        },
      }]
      await Expect(f.feed.action({ ...f.selectRequest, cellId: 'other-cell' })).rejects.toThrow('does not belong')
      await Expect(
        f.feed.action({
          ...f.selectRequest,
          kind: 'bind',
          cellId: 'other-cell',
          rectId: 'leaf',
          path: ['Title'],
          presentation: 'text',
        }),
      ).rejects.toThrow('does not belong')
      await Expect(f.feed.action({ ...f.selectRequest, kind: 'loop', cellId: 'other-cell', path: ['Tracks'] })).rejects
        .toThrow('does not belong')
      Expect(f.feed.sourceOverrides()).toBeUndefined()
      Expect(f.compiles).toEqual([])
      Expect(await FS.readText(f.view)).toBe(originalView)
    })
  })

  Test('a collection drop updates only its explicit preview scenario', async () => {
    await fixture(async f => {
      const source = originalView.replace(
        'scenario "draft" { render View1() }',
        'scenario "draft" { render View1() } scenario "alternate" { render View1() }',
      )
      await FS.writeText(f.view, source)
      f.manifest.sourceVersions = { ...f.manifest.sourceVersions, [f.view]: SourceActions.studioSourceVersion(source) }
      const location = { kind: 'tao' as const, path: f.view, range: { start: 0, end: 1 } }
      f.manifest.subjects = [{ kind: 'view', source: location, subjectId: 'view', viewName: 'View1' }]
      f.manifest.scenarios = ['draft', 'alternate'].map(label => ({
        args: {},
        group: 'sketch',
        label,
        prepare: [],
        scenarioId: label,
        source: location,
        stateLayers: [],
        subjectId: 'view',
      }))
      f.manifest.cells = [{
        args: {},
        cellId: 'alternate-cell',
        cellRevision: 0,
        scenarioId: 'alternate',
        stateLayers: [],
        environment: {
          network: { latencyMs: 0, outcome: 'normal' },
          scheme: { capability: 'reactive-browser', requested: 'system', resolved: 'light', source: 'system' },
          viewport: { height: 844, width: 390, presetId: 'phone' },
        },
      }]
      await f.select()
      const inventory = await f.feed.browse({
        seed: 'seed',
        liveRows: { Playlist: [{ fields: { Title: 'Second title' }, name: 'Second' }] },
      })
      const rowId = inventory.inventory.entities[0]!.sources.find(source => source.kind === 'live')!.rows[0]!.id
      await f.feed.action({
        ...f.selectRequest,
        kind: 'loop',
        rowId,
        draftRevision: 1,
        requestId: 'scoped-loop',
        cellId: 'alternate-cell',
        path: ['Tracks'],
      })
      const compiled = await (await Workspace.open(f.root, { sourceOverrides: f.feed.sourceOverrides() }))
        .compileFiles([f.entryPath, f.view], { studio: true })
      const scenarios = compiled.studioManifest!.scenarios
      const first = scenarios.find(scenario => scenario.name === 'draft')
      const second = scenarios.find(scenario => scenario.name === 'alternate')
      Expect(first).toBeDefined()
      Expect(second).toBeDefined()
      Expect(first!.subject).not.toEqual(second!.subject)
      const creates = compiled.studioManifest!.fixtures.flatMap(fixture => fixture.creates)
      const originalRow = creates.find(row => row.fields['Title'] === 'Transient title')!
      const newRow = creates.find(row => row.fields['Title'] === 'Second title')!
      Expect(first!.subject).toMatchObject({
        arguments: { Playlist: { handle: originalRow.name, kind: 'fixture-reference' } },
      })
      Expect(second!.subject).toMatchObject({
        arguments: { Playlist: { handle: newRow.name, kind: 'fixture-reference' } },
      })
    })
  })

  Test('discards after an external catalog edit using the original catalog token', async () => {
    await fixture(async f => {
      await f.select()
      await f.catalog.apply({
        action: { kind: 'delete-sketch', id: 'card' },
        expectedRevision: 1,
        requestId: 'external-delete',
      })
      const discarded = await f.action('discard', 'discard-stale-catalog', 1, 1)
      Expect(discarded).toMatchObject({ pending: false, draftRevision: 2 })
      Expect(discarded.catalog.revision).toBe(2)
      Expect(f.feed.sourceOverrides()).toBeUndefined()
      Expect(await FS.readText(f.view)).toBe(originalView)
    })
  })

  Test('discards permanently when authoritative source compilation fails', async () => {
    await fixture(async f => {
      await f.select()
      await FS.writeText(f.data, 'broken external source')
      f.fail('compile')
      const discarded = await f.action('discard', 'discard-broken-source', 1)
      Expect(discarded).toMatchObject({ pending: false, draftRevision: 2 })
      Expect(f.feed.sourceOverrides()).toBeUndefined()
      Expect(f.compiles).toHaveLength(2)
      Expect(await FS.readText(f.data)).toBe('broken external source')
      Expect(await f.action('discard', 'discard-broken-source', 1)).toEqual(discarded)
    })
  })

  for (const compileFails of [false, true]) {
    Test(
      `preserves an external generated view edit during Keep when compilation ${compileFails ? 'fails' : 'succeeds'}`,
      async () => {
        await fixture(async f => {
          await f.select()
          const external = `${studioGeneratedSourceHeader}\npublic view External() { }\n`
          f.onCompile(async () => {
            await new StudioGeneratedSources(f.root).rewrite(f.view, external)
            if (compileFails) {
              f.fail('compile')
            }
          })
          await Expect(f.action('keep', 'keep-external-edit', 1)).rejects.toThrow('Preserved newer source edit')
          Expect(await FS.readText(f.view)).toBe(external)
          Expect(await FS.exists(f.sketches)).toBe(false)
          Expect((await f.catalog.read()).revision).toBe(1)
          Expect(f.files.list().find(file => file.path === '@/studio/View1.tao')?.sourceVersion)
            .toBe(SourceActions.studioSourceVersion(external))
        })
      },
    )
  }

  Test('preserves a fixture recreated externally while undo compilation fails', async () => {
    await fixture(async f => {
      await f.select()
      await f.action('keep', 'keep-before-external-undo', 1)
      const keptView = await FS.readText(f.view)
      const external = `${studioGeneratedSourceHeader}\npublic fixture Sketches { }\n\n`
      f.onCompile(async () => {
        await FS.writeText(f.sketches, external)
        f.fail('compile')
      })
      await Expect(f.action('undo', 'undo-external-create', 2, 2)).rejects.toThrow('Preserved newer source edit')
      Expect(await FS.readText(f.sketches)).toBe(external)
      Expect(await FS.readText(f.view)).toBe(keptView)
      Expect((await f.catalog.read()).revision).toBe(2)
    })
  })

  Test('reports an incomplete rollback when restoring an owned file also fails', async () => {
    await fixture(async f => {
      await f.select()
      f.onCompile(async () => {
        f.fail('partial-write')
        Errors.throwUserInput('injected original compile rejection')
      })
      await Expect(f.action('keep', 'keep-rollback-failure', 1)).rejects.toThrow(
        'Feed rollback incomplete. Could not restore',
      )
      Expect(await FS.readText(f.view)).toBe(`${studioGeneratedSourceHeader}\npartial write`)
      Expect(await FS.exists(f.sketches)).toBe(false)
      Expect((await f.catalog.read()).revision).toBe(1)
    })
  })

  Test(
    'projects a free rectangle for a loop, refreshes its association, and preserves the old catalog for undo',
    async () => {
      await fixture(async f => {
        const catalog = await f.catalog.read()
        const rect = { height: 40, id: 'r', kind: 'Placeholder', width: 80, x: 10, y: 20 }
        await f.catalog.restore({
          ...catalog,
          sketches: [{ ...catalog.sketches[0]!, rectOrder: ['r'], rects: [rect] }],
        }, 1)
        f.realCompile()
        const proposal = await f.feed.action({ ...f.selectRequest, kind: 'loop', path: ['Tracks'], rectId: 'r' })
        const snapped = proposal.catalog.sketches[0]!.snapped[0]!
        Expect(proposal.catalog.sketches[0]!.rects).toEqual([])
        Expect(snapped.rect.kind).toBe('Col')
        Expect(snapped.target.elementName).toBe('Col')
        Expect(snapped.target.renderId).toContain(f.view)
        Expect(snapped.target.sourceVersion).toBe(f.manifest.sourceVersions[f.view]!)
        Expect((await f.catalog.read()).sketches[0]!.rects).toEqual([rect])
        Expect(await FS.readText(f.view)).toBe(originalView)
        const kept = await f.action('keep', 'keep-free-loop', 1)
        Expect(kept.catalog.sketches[0]!.snapped[0]!.target).toMatchObject({
          elementName: 'Col',
          sourceVersion: f.manifest.sourceVersions[f.view],
        })
        await f.action('undo', 'undo-free-loop', 2, 2)
        Expect((await f.catalog.read()).sketches[0]!.rects).toEqual([rect])
        Expect((await f.catalog.read()).sketches[0]!.snapped).toEqual([])
      })
    },
  )

  Test('refreshes a Placeholder association after binding it to Text', async () => {
    await fixture(async f => {
      const source = originalView.replace('render Placeholder', '#studio_rect_0072\nrender Placeholder')
      await FS.writeText(f.view, source)
      f.manifest.sourceVersions = { ...f.manifest.sourceVersions, [f.view]: SourceActions.studioSourceVersion(source) }
      const catalog = await f.catalog.read()
      const rect = { height: 40, id: 'r', kind: 'Placeholder', width: 80, x: 10, y: 20 }
      await f.catalog.restore({
        ...catalog,
        sketches: [{
          ...catalog.sketches[0]!,
          rectOrder: ['r'],
          snapped: [{
            rect,
            target: {
              elementName: 'Placeholder',
              path: '@/studio/View1.tao',
              renderId: 'old',
              sourceVersion: 'old',
              studioRectId: 'r',
              view: 'View1',
            },
          }],
        }],
      }, 1)
      f.realCompile()
      const selected = await f.feed.action({
        ...f.selectRequest,
        kind: 'bind',
        path: ['Title'],
        rectId: 'r',
        presentation: 'text',
      })
      Expect(selected.catalog.sketches[0]!.snapped[0]!).toMatchObject({
        rect: { kind: 'Text' },
        target: { elementName: 'Text' },
      })
      const kept = await f.action('keep', 'keep-bound', 1)
      const target = kept.catalog.sketches[0]!.snapped[0]!.target
      Expect(
        f.manifest.renders?.find(render => render.studioRectId === 'r' && render.elementName === target.elementName)
          ?.renderId,
      ).toBe(target.renderId)
      Expect(target.sourceVersion).toBe(SourceActions.studioSourceVersion(await FS.readText(f.view)))
    })
  })

  Test('rejects private and optional collection paths before proposing a loop', async () => {
    for (const change of [{ secret: true }, { optional: true }]) {
      await fixture(async f => {
        f.manifest.generationDeclarations = f.manifest.generationDeclarations.map(declaration =>
          declaration.kind !== 'entity' || declaration.name !== 'Playlist'
            ? declaration
            : {
              ...declaration,
              fields: declaration.fields.map(field => field.name === 'Tracks' ? { ...field, ...change } : field),
            }
        )
        await Expect(f.feed.action({ ...f.selectRequest, kind: 'loop', path: ['Tracks'] })).rejects.toThrow(
          'private, optional, or unavailable',
        )
        Expect(f.feed.sourceOverrides()).toBeUndefined()
        Expect(f.compiles).toEqual([])
      })
    }
  })

  Test('preserves uncertain partial writes instead of treating observed bytes as owned', async () => {
    await fixture(async f => {
      await f.select()
      f.fail('partial-write')
      await Expect(f.action('keep', 'keep-uncertain-write', 1)).rejects.toThrow('Preserved uncertain partial write')
      Expect(await FS.readText(f.view)).toBe(`${studioGeneratedSourceHeader}\npartial write`)
      Expect(await FS.exists(f.sketches)).toBe(false)
      Expect((await f.catalog.read()).revision).toBe(1)
    })
  })

  Test('preserves an external write arriving before the successful writer resolves', async () => {
    await fixture(async f => {
      await f.select()
      f.fail('external-write')
      await Expect(f.action('keep', 'keep-writer-race', 1)).rejects.toThrow('Preserved newer source edit')
      Expect(await FS.readText(f.view)).toBe(`${studioGeneratedSourceHeader}\nexternal writer race`)
      Expect(await FS.exists(f.sketches)).toBe(false)
      Expect((await f.catalog.read()).revision).toBe(1)
    })
  })

  Test('preserves uncertain new-file bytes instead of letting create cleanup delete them', async () => {
    await fixture(async f => {
      await f.select()
      f.fail('partial-create')
      await Expect(f.action('keep', 'keep-uncertain-create', 1)).rejects.toThrow('Preserved uncertain partial write')
      Expect(await FS.readText(f.sketches)).toBe(
        `${studioGeneratedSourceHeader}\nexternal fixture after uncertain create`,
      )
      Expect(await FS.readText(f.view)).toBe(originalView)
      Expect((await f.catalog.read()).revision).toBe(1)
    })
  })

  Test('refuses a cached gesture after an external catalog edit', async () => {
    await fixture(async f => {
      await f.select()
      await f.catalog.apply({
        action: { kind: 'delete-sketch', id: 'card' },
        expectedRevision: 1,
        requestId: 'external-delete',
      })
      await Expect(f.select()).rejects.toThrow('catalog changed')
      Expect(f.compiles).toHaveLength(1)
      Expect(await FS.readText(f.view)).toBe(originalView)
    })
  })

  Test('rejects malformed requests, forged rows, and request-id reuse before writes', async () => {
    await fixture(async f => {
      for (
        const request of [null, {}, { kind: 'keep', requestId: 'x', draftRevision: -1, catalogRevision: 1 }, {
          ...f.selectRequest,
          kind: 'loop',
          path: [],
        }]
      ) {
        await Expect(f.feed.action(request)).rejects.toThrow()
      }
      await Expect(f.feed.browse({ seed: '', liveRows: {} })).rejects.toThrow()
      await Expect(f.feed.browse({ seed: 'x', liveRows: { Playlist: [{}] } })).rejects.toThrow()
      await Expect(f.feed.action({ ...f.selectRequest, rowId: 'forged' })).rejects.toThrow('row is no longer available')
      await f.select()
      await Expect(f.feed.action({ ...f.selectRequest, kind: 'discard' })).rejects.toThrow('different action')
      Expect(await FS.readText(f.view)).toBe(originalView)
      Expect(await FS.exists(f.sketches)).toBe(false)
    })
  })
})

async function fixture(
  run: (input: {
    action: (
      kind: 'keep' | 'discard' | 'undo',
      requestId: string,
      draftRevision: number,
      catalogRevision?: number,
    ) => ReturnType<StudioFeedSession['action']>
    catalog: StudioSketchCatalog
    manifest: StudioPreviewManifestV2
    compiles: readonly StudioWrite[][]
    data: string
    entryPath: string
    root: string
    realCompile: () => void
    fail: (kind: 'write' | 'partial-create' | 'partial-write' | 'external-write' | 'catalog' | 'compile') => void
    onCompile: (effect: () => Promise<void>) => void
    feed: StudioFeedSession
    files: StudioProjectFiles
    select: () => ReturnType<StudioFeedSession['action']>
    selectRequest: {
      catalogRevision: number
      draftRevision: number
      kind: 'select'
      requestId: string
      rowId: string
      sketchId: string
    }
    sketches: string
    view: string
  }) => Promise<void>,
): Promise<void> {
  await withTaoFiles('tao-feed-session-', {
    'Main.tao':
      'use Playlist from ./Data\nuse Placeholder from @tao/ui\napp Preview { id "tao-studio-feed-preview" version "1.0.0" name "Preview" view Main }\nview Main() { render Placeholder("Main") }',
    'Data.tao':
      'public data Playlists / Playlist { Title text, Tracks (owned) }\npublic data Tracks / Track { Name text, Playlist }',
    '@/studio/View1.tao': originalView,
  }, async (paths, root) => {
    await FS.writeText(paths['@/studio/View1.tao']!, originalView)
    let failure: 'write' | 'partial-create' | 'partial-write' | 'external-write' | 'catalog' | 'compile' | undefined
    let actualCompile = false
    let compileEffect: (() => Promise<void>) | undefined
    const catalog = new StudioSketchCatalog(root, {
      writeTemporary: async (path, content) => {
        if (failure === 'catalog') {
          failure = undefined
          Errors.throwHostEnvironment('injected catalog failure')
        }
        await FS.writeText(path, content)
      },
    })
    const created = await catalog.apply({
      action: { height: 100, id: 'card', kind: 'create-sketch', project: root, rects: [], width: 100 },
      expectedRevision: 0,
      requestId: 'create',
    })
    await catalog.restore({
      ...created.catalog,
      sketches: [{ ...created.catalog.sketches[0]!, name: 'View1', view: 'View1' }],
    }, 1)
    const files = await StudioProjectFiles.open(root, () => [])
    const manifest: StudioPreviewManifestV2 = {
      capabilities: { captureDomains: [], scheme: 'reactive-browser' },
      cells: [],
      compileRevision: 1,
      fixtures: [],
      generationDeclarations: [{
        collection: 'Playlists',
        fields: [{ name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } }, {
          name: 'Tracks',
          optional: false,
          secret: false,
          type: { kind: 'relation', inverse: true, entity: 'Track' },
        }],
        kind: 'entity',
        name: 'Playlist',
      }, {
        collection: 'Tracks',
        kind: 'entity',
        name: 'Track',
        fields: [{ name: 'Name', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } }, {
          name: 'Playlist',
          optional: false,
          secret: false,
          type: { kind: 'relation', inverse: false, entity: 'Playlist' },
        }],
      }],
      manifestRevision: 'one',
      parametersBySubject: {},
      project: { appName: 'Preview', entryPath: paths['Main.tao']!, root },
      scenarios: [],
      sourceVersions: Object.fromEntries(
        await Promise.all(
          Object.values(paths).map(async path => [path, SourceActions.studioSourceVersion(await FS.readText(path))]),
        ),
      ),
      states: [],
      subjects: [],
      version: 2,
    }
    const compiles: StudioWrite[][] = []
    const feed = new StudioFeedSession({
      catalog,
      entryPath: paths['Main.tao']!,
      files,
      manifest: () => manifest,
      projectRoot: root,
      publish: () => {},
      writeSource: async (path, content) => {
        if (failure === 'external-write' && path.endsWith('View1.tao')) {
          failure = undefined
          await FS.writeText(path, content)
          await FS.writeText(path, `${studioGeneratedSourceHeader}\nexternal writer race`)
          return
        }
        if (failure === 'partial-write' && path.endsWith('View1.tao')) {
          failure = undefined
          await FS.writeText(path, `${studioGeneratedSourceHeader}\npartial write`)
          Errors.throwHostEnvironment('injected partial write failure')
        }
        if (failure === 'write' && path.endsWith('Sketches.tao')) {
          failure = undefined
          Errors.throwHostEnvironment('injected write failure')
        }
        if (failure === 'partial-create' && path.endsWith('Sketches.tao')) {
          failure = undefined
          await FS.writeText(path, `${studioGeneratedSourceHeader}\nexternal fixture after uncertain create`)
          Errors.throwHostEnvironment('injected uncertain create failure')
        }
        await FS.writeText(path, content)
      },
      compile: async writes => {
        compiles.push([...writes])
        const effect = compileEffect
        compileEffect = undefined
        await effect?.()
        if (actualCompile) {
          const sourceOverrides = feed.sourceOverrides()
          const compiled = await (await Workspace.open(root, { sourceOverrides })).compileFiles([
            paths['Main.tao']!,
            paths['@/studio/View1.tao']!,
          ], { studio: true })
          manifest.renders = compiled.studioManifest!.renders.map(render => ({
            ...render,
            source: {
              kind: 'tao' as const,
              path: render.source.path,
              range: { start: render.source.start, end: render.source.end },
            },
          }))
          manifest.sourceVersions = Object.fromEntries(
            await Promise.all(
              files.absolutePaths().map(
                async path => [path, SourceActions.studioSourceVersion(await FS.readText(path))],
              ),
            ),
          )
          manifest.sourceVersions = {
            ...manifest.sourceVersions,
            ...Object.fromEntries(
              Object.entries(sourceOverrides ?? {}).map((
                [path, source],
              ) => [path, SourceActions.studioSourceVersion(source)]),
            ),
          }
        }
        const failed = failure === 'compile'
        if (failed) {
          failure = undefined
        }
        return {
          causes: [],
          changes: [],
          compileRevision: compiles.length,
          diagnostics: [],
          message: failed ? 'injected compile failure' : 'compiled',
          status: failed ? 'error' : 'compiled',
        }
      },
    })
    const browsed = await feed.browse({
      seed: 'seed',
      liveRows: { Playlist: [{ fields: { Title: 'Transient title' }, name: 'Live' }] },
    })
    const rowId = browsed.inventory.entities[0]!.sources.find(source => source.kind === 'live')!.rows[0]!.id
    const selectRequest = {
      catalogRevision: 1,
      draftRevision: 0,
      kind: 'select' as const,
      requestId: 'select',
      rowId,
      sketchId: 'card',
    }
    await run({
      action: (kind, requestId, draftRevision, catalogRevision = 1) =>
        feed.action({ kind, requestId, draftRevision, catalogRevision }),
      catalog,
      manifest,
      compiles,
      data: paths['Data.tao']!,
      entryPath: paths['Main.tao']!,
      root,
      fail: kind => {
        failure = kind
      },
      feed,
      files,
      realCompile: () => {
        actualCompile = true
      },
      onCompile: effect => {
        compileEffect = effect
      },
      select: () => feed.action(selectRequest),
      selectRequest,
      sketches: FS.resolvePath('@/studio/Sketches.tao', root),
      view: paths['@/studio/View1.tao']!,
    })
  })
}

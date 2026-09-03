import { Errors, FS } from '@shared'
import { Expect, Test, withTaoFiles } from '@shared/test'
import {
  StudioSketchCatalog,
  StudioSketchCatalogConflictError,
  studioSketchCatalogRelativePath,
  type StudioSketchCatalogRequest,
  type StudioSketchRect,
} from '../studio-src/StudioSketchCatalog'

const cover: StudioSketchRect = {
  content: 'Cover art',
  height: 52,
  id: 'rect-cover',
  kind: 'Placeholder',
  width: 52,
  x: 12,
  y: 12,
}

Test('Studio sketch catalog creates canonical ordered free geometry and reads JSONC', async () => {
  await withTaoFiles('tao-studio-sketch-catalog-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const provider = new StudioSketchCatalog(root)
    Expect(await provider.read()).toEqual({ formatVersion: 1, nextViewNumber: 1, revision: 0, sketches: [] })

    const result = await provider.apply({
      action: {
        height: 76,
        id: 'sketch-row',
        kind: 'create-sketch',
        project: 'music',
        rects: [cover, { height: 14, id: 'rect-title', kind: 'Text', width: 180, x: 78, y: 16 }],
        width: 360,
      },
      expectedRevision: 0,
      requestId: 'create-row',
    })

    Expect(result.createdSketch).toMatchObject({ id: 'sketch-row', name: 'View1', view: 'View1' })
    Expect(result.catalog.sketches[0]?.rects.map(rect => rect.id)).toEqual(['rect-cover', 'rect-title'])
    Expect(await FS.readText(provider.path())).toBe(`{
  "formatVersion": 1,
  "nextViewNumber": 2,
  "revision": 1,
  "sketches": [
    {
      "height": 76,
      "id": "sketch-row",
      "name": "View1",
      "project": "music",
      "rects": [
        {
          "content": "Cover art",
          "height": 52,
          "id": "rect-cover",
          "kind": "Placeholder",
          "width": 52,
          "x": 12,
          "y": 12
        },
        {
          "height": 14,
          "id": "rect-title",
          "kind": "Text",
          "width": 180,
          "x": 78,
          "y": 16
        }
      ],
      "view": "View1",
      "width": 360
    }
  ]
}
`)

    await FS.writeText(
      provider.path(),
      `// committed Studio state
    {
      "formatVersion": 1,
      "nextViewNumber": 2,
      "revision": 1,
      "sketches": [
        {
          "height": 76, "id": "sketch-row", "name": "View1", "project": "music",
          "rects": [
            { "height": 14, "id": "rect-title", "kind": "Text", "width": 180, "x": 78, "y": 16, },
          ],
          "view": "View1", "width": 360,
        },
      ],
    }
    `,
    )
    Expect((await provider.read()).sketches[0]?.rects[0]?.kind).toBe('Text')
  })
})

Test('Studio sketch actions preserve row order and support edit, duplicate, and delete', async () => {
  await withTaoFiles('tao-studio-sketch-actions-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const provider = new StudioSketchCatalog(root)
    let revision = 0
    await provider.apply(createSketchRequest(revision++))
    await provider.apply({
      action: {
        afterRectId: 'rect-cover',
        kind: 'add-rect',
        rect: { height: 12, id: 'rect-subtitle', kind: 'Text', width: 120, x: 80, y: 35 },
        sketchId: 'sketch-row',
      },
      expectedRevision: revision,
      requestId: 'add-subtitle',
    })
    revision += 1
    await provider.apply({
      action: {
        kind: 'update-rect',
        rect: {
          binding: 'Playlist.Name',
          content: 'Mix',
          height: 16,
          id: 'rect-subtitle',
          kind: 'Button',
          width: 140,
          x: 82,
          y: 36,
        },
        rectId: 'rect-subtitle',
        sketchId: 'sketch-row',
      },
      expectedRevision: revision,
      requestId: 'edit-subtitle',
    })
    revision += 1
    await provider.apply({
      action: {
        id: 'rect-copy',
        kind: 'duplicate-rect',
        rectId: 'rect-subtitle',
        sketchId: 'sketch-row',
        x: 90,
        y: 56,
      },
      expectedRevision: revision,
      requestId: 'duplicate-subtitle',
    })
    revision += 1
    const deleted = await provider.apply({
      action: { kind: 'delete-rect', rectId: 'rect-cover', sketchId: 'sketch-row' },
      expectedRevision: revision,
      requestId: 'delete-cover',
    })

    const rects = deleted.catalog.sketches[0]!.rects
    Expect(rects.map(rect => rect.id)).toEqual(['rect-subtitle', 'rect-copy'])
    Expect(rects[0]).toMatchObject({ binding: 'Playlist.Name', content: 'Mix', kind: 'Button', width: 140 })
    Expect(rects[1]).toMatchObject({ binding: 'Playlist.Name', content: 'Mix', x: 90, y: 56 })
  })
})

Test('Studio sketch view allocation stays monotonic across deletion and reopen', async () => {
  await withTaoFiles('tao-studio-sketch-names-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const first = new StudioSketchCatalog(root)
    await first.apply(createSketchRequest(0))
    await first.apply({
      action: { id: 'sketch-row', kind: 'delete-sketch' },
      expectedRevision: 1,
      requestId: 'delete-view-1',
    })

    const reopened = new StudioSketchCatalog(root)
    const second = await reopened.apply({
      action: {
        height: 76,
        id: 'sketch-second',
        kind: 'create-sketch',
        project: 'music',
        rects: [cover],
        width: 360,
      },
      expectedRevision: 2,
      requestId: 'create-view-2',
    })
    Expect(second.createdSketch?.name).toBe('View2')
    Expect(second.catalog.nextViewNumber).toBe(3)
  })
})

Test('Studio sketch catalog rejects malformed, stale, duplicate, and unsupported data', async () => {
  await withTaoFiles('tao-studio-sketch-validation-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const provider = new StudioSketchCatalog(root)
    await FS.writeText(provider.path(), '{ "formatVersion": 1, nope }')
    await Expect(provider.read()).rejects.toThrow(
      `Studio sketch catalog is malformed JSONC: ${studioSketchCatalogRelativePath}`,
    )

    await FS.writeText(
      provider.path(),
      JSON.stringify({
        formatVersion: 1,
        nextViewNumber: 2,
        revision: 1,
        sketches: [{
          height: 1,
          id: 's',
          name: 'View1',
          project: 'p',
          rects: [{ ...cover, width: 0 }],
          view: 'View1',
          width: 1,
        }],
      }),
    )
    await Expect(provider.read()).rejects.toThrow('Studio sketch s.rects[0].width must be positive.')

    await FS.writeText(
      provider.path(),
      JSON.stringify({
        formatVersion: 1,
        nextViewNumber: 2,
        revision: 1,
        sketches: [{
          height: 1,
          id: 's',
          name: 'View1',
          project: 'p',
          rects: [cover, { ...cover }],
          view: 'View1',
          width: 1,
        }],
      }),
    )
    await Expect(provider.read()).rejects.toThrow('Studio sketch catalog has duplicate rectangle id: rect-cover')

    await FS.writeText(
      provider.path(),
      JSON.stringify({
        formatVersion: 1,
        nextViewNumber: 2,
        revision: 1,
        sketches: [{
          height: 1,
          id: 's',
          name: 'View1',
          project: 'p',
          rects: [{ ...cover, kind: 'not an element' }],
          view: 'View1',
          width: 1,
        }],
      }),
    )
    await Expect(provider.read()).rejects.toThrow('must be a Tao element name')

    await FS.writeText(
      provider.path(),
      JSON.stringify({
        formatVersion: 1,
        nextViewNumber: 2,
        revision: 1,
        sketches: [{
          extra: true,
          height: 1,
          id: 's',
          name: 'View1',
          project: 'p',
          rects: [],
          view: 'View1',
          width: 1,
        }],
      }),
    )
    await Expect(provider.read()).rejects.toThrow('unsupported fields: extra')

    await FS.writeText(
      provider.path(),
      JSON.stringify({
        formatVersion: 1,
        nextViewNumber: 2,
        revision: 1,
        sketches: [{ height: 1, id: 's', name: 'Card', project: 'p', rects: [], view: 'View99', width: 1 }],
      }),
    )
    await Expect(provider.read()).rejects.toThrow(
      'Studio sketch catalog nextViewNumber must be greater than every allocated View number.',
    )

    await FS.writeText(
      provider.path(),
      JSON.stringify({
        formatVersion: 1,
        nextViewNumber: 100,
        revision: 1,
        sketches: [{ height: 1, id: 's', name: 'Card', project: 'p', rects: [], view: 'Card', width: 1 }],
      }),
    )
    await Expect(provider.read()).rejects.toThrow(
      'Studio sketch sketches[0].view must be a generated View number.',
    )
  })
})

Test('Studio sketch requests serialize concurrent edits, reject stale revisions, and replay idempotently', async () => {
  await withTaoFiles('tao-studio-sketch-concurrency-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const provider = new StudioSketchCatalog(root)
    const request = createSketchRequest(0)
    const first = await provider.apply(request)
    const retried = await provider.apply(request)
    Expect(retried).toBe(first)

    await Expect(provider.apply({
      action: {
        height: 76,
        id: 'sketch-row',
        kind: 'create-sketch',
        project: 'music',
        rects: [cover],
        width: 361,
      },
      expectedRevision: 0,
      requestId: 'create-row',
    })).rejects.toThrow('Studio sketch request id was reused: create-row')

    const stale = provider.apply({
      action: { kind: 'delete-rect', rectId: 'rect-cover', sketchId: 'sketch-row' },
      expectedRevision: 1,
      requestId: 'concurrent-first',
    })
    const raced = provider.apply({
      action: { kind: 'delete-sketch', id: 'sketch-row' },
      expectedRevision: 1,
      requestId: 'concurrent-second',
    })
    await stale
    await Expect(raced).rejects.toBeInstanceOf(StudioSketchCatalogConflictError)
    await raced.catch(error => {
      Expect((error as StudioSketchCatalogConflictError).code).toBe('stale-sketch-catalog')
      Expect((error as StudioSketchCatalogConflictError).actualRevision).toBe(2)
    })
  })
})

Test(
  'Studio sketch catalog keeps the prior file and cleans its temporary file when atomic replacement fails',
  async () => {
    await withTaoFiles('tao-studio-sketch-atomic-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
      const initial = new StudioSketchCatalog(root)
      await initial.apply(createSketchRequest(0))
      const before = await FS.readText(initial.path())
      const failing = new StudioSketchCatalog(root, {
        move: async () => Errors.throwHostEnvironment('simulated atomic rename failure'),
      })

      await Expect(failing.apply({
        action: { id: 'sketch-row', kind: 'delete-sketch' },
        expectedRevision: 1,
        requestId: 'failed-delete',
      })).rejects.toThrow('simulated atomic rename failure')
      Expect(await FS.readText(initial.path())).toBe(before)
      Expect((await FS.listDir(FS.dirname(initial.path()))).filter(name => name.endsWith('.tmp'))).toEqual([])

      const recovered = await failing.read()
      Expect(recovered.revision).toBe(1)
      Expect(recovered.sketches.map(sketch => sketch.id)).toEqual(['sketch-row'])
    })
  },
)

Test('Studio sketch catalog restores a prior snapshot after a downstream transaction fails', async () => {
  await withTaoFiles('tao-studio-sketch-restore-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const provider = new StudioSketchCatalog(root)
    const before = await provider.read()
    const request = createSketchRequest(0)
    await provider.apply(request)

    await provider.restore(before)
    Expect(await provider.read()).toEqual(before)
    Expect(await FS.readText(provider.path())).toContain('"nextViewNumber": 1')

    // Rollback clears the stale idempotency result, so an outer transaction can retry the request.
    const retried = await provider.apply(request)
    Expect(retried.createdSketch?.name).toBe('View1')
    Expect(retried.catalog.revision).toBe(1)
  })
})

function createSketchRequest(expectedRevision: number): StudioSketchCatalogRequest {
  return {
    action: {
      height: 76,
      id: 'sketch-row',
      kind: 'create-sketch',
      project: 'music',
      rects: [cover],
      width: 360,
    },
    expectedRevision,
    requestId: 'create-row',
  }
}

import { Errors, FS } from '@shared'
import { Expect, Test, withTaoFiles } from '@shared/test'
import {
  StudioSketchCatalog,
  StudioSketchCatalogConflictError,
  studioSketchCatalogRelativePath,
  type StudioSketchCatalogRequest,
  type StudioSketchRect,
  type StudioSketchRenderTarget,
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

Test('Studio sketch catalog records the project by name, never by host path', async () => {
  await withTaoFiles('tao-studio-sketch-project-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const provider = new StudioSketchCatalog(root)
    // Studio hands the catalog the open project's absolute root. The catalog is committed with the
    // project, so what lands in it has to be the same on every checkout, not one machine's path.
    const created = await provider.apply({
      action: {
        height: 76,
        id: 'sketch-row',
        kind: 'create-sketch',
        project: '/Users/someone/code/checkout/Apps/HNReader/',
        rects: [cover],
        width: 360,
      },
      expectedRevision: 0,
      requestId: 'create-row',
    })
    Expect(created.createdSketch?.project).toBe('HNReader')
    Expect(await FS.readText(provider.path())).not.toContain('/Users/someone')

    // A catalog committed before this still loads, and reads back as the project it names.
    await FS.writeText(
      provider.path(),
      (await FS.readText(provider.path())).replace(
        '"project": "HNReader"',
        '"project": "/Users/someone/code/checkout/Apps/HNReader"',
      ),
    )
    Expect((await provider.read()).sketches[0]?.project).toBe('HNReader')
  })
})

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

    Expect(result.createdSketch).toMatchObject({ id: 'sketch-row', name: 'View1', view: 'View1', x: 0, y: 0 })
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
      "rectOrder": [
        "rect-cover",
        "rect-title"
      ],
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
      "snapped": [],
      "view": "View1",
      "width": 360,
      "x": 0,
      "y": 0
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
          "rectOrder": ["rect-title"],
          "rects": [
            { "height": 14, "id": "rect-title", "kind": "Text", "width": 180, "x": 78, "y": 16, },
          ],
          "snapped": [],
          "view": "View1", "width": 360,
        },
      ],
    }
    `,
    )
    const parsed = await provider.read()
    Expect(parsed).toMatchObject({ formatVersion: 1, revision: 1 })
    Expect(parsed.sketches[0]?.rects[0]?.kind).toBe('Text')
    Expect(parsed.sketches[0]?.snapped).toEqual([])
    Expect(await FS.readText(provider.path())).toContain('// committed Studio state')
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
          fieldBinding: { parameter: 'Playlist', path: 'Name', presentation: { kind: 'text' } },
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
    Expect(deleted.catalog.sketches[0]!.rectOrder).toEqual(['rect-subtitle', 'rect-copy'])
    Expect(rects[0]).toMatchObject({
      content: 'Mix',
      fieldBinding: { parameter: 'Playlist', path: 'Name', presentation: { kind: 'text' } },
      kind: 'Button',
      width: 140,
    })
    Expect(rects[1]).toMatchObject({
      fieldBinding: { parameter: 'Playlist', path: 'Name', presentation: { kind: 'text' } },
      x: 90,
      y: 56,
    })
  })
})

Test('Studio sketch catalog keeps a created view at the drawn canvas origin', async () => {
  await withTaoFiles('tao-studio-sketch-origin-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const provider = new StudioSketchCatalog(root)
    const result = await provider.apply({
      action: {
        height: 76,
        id: 'sketch-row',
        kind: 'create-sketch',
        project: 'music',
        rects: [],
        width: 360,
        x: 80,
        y: 40,
      },
      expectedRevision: 0,
      requestId: 'create-origin',
    })
    Expect(result.createdSketch).toMatchObject({ height: 76, name: 'View1', width: 360, x: 80, y: 40 })
    Expect((await provider.read()).sketches[0]).toMatchObject({ x: 80, y: 40 })
  })
})

Test('Studio sketch actions atomically move selected free rows into strict associations and back', async () => {
  await withTaoFiles('tao-studio-sketch-associations-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const provider = new StudioSketchCatalog(root)
    await provider.apply({
      action: {
        height: 76,
        id: 'sketch-row',
        kind: 'create-sketch',
        project: 'music',
        rects: [
          cover,
          { content: 'Title', height: 20, id: 'rect-title', kind: 'Text', width: 120, x: 76, y: 12 },
          { content: 'Free', height: 20, id: 'rect-free', kind: 'Text', width: 50, x: 76, y: 42 },
        ],
        width: 360,
      },
      expectedRevision: 0,
      requestId: 'create-row',
    })

    const snapped = await provider.apply({
      action: {
        kind: 'snap-rects',
        sketchId: 'sketch-row',
        targets: [target('rect-cover', 'Placeholder', 100, 160), target('rect-title', 'Text', 161, 205)],
      },
      expectedRevision: 1,
      requestId: 'snap-selected',
    })
    const sketch = snapped.catalog.sketches[0]!
    Expect(sketch.rects.map(rect => rect.id)).toEqual(['rect-free'])
    Expect(sketch.rectOrder).toEqual(['rect-cover', 'rect-title', 'rect-free'])
    Expect(sketch.snapped.map(item => item.rect.id)).toEqual(['rect-cover', 'rect-title'])
    Expect(sketch.snapped[0]).toEqual({
      rect: cover,
      target: target('rect-cover', 'Placeholder', 100, 160),
    })

    const unsnapped = await provider.apply({
      action: {
        kind: 'unsnap-rects',
        rectIds: ['rect-cover'],
        sketchId: 'sketch-row',
        targets: [target('rect-title', 'Text', 300, 340)],
      },
      expectedRevision: 2,
      requestId: 'unsnap-cover',
    })
    Expect(unsnapped.catalog.sketches[0]?.rects.map(rect => rect.id)).toEqual(['rect-cover', 'rect-free'])
    Expect(unsnapped.catalog.sketches[0]?.rects[0]).toEqual(cover)
    Expect(unsnapped.catalog.sketches[0]?.snapped.map(item => item.rect.id)).toEqual(['rect-title'])
    Expect(unsnapped.catalog.sketches[0]?.snapped[0]?.target).toEqual(target('rect-title', 'Text', 300, 340))
    Expect(unsnapped.catalog.sketches[0]?.rectOrder).toEqual(['rect-cover', 'rect-title', 'rect-free'])

    const resnapped = await provider.apply({
      action: {
        kind: 'snap-rects',
        sketchId: 'sketch-row',
        targets: [target('rect-cover', 'Placeholder', 400, 450), target('rect-title', 'Text', 451, 500)],
      },
      expectedRevision: 3,
      requestId: 'resnap-cover',
    })
    Expect(resnapped.catalog.sketches[0]?.snapped.map(item => item.rect.id)).toEqual(['rect-cover', 'rect-title'])
    Expect(resnapped.catalog.sketches[0]?.snapped.map(item => item.target.renderId)).toEqual([
      target('rect-cover', 'Placeholder', 400, 450).renderId,
      target('rect-title', 'Text', 451, 500).renderId,
    ])
  })
})

Test('Studio bind-rect updates free and snapped bindings without disturbing geometry, target, or order', async () => {
  await withTaoFiles('tao-studio-sketch-bind-', { 'Project.tao': 'project Music\n' }, async (_paths, root) => {
    const provider = new StudioSketchCatalog(root)
    await provider.apply(createSketchRequest(0))
    const freeBinding = {
      parameter: 'Playlist',
      path: 'Title',
      presentation: { kind: 'text' as const, label: { path: 'Owner.Name', prefix: 'By ', suffix: '!' } },
    }
    const boundFree = await provider.apply({
      action: { binding: freeBinding, kind: 'bind-rect', rectId: 'rect-cover', sketchId: 'sketch-row' },
      expectedRevision: 1,
      requestId: 'bind-free',
    })
    Expect(boundFree.catalog.sketches[0]?.rects[0]).toEqual({ ...cover, fieldBinding: freeBinding })
    const snapped = await provider.apply({
      action: {
        kind: 'snap-rects',
        sketchId: 'sketch-row',
        targets: [target('rect-cover', 'Placeholder', 10, 20)],
      },
      expectedRevision: 2,
      requestId: 'snap-bound',
    })
    const before = snapped.catalog.sketches[0]!
    const imageBinding = { parameter: 'Playlist', path: 'Cover.Url', presentation: { kind: 'image' as const } }
    const boundSnapped = await provider.apply({
      action: { binding: imageBinding, kind: 'bind-rect', rectId: 'rect-cover', sketchId: 'sketch-row' },
      expectedRevision: 3,
      requestId: 'bind-snapped',
    })
    const after = boundSnapped.catalog.sketches[0]!
    Expect(after.snapped[0]?.rect).toEqual({ ...before.snapped[0]!.rect, fieldBinding: imageBinding })
    Expect(after.snapped[0]?.target).toEqual(before.snapped[0]?.target)
    Expect(after.rectOrder).toEqual(before.rectOrder)
  })
})

Test('Studio bind-rect validates exact typed payloads and preserves stale/idempotent request behavior', async () => {
  await withTaoFiles(
    'tao-studio-sketch-bind-validation-',
    { 'Project.tao': 'project Music\n' },
    async (_paths, root) => {
      const provider = new StudioSketchCatalog(root)
      await provider.apply(createSketchRequest(0))
      const request = {
        action: {
          binding: { parameter: 'Playlist', path: 'Title', presentation: { kind: 'text' as const } },
          kind: 'bind-rect' as const,
          rectId: 'rect-cover',
          sketchId: 'sketch-row',
        },
        expectedRevision: 1,
        requestId: 'bind-idempotent',
      }
      const first = await provider.apply(request)
      Expect(await provider.apply(request)).toBe(first)
      await Expect(provider.apply({ ...request, expectedRevision: 1, requestId: 'bind-stale' }))
        .rejects.toBeInstanceOf(StudioSketchCatalogConflictError)
      for (
        const binding of [
          { parameter: 'not valid', path: 'Title', presentation: { kind: 'text' } },
          { parameter: 'Playlist', path: '', presentation: { kind: 'text' } },
          { parameter: 'Playlist', path: 'Title', presentation: { kind: 'video' } },
          { extra: true, parameter: 'Playlist', path: 'Title', presentation: { kind: 'text' } },
        ]
      ) {
        await Expect(provider.apply({
          action: { binding, kind: 'bind-rect', rectId: 'rect-cover', sketchId: 'sketch-row' },
          expectedRevision: 2,
          requestId: `malformed-${JSON.stringify(binding)}`,
        } as never)).rejects.toBeInstanceOf(Errors.UserInputError)
      }
    },
  )
})

Test(
  'Studio sketch associations record the emitted fallback element independently of the free rectangle kind',
  async () => {
    await withTaoFiles(
      'tao-studio-sketch-fallback-association-',
      { 'Project.tao': 'project Music\n' },
      async (_paths, root) => {
        const provider = new StudioSketchCatalog(root)
        await provider.apply({
          action: {
            height: 76,
            id: 'sketch-row',
            kind: 'create-sketch',
            project: 'music',
            rects: [{ ...cover, id: 'rect-avatar', kind: 'Avatar' }],
            width: 360,
          },
          expectedRevision: 0,
          requestId: 'create-avatar',
        })

        const result = await provider.apply({
          action: {
            kind: 'snap-rects',
            sketchId: 'sketch-row',
            targets: [target('rect-avatar', 'Placeholder', 10, 40)],
          },
          expectedRevision: 1,
          requestId: 'snap-avatar-fallback',
        })

        Expect(result.catalog.sketches[0]?.snapped[0]).toMatchObject({
          rect: { id: 'rect-avatar', kind: 'Avatar' },
          target: { elementName: 'Placeholder', studioRectId: 'rect-avatar' },
        })
      },
    )
  },
)

Test(
  'Studio sketch association validation rejects mismatched and duplicate targets without changing the catalog',
  async () => {
    await withTaoFiles(
      'tao-studio-sketch-association-validation-',
      { 'Project.tao': 'project Music\n' },
      async (_paths, root) => {
        const provider = new StudioSketchCatalog(root)
        await provider.apply(createSketchRequest(0))
        const before = await FS.readText(provider.path())

        await Expect(provider.apply({
          action: {
            kind: 'snap-rects',
            sketchId: 'sketch-row',
            targets: [{ ...target('rect-cover', 'Text', 10, 20), view: 'View2' }],
          },
          expectedRevision: 1,
          requestId: 'wrong-view',
        })).rejects.toThrow('must target its sketch view View1')
        await Expect(provider.apply({
          action: {
            kind: 'snap-rects',
            sketchId: 'sketch-row',
            targets: [target('rect-cover', 'Placeholder', 10, 20), target('rect-cover', 'Placeholder', 10, 20)],
          },
          expectedRevision: 1,
          requestId: 'duplicate-target',
        })).rejects.toThrow('duplicate snap rectangle id: rect-cover')
        Expect(await FS.readText(provider.path())).toBe(before)
        Expect((await provider.read()).revision).toBe(1)
      },
    )
  },
)

Test('Studio sketch Snap and Unsnap require complete post-operation target sets', async () => {
  await withTaoFiles(
    'tao-studio-sketch-complete-targets-',
    { 'Project.tao': 'project Music\n' },
    async (_paths, root) => {
      const provider = new StudioSketchCatalog(root)
      await provider.apply({
        action: {
          height: 76,
          id: 'sketch-row',
          kind: 'create-sketch',
          project: 'music',
          rects: [cover, { ...cover, id: 'rect-title', kind: 'Text', x: 80 }],
          width: 360,
        },
        expectedRevision: 0,
        requestId: 'create-two',
      })
      await provider.apply({
        action: {
          kind: 'snap-rects',
          sketchId: 'sketch-row',
          targets: [target('rect-cover', 'Placeholder', 10, 20)],
        },
        expectedRevision: 1,
        requestId: 'snap-cover',
      })
      const before = await FS.readText(provider.path())

      await Expect(provider.apply({
        action: {
          kind: 'snap-rects',
          sketchId: 'sketch-row',
          targets: [target('rect-title', 'Text', 30, 40)],
        },
        expectedRevision: 2,
        requestId: 'incomplete-snap',
      })).rejects.toThrow('Snap targets must cover every surviving snapped rectangle exactly once')
      await Expect(provider.apply({
        action: { kind: 'unsnap-rects', rectIds: ['rect-cover'], sketchId: 'sketch-row', targets: [] },
        expectedRevision: 2,
        requestId: 'complete-unsnap',
      })).resolves.toMatchObject({ catalog: { revision: 3 } })
      Expect(await FS.readText(provider.path())).not.toBe(before)

      await provider.apply({
        action: {
          kind: 'snap-rects',
          sketchId: 'sketch-row',
          targets: [
            target('rect-cover', 'Placeholder', 50, 60),
            target('rect-title', 'Text', 61, 70),
          ],
        },
        expectedRevision: 3,
        requestId: 'snap-both',
      })
      const both = await FS.readText(provider.path())
      await Expect(provider.apply({
        action: { kind: 'unsnap-rects', rectIds: ['rect-cover'], sketchId: 'sketch-row', targets: [] },
        expectedRevision: 4,
        requestId: 'incomplete-unsnap',
      })).rejects.toThrow('Unsnap targets must cover every surviving snapped rectangle exactly once')
      Expect(await FS.readText(provider.path())).toBe(both)
    },
  )
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
      JSON.stringify({ formatVersion: 2, nextViewNumber: 1, revision: 0, sketches: [] }),
    )
    await Expect(provider.read()).rejects.toThrow('Studio sketch catalog formatVersion must be 1.')

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
          rectOrder: ['rect-cover'],
          rects: [{ ...cover, binding: 'Playlist.Cover' }],
          snapped: [],
          view: 'View1',
          width: 1,
        }],
      }),
    )
    await Expect(provider.read()).rejects.toThrow('unsupported fields: binding')

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
          rectOrder: ['rect-cover'],
          rects: [{ ...cover, width: 0 }],
          snapped: [],
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
        sketches: [
          {
            height: 1,
            id: 's-1',
            name: 'View1',
            project: 'p',
            rectOrder: ['rect-cover'],
            rects: [cover],
            snapped: [],
            view: 'View1',
            width: 1,
          },
          {
            height: 1,
            id: 's-2',
            name: 'View2',
            project: 'p',
            rectOrder: ['rect-cover'],
            rects: [{ ...cover }],
            snapped: [],
            view: 'View2',
            width: 1,
          },
        ],
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
          rectOrder: ['rect-cover'],
          rects: [{ ...cover, kind: 'not an element' }],
          snapped: [],
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
          rectOrder: [],
          rects: [],
          snapped: [],
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
        sketches: [{
          height: 1,
          id: 's',
          name: 'Card',
          project: 'p',
          rectOrder: [],
          rects: [],
          snapped: [],
          view: 'View99',
          width: 1,
        }],
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
        sketches: [{
          height: 1,
          id: 's',
          name: 'Card',
          project: 'p',
          rectOrder: [],
          rects: [],
          snapped: [],
          view: 'Card',
          width: 1,
        }],
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

function target(
  studioRectId: string,
  elementName: string,
  start: number,
  end: number,
): StudioSketchRenderTarget {
  const path = '/project/@/studio/View1.tao'
  return {
    elementName,
    path,
    renderId: `${path}:${start}:${end}`,
    sourceVersion: 'source-2',
    studioRectId,
    view: 'View1',
  }
}

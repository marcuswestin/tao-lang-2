import { AST } from '@parser'
import { Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import SourceActions, {
  type StudioComponentKind,
  type StudioLayoutEntry,
  type StudioSourcePatchRequest,
} from '../source-actions-src/source-actions'
import { parseDocument, parseRawDocument } from './test-source-actions'

Describe('Studio source-action patch bus', () => {
  Test('inserts a current-dialect component and returns a full-document versioned edit', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Text("First")
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      component: 'Text',
      kind: 'insert-component',
    })

    Expect(patch.content).toBe(source(`
      use Text from @tao/ui

      view MainView() {
         render Stack() {
            Text("First")
            Text("New text")
      }  }
    `))
    Expect(patch.edits).toEqual([{
      end: document.textDocument.getText().length,
      replacement: patch.content,
      start: 0,
    }])
    Expect(patch.sourcePath).toBe(document.uri.fsPath)
    Expect(patch.sourceVersion).toMatch(/^text-v1:\d+:[a-z0-9]+$/)
    Expect(
      (await SourceActions.applyStudioPatch(document, {
        component: 'Text',
        kind: 'insert-component',
      })).sourceVersion,
    ).toBe(patch.sourceVersion)
  })

  Test('merges a missing palette component into the existing Tao UI import', async () => {
    const document = await parseDocument(`
      use Stack, Text from @tao/ui

      view MainView() {
         render Stack() { Text("First") }
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      component: 'Button',
      kind: 'insert-component',
    })

    Expect(patch.content).toContain('use Button, Stack, Text from @tao/ui')
    Expect(patch.content).toContain('Button("New button")')
  })

  Test('inserts a zero-argument project view with required parentheses', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Text("First")
      }  }

      view EmptyCard() {
         render Text("Card")
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'insert-project-view',
      viewName: 'EmptyCard',
    })

    Expect(patch.content).toBe(source(`
      view MainView() {
         render Stack() {
            Text("First")
            EmptyCard()
      }  }

      view EmptyCard() {
         render Text("Card")
      }
    `))
  })

  Test('inserts a component at a render gap identified by the move-render anchors', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Text("First")
            Text("Second")
      }  }
    `)
    const ids = renderIdsByText(document)
    const patch = await SourceActions.applyStudioPatch(document, {
      beforeId: ids['Second']!,
      component: 'Number',
      kind: 'insert-component',
    })

    Expect(patch.content.indexOf('Text("First")')).toBeLessThan(patch.content.indexOf('Number(0)'))
    Expect(patch.content.indexOf('Number(0)')).toBeLessThan(patch.content.indexOf('Text("Second")'))
  })

  Test('renders every typed palette choice in current dialect and rejects arbitrary payloads', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() { Text("First") }
      }
    `)

    for (
      const component of [
        'Box',
        'Button',
        'Checkbox',
        'Col',
        'DatePicker',
        'FormButton',
        'Image',
        'Number',
        'Panes',
        'Picker',
        'Progress',
        'Row',
        'ScrollView',
        'SegmentedControl',
        'Slider',
        'Spinner',
        'Stack',
        'Switch',
        'Text',
        'TextFrame',
        'TextInput',
        'TextMultiline',
        'WrappingRow',
      ] satisfies StudioComponentKind[]
    ) {
      const patch = await SourceActions.applyStudioPatch(document, {
        component,
        kind: 'insert-component',
      })
      const updated = await parseRawDocument(patch.content)
      Expect(updated.parseResult.lexerErrors).toEqual([])
      Expect(updated.parseResult.parserErrors).toEqual([])
    }

    const arbitraryPayload = {
      kind: 'insert-component',
      snippet: 'Text("One")\nstate Hidden is number = 1',
    } as unknown as StudioSourcePatchRequest
    await Expect(SourceActions.applyStudioPatch(document, arbitraryPayload)).rejects.toThrow(
      'Unsupported Studio palette component',
    )
  })

  Test('imports every declaration referenced by a palette snippet', async () => {
    const document = await parseDocument(`
      use Stack from @tao/ui
      view MainView() { render Stack() { } }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      component: 'Stack',
      kind: 'insert-component',
    })

    Expect(patch.content).toContain('use Stack, Text from @tao/ui')
  })

  Test('rejects missing and parameterized project views', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() { Text("First") }
      }

      view Card(Title text) {
         render Text(Title)
      }
    `)

    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'insert-project-view',
      viewName: 'Missing',
    })).rejects.toThrow('Project view is not declared in this source file')
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'insert-project-view',
      viewName: 'Card',
    })).rejects.toThrow('Cannot insert parameterized project view')
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'insert-project-view',
      viewName: 'MainView',
    })).rejects.toThrow('Cannot insert project view MainView into its own render block')
  })

  Test('adds and replaces semantic layout entries', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() [pad 4] {
            Text("First")
      }  }
    `)
    const firstPatch = await SourceActions.applyStudioPatch(document, {
      entry: ['gap', 8],
      kind: 'set-layout-entry',
      renderId: renderId(requireRenderByText(document, 'Stack()')),
    })

    Expect(firstPatch.content).toBe(source(`
      view MainView() {
         render Stack() [pad 4, gap 8] {
            Text("First")
      }  }
    `))

    const updatedDocument = await parseRawDocument(firstPatch.content)
    const replacementPatch = await SourceActions.applyStudioPatch(updatedDocument, {
      entry: ['gap', 16],
      kind: 'set-layout-entry',
      renderId: renderId(requireRenderByText(updatedDocument, 'Stack()')),
    })

    Expect(replacementPatch.content).toBe(source(`
      view MainView() {
         render Stack() [pad 4, gap 16] {
            Text("First")
      }  }
    `))
  })

  Test('inspects parsed layout and style values and edits current-dialect inline style', async () => {
    const document = await parseDocument(`
      workspace design Theme { ink #111 body [fg ink, size 14] }
      view MainView() {
         render Text("First") [gap 8, body, size 16]
      }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))
    const inspection = SourceActions.inspectStudioRender(document, id)

    Expect(inspection.layoutEntries).toEqual([['gap', 8]])
    Expect(inspection.styleEntries).toEqual([['body'], ['size', 16]])
    Expect(inspection.styleProvenance[0]).toEqual({
      blastRadius: 1,
      chain: ['body', 'fg ink', 'size 14'],
      landing: { bundleName: 'body', kind: 'style-bundle', mode: 'edit' },
    })

    const patch = await SourceActions.applyStudioPatch(document, {
      entry: ['size', 18],
      kind: 'set-style-entry',
      landing: { kind: 'element-inline' },
      renderId: id,
    })
    Expect(patch.content).toContain('Text("First") [gap 8, body, size 18]')
  })

  Test('inspects and promotes decided visual aliases and representable numeric families', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui
      workspace design Theme { ink #111 body [ink ink, size 16] }
      view MainView() {
         render Text("First") [body, background #c00, radius 8, pad 12]
      }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))
    const inspection = SourceActions.inspectStudioRender(document, id)

    Expect(inspection.styleEntries).toEqual([['body'], ['background', '#c00'], ['radius', 8]])
    Expect(inspection.explorations).toEqual([['background', '#c00'], ['radius', 8], ['pad', 12]])

    const token = await SourceActions.applyStudioPatch(document, {
      entry: ['background', '#c00'],
      kind: 'set-style-entry',
      landing: { kind: 'token', tokenName: 'danger' },
      renderId: id,
    })
    Expect(token.content).toContain('danger #c00')
    Expect(token.content).toContain('background danger')

    const promoted = await SourceActions.applyStudioPatch(document, {
      entry: ['radius', 8],
      kind: 'set-style-entry',
      landing: { elementName: 'Text', kind: 'element-default' },
      renderId: id,
    })
    Expect(promoted.content).toContain('Text [radius 8]')
    Expect(promoted.content).not.toContain('background danger')
  })

  Test('edits and forks a uniquely named current-dialect design bundle', async () => {
    const document = await parseDocument(`
      workspace design Theme { ink #111 body [fg ink, size 14] }
      view MainView() { render Text("First") [body] }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))
    const patch = await SourceActions.applyStudioPatch(document, {
      entry: ['size', 18],
      kind: 'set-style-entry',
      landing: { bundleName: 'body', kind: 'style-bundle', mode: 'edit' },
      renderId: id,
    })
    Expect(patch.content).toContain('body [fg ink, size 18]')

    const fork = await SourceActions.applyStudioPatch(document, {
      entry: ['size', 18],
      kind: 'set-style-entry',
      landing: { bundleName: 'body', kind: 'style-bundle', mode: 'fork' },
      renderId: id,
    })
    Expect(fork.content).toContain('bodyVariant [fg ink, size 18]')
    Expect(fork.content).toContain('Text("First") [bodyVariant]')
  })

  Test('inspects and lands edits, forks, defaults, colors, and sizes in structured design blocks', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui
      workspace design Theme {
         colors { ink #111 }
         sizes { sm 8.px }
         text { body [size sm, ink ink] }
         styles {
            card [radius sm, pad sm]
            Text [ink ink]
         }
      }
      view MainView() {
         render Stack() {
            Text("First") [card, body, size 18, background #c00]
            Text("Second") [card, size 18]
         }
      }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))
    const inspection = SourceActions.inspectStudioRender(document, id)
    Expect(inspection.styleProvenance.slice(0, 2)).toEqual([
      {
        blastRadius: 2,
        chain: ['card', 'radius sm', 'pad sm'],
        landing: { bundleName: 'card', kind: 'style-bundle', mode: 'edit' },
      },
      {
        blastRadius: 1,
        chain: ['body', 'size sm', 'ink ink'],
        landing: { bundleName: 'body', kind: 'style-bundle', mode: 'edit' },
      },
    ])

    const edited = await SourceActions.applyStudioPatch(document, {
      entry: ['radius', 12],
      kind: 'set-style-entry',
      landing: { bundleName: 'card', kind: 'style-bundle', mode: 'edit' },
      renderId: id,
    })
    Expect(edited.content).toContain('styles {\n      card [pad sm, radius 12]')

    const forked = await SourceActions.applyStudioPatch(document, {
      entry: ['radius', 12],
      kind: 'set-style-entry',
      landing: { bundleName: 'card', forkName: 'raisedCard', kind: 'style-bundle', mode: 'fork' },
      renderId: id,
    })
    Expect(forked.content).toContain('raisedCard [radius 12, pad sm]')
    Expect(forked.content).toContain('Text("First") [raisedCard, body, size 18, background #c00]')
    Expect(forked.content).toContain('Text("Second") [card, size 18]')

    const defaulted = await SourceActions.applyStudioPatch(document, {
      entry: ['size', 18],
      kind: 'set-style-entry',
      landing: { elementName: 'Text', kind: 'element-default' },
      renderId: id,
    })
    Expect(defaulted.content).toContain('Text [ink ink, size 18]')

    const colored = await SourceActions.applyStudioPatch(document, {
      entry: ['background', '#c00'],
      kind: 'set-style-entry',
      landing: { kind: 'token', tokenName: 'danger' },
      renderId: id,
    })
    Expect(colored.content).toContain('colors {\n      ink #111\n      danger #c00')
    Expect(colored.content).toContain('background danger')

    const sized = await SourceActions.applyStudioPatch(document, {
      entry: ['size', 18],
      kind: 'set-style-entry',
      landing: { kind: 'size-token', tokenName: 'titleSize' },
      renderId: id,
    })
    Expect(sized.content).toContain('sizes {\n      sm 8.px\n      titleSize 18.px')
    Expect(sized.content).toContain('Text("First") [card, body, size titleSize, background #c00]')
    Expect(sized.content).toContain('Text("Second") [card, size 18]')
  })

  Test('promotes a numeric dimensional exploration into a sizes block with release-safe source shape', async () => {
    const document = await parseDocument(`
      workspace design Theme { colors { ink #111 } styles { card [ink ink] } }
      view MainView() { render Text("First") [card, pad 12] }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))
    const promoted = await SourceActions.applyStudioPatch(document, {
      entry: ['pad', 12],
      kind: 'set-style-entry',
      landing: { kind: 'size-token', tokenName: 'cardPad' },
      renderId: id,
    })
    Expect(promoted.content).toContain('sizes {\n      cardPad 12.px\n   }')
    Expect(promoted.content).toContain('Text("First") [card, pad cardPad]')
    Expect(promoted.content).not.toContain('pad 12')
    await parseRawDocument(promoted.content)
  })

  Test('replaces visual aliases by their canonical slot instead of creating invalid duplicates', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui
      workspace design Theme {
         canvas #fff
         ink #111
         card [bg canvas, fg ink]
         Text [bg canvas]
      }
      view Main() { render Text("First") [card, bg #c00] }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))

    const edited = await SourceActions.applyStudioPatch(document, {
      entry: ['background', 'canvas'],
      kind: 'set-style-entry',
      landing: { bundleName: 'card', kind: 'style-bundle', mode: 'edit' },
      renderId: id,
    })
    Expect(edited.content).toContain('card [fg ink, background canvas]')
    Expect(edited.content).not.toContain('card [bg canvas')

    const forked = await SourceActions.applyStudioPatch(document, {
      entry: ['ink', 'ink'],
      kind: 'set-style-entry',
      landing: { bundleName: 'card', kind: 'style-bundle', mode: 'fork' },
      renderId: id,
    })
    Expect(forked.content).toContain('cardVariant [bg canvas, ink ink]')

    const element = await SourceActions.applyStudioPatch(document, {
      entry: ['background', 'canvas'],
      kind: 'set-style-entry',
      landing: { elementName: 'Text', kind: 'element-default' },
      renderId: id,
    })
    Expect(element.content).toContain('Text [background canvas]')
    Expect(element.content).not.toContain('Text [bg canvas, background canvas]')
  })

  Test('promotes a raw inline color to a token and replaces only the selected render entry', async () => {
    const document = await parseDocument(`
      workspace design Theme { ink #111 }
      view MainView() { render Text("First") [fg #c00] Text("Second") [fg #c00] }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))

    const patch = await SourceActions.applyStudioPatch(document, {
      entry: ['fg', '#c00'],
      kind: 'set-style-entry',
      landing: { kind: 'token', tokenName: 'danger' },
      renderId: id,
    })

    Expect(patch.content).toContain('danger #c00')
    Expect(patch.content).toContain('Text("First") [fg danger]')
    Expect(patch.content).toContain('Text("Second") [fg #c00]')
  })

  Test('promotes an inline exploration into a selected-render-only bundle fork', async () => {
    const document = await parseDocument(`
      workspace design Theme { ink #111 body [fg ink, size 14] }
      view MainView() { render Text("First") [body, size 18] }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))

    const patch = await SourceActions.applyStudioPatch(document, {
      entry: ['size', 18],
      kind: 'set-style-entry',
      landing: { bundleName: 'body', kind: 'style-bundle', mode: 'fork' },
      renderId: id,
    })

    Expect(patch.content).toContain('bodyVariant [fg ink, size 18]')
    Expect(patch.content).toContain('Text("First") [bodyVariant]')
  })

  Test('promotes an inline exploration to a standard element default', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui
      workspace design Theme { ink #111 }
      view MainView() { render Text("First") [size 18] }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))

    const patch = await SourceActions.applyStudioPatch(document, {
      entry: ['size', 18],
      kind: 'set-style-entry',
      landing: { elementName: 'Text', kind: 'element-default' },
      renderId: id,
    })

    Expect(patch.content).toContain('Text [size 18]')
    Expect(patch.content).toContain('render Text("First")')
    Expect(patch.content).not.toContain('Text("First") [size 18]')
  })

  Test('accepts exactly the current Studio layout vocabulary', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() { Text("First") }
      }
    `)
    const renderIdValue = renderId(requireRenderByText(document, 'Stack()'))
    const supportedEntries: readonly StudioLayoutEntry[] = [
      ['aligned', 'center'],
      ['centered'],
      ['claim', 2],
      ['compress'],
      ['content', 'top', 'stretch'],
      ['fill'],
      ['gap', 8],
      ['gap', 'spacing.compact'],
      ['height', 'fill'],
      ['height', 'surface.row'],
      ['hug'],
      ['margin', 'horizontal', 8, 'top', 4],
      ['margin', 'horizontal', 'spacing.gutter', 'top', 'spacing.compact'],
      ['pad', 8],
      ['pad', 'spacing.panel'],
      ['rigid'],
      ['width', 'max', 720],
      ['width', 'max', 'surface.readable'],
    ]

    for (const entry of supportedEntries) {
      const patch = await SourceActions.applyStudioPatch(document, {
        entry,
        kind: 'set-layout-entry',
        renderId: renderIdValue,
      })
      Expect(patch.content).toContain(`Stack() [${entry.join(' ')}]`)
    }
  })

  Test('rejects unsupported or malformed Studio layout entries before editing source', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() { Text("First") }
      }
    `)
    const renderIdValue = renderId(requireRenderByText(document, 'Stack()'))
    const invalidEntries = [
      ['fit'],
      ['gap', 0],
      ['content', 'left', 'right'],
      ['height', 'max', 720],
      ['aligned', 'stretch'],
      ['pad', 'horizontal', 8, 'left', 4],
      ['centered', 'extra'],
    ] as const

    for (const entry of invalidEntries) {
      await Expect(SourceActions.applyStudioPatch(document, {
        entry: entry as unknown as StudioLayoutEntry,
        kind: 'set-layout-entry',
        renderId: renderIdValue,
      })).rejects.toThrow(/Studio layout entry/)
    }
  })

  Test('replaces the effective last duplicate layout entry and rejects an incompatible result', async () => {
    const duplicateDocument = await parseDocument(`
      view MainView() {
         render Stack() [gap 4, gap 8] { Text("First") }
      }
    `)
    const patch = await SourceActions.applyStudioPatch(duplicateDocument, {
      entry: ['gap', 16],
      kind: 'set-layout-entry',
      renderId: renderId(requireRenderByText(duplicateDocument, 'Stack()')),
    })
    Expect(patch.content).toContain('Stack() [gap 4, gap 16]')

    const conflictDocument = await parseDocument(`
      view MainView() {
         render Stack() [rigid] { Text("First") }
      }
    `)
    await Expect(SourceActions.applyStudioPatch(conflictDocument, {
      entry: ['claim', 2],
      kind: 'set-layout-entry',
      renderId: renderId(requireRenderByText(conflictDocument, 'Stack()')),
    })).rejects.toThrow("incompatible 'claim' and 'rigid'")
  })

  Test('moves edited semantic layout slots last and preserves a composable width cap', async () => {
    const growthDocument = await parseDocument(`
      view MainView() {
         render Stack() [fill, hug] { Text("First") }
      }
    `)
    const growthPatch = await SourceActions.applyStudioPatch(growthDocument, {
      entry: ['fill'],
      kind: 'set-layout-entry',
      renderId: renderId(requireRenderByText(growthDocument, 'Stack()')),
    })
    Expect(growthPatch.content).toContain('Stack() [hug, fill]')

    const widthDocument = await parseDocument(`
      view MainView() {
         render Stack() [width fill, width max 720] { Text("First") }
      }
    `)
    const widthPatch = await SourceActions.applyStudioPatch(widthDocument, {
      entry: ['width', 320],
      kind: 'set-layout-entry',
      renderId: renderId(requireRenderByText(widthDocument, 'Stack()')),
    })
    Expect(widthPatch.content).toContain('Stack() [width max 720, width 320]')
  })

  Test('binds a render mutation to its exact owner and rejects a fabricated future node kind', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() { Text("First") }
      }
    `)
    const renderIdValue = renderId(requireRenderByText(document, 'Stack()'))
    const request = {
      entry: ['gap', 16] as const,
      kind: 'set-layout-entry' as const,
      renderId: renderIdValue,
    }
    const patch = await SourceActions.applyStudioPatch(document, request, {
      occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
    })
    Expect(patch.content).toContain('Stack() [gap 16]')

    await Expect(SourceActions.applyStudioPatch(document, request, {
      occurrence: { nodeKind: 'render', renderOwner: 'OtherView' },
    })).rejects.toMatchObject({
      actual: 'MainView',
      code: 'render-owner-mismatch',
      expected: 'OtherView',
    })
    await Expect(SourceActions.applyStudioPatch(document, request, {
      occurrence: { nodeKind: 'view', renderOwner: 'MainView' },
    })).rejects.toMatchObject({
      actual: 'render',
      code: 'node-kind-mismatch',
      expected: 'view',
    })
  })

  Test('wraps a render in a current-dialect Stack() container', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Text("First")
            Text("Second")
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'wrap-render',
      renderId: renderId(requireRenderByText(document, 'Text("Second")')),
      wrapper: 'Stack',
    })

    Expect(patch.content).toBe(source(`
      view MainView() {
         render Stack() {
            Text("First")
            Stack() [gap 8, pad 8] {
               Text("Second")
      }  }  }
    `))
  })

  Test('wraps a root render without dropping its required render keyword', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Text("Root")
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'wrap-render',
      renderId: renderId(requireRenderByText(document, 'Text("Root")')),
      wrapper: 'Stack',
    })

    Expect(patch.content).toBe(source(`
      view MainView() {
         render Stack() [gap 8, pad 8] {
            Text("Root")
      }  }
    `))
  })

  Test('moves a render between positions in the same block', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Text("First")
            Text("Second")
            Text("Third")
      }  }
    `)
    const ids = renderIdsByText(document)
    const patch = await SourceActions.applyStudioPatch(document, {
      afterId: ids['First']!,
      beforeId: ids['Second']!,
      draggedId: ids['Third']!,
      kind: 'move-render',
    })

    Expect(patch.content).toBe(source(`
      view MainView() {
         render Stack() {
            Text("First")
            Text("Third")
            Text("Second")
      }  }
    `))
  })

  Test('moves an attached #tag with its rendered node', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            #first
            Text("First")
            #second
            Text("Second")
            #third
            Text("Third")
      }  }
    `)
    const ids = renderIdsByText(document)
    const patch = await SourceActions.applyStudioPatch(document, {
      afterId: ids['First']!,
      beforeId: ids['Second']!,
      draggedId: ids['Third']!,
      kind: 'move-render',
    })

    Expect(patch.content).toBe(source(`
      view MainView() {
         render Stack() {
            #first
            Text("First")

            #third
            Text("Third")

            #second
            Text("Second")
      }  }
    `))
  })

  Test('swaps adjacent tagged form buttons without detaching either tag', async () => {
    const document = await parseDocument(`
      view WorkspaceRow(Workspace) {
         render Col() {
            Text(Workspace.Name)

            #openWorkspace
            FormButton("Open workspace") {
               on press -> { }
            }

            #deleteWorkspace
            FormButton("Delete workspace") {
               on press -> { }
      }  }  }
    `)
    const ids = renderIdsByText(document, ['Workspace.Name', 'Open workspace', 'Delete workspace'])
    const patch = await SourceActions.applyStudioPatch(document, {
      afterId: ids['Workspace.Name']!,
      beforeId: ids['Open workspace']!,
      draggedId: ids['Delete workspace']!,
      kind: 'move-render',
    })

    Expect(patch.content).toBe(source(`
      view WorkspaceRow(Workspace) {
         render Col() {
            Text(Workspace.Name)

            #deleteWorkspace
            FormButton("Delete workspace") {
               on press -> { }
            }

            #openWorkspace
            FormButton("Open workspace") {
               on press -> { }
      }  }  }
    `))
  })

  Test('moves renders to the first and last positions with one edge anchor', async () => {
    const toFirst = await parseDocument(`
      view MainView() {
         render Stack() {
            Text("First")
            Text("Second")
            Text("Third")
      }  }
    `)
    const firstIds = renderIdsByText(toFirst)
    const firstPatch = await SourceActions.applyStudioPatch(toFirst, {
      beforeId: firstIds['First']!,
      draggedId: firstIds['Third']!,
      kind: 'move-render',
    })
    Expect(firstPatch.content).toBe(source(`
      view MainView() {
         render Stack() {
            Text("Third")
            Text("First")
            Text("Second")
      }  }
    `))

    const toLast = await parseDocument(`
      view MainView() {
         render Stack() {
            Text("First")
            Text("Second")
            Text("Third")
      }  }
    `)
    const lastIds = renderIdsByText(toLast)
    const lastPatch = await SourceActions.applyStudioPatch(toLast, {
      afterId: lastIds['Third']!,
      draggedId: lastIds['First']!,
      kind: 'move-render',
    })
    Expect(lastPatch.content).toBe(source(`
      view MainView() {
         render Stack() {
            Text("Second")
            Text("Third")
            Text("First")
      }  }
    `))
  })

  Test('moves a direct render child across sibling containers', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Stack() {
               Text("From left")
            }
            Stack() {
               Text("Right A")
               Text("Right B")
      }  }  }
    `)
    const ids = renderIdsByText(document)
    const patch = await SourceActions.applyStudioPatch(document, {
      afterId: ids['Right A']!,
      beforeId: ids['Right B']!,
      draggedId: ids['From left']!,
      kind: 'move-render',
    })

    Expect(patch.content).toBe(source(`
      view MainView() {
         render Stack() {
            Stack() { }
            Stack() {
               Text("Right A")
               Text("From left")
               Text("Right B")
      }  }  }
    `))
  })

  Test('moves out of formatter-emitted single-line nested blocks without losing their containers', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Stack() { Text("From left") }
            Stack() { Text("Right") }
      }  }
    `)
    const ids = renderIdsByText(document, ['From left', 'Right'])
    const patch = await SourceActions.applyStudioPatch(document, {
      beforeId: ids['Right']!,
      draggedId: ids['From left']!,
      kind: 'move-render',
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toBe(source(`
      view MainView() {
         render Stack() {
            Stack() { }
            Stack() {
               Text("From left")
               Text("Right")
      }  }  }
    `))
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
    const updatedIds = renderIdsByText(updated, ['From left', 'Right'])
    Expect(typeof updatedIds['From left']).toBe('string')
    Expect(typeof updatedIds['Right']).toBe('string')
  })

  Test('moves a direct render child to a cross-container edge', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Stack() {
               Text("From left")
            }
            Stack() {
               Text("Right A")
               Text("Right B")
      }  }  }
    `)
    const ids = renderIdsByText(document)
    const patch = await SourceActions.applyStudioPatch(document, {
      afterId: ids['Right B']!,
      draggedId: ids['From left']!,
      kind: 'move-render',
    })

    Expect(patch.content).toBe(source(`
      view MainView() {
         render Stack() {
            Stack() { }
            Stack() {
               Text("Right A")
               Text("Right B")
               Text("From left")
      }  }  }
    `))
  })

  Test('rejects stale nonadjacent and nonedge drop-gap anchors', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Text("First")
            Text("Second")
            Text("Third")
            Text("Fourth")
      }  }
    `)
    const ids = renderIdsByText(document, ['First', 'Second', 'Third', 'Fourth'])

    await Expect(SourceActions.applyStudioPatch(document, {
      afterId: ids['First']!,
      beforeId: ids['Third']!,
      draggedId: ids['Fourth']!,
      kind: 'move-render',
    })).rejects.toThrow('no longer adjacent')
    await Expect(SourceActions.applyStudioPatch(document, {
      beforeId: ids['Second']!,
      draggedId: ids['Fourth']!,
      kind: 'move-render',
    })).rejects.toThrow('must be the first render expression')
  })

  Test('rejects cross-container moves whose source edits overlap', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Stack() {
               Text("From left")
            }
            Stack() {
               Text("Right A")
               Text("Right B")
      }  }  }
    `)
    const ids = renderIdsByText(document)
    const leftContainer = requireRenderBySource(document, 'Stack() {\n         Text("From left")')

    await Expect(SourceActions.applyStudioPatch(document, {
      afterId: ids['Right A']!,
      beforeId: ids['Right B']!,
      draggedId: renderId(leftContainer),
      kind: 'move-render',
    })).rejects.toThrow('Cannot move render expressions across overlapping block edits')
  })

  Test('rejects a stale version-bound render locator', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() {
            Text("First")
      }  }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))
    const staleId = id.replace(/:(\d+)$/, (_, end: string) => `:${Number(end) + 1}`)

    await Expect(SourceActions.applyStudioPatch(document, {
      entry: ['gap', 8],
      kind: 'set-layout-entry',
      renderId: staleId,
    })).rejects.toThrow('Render expression no longer exists')
  })

  Test('rejects locators from another source file and invalid layout terms', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Text("First")
      }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))
    const foreignId = id.replace(document.uri.fsPath, `${document.uri.fsPath}.other`)

    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'wrap-render',
      renderId: foreignId,
      wrapper: 'Stack',
    })).rejects.toThrow('inside the edited Tao source file')
    await Expect(SourceActions.applyStudioPatch(document, {
      entry: ['gap', Number.NaN],
      kind: 'set-layout-entry',
      renderId: id,
    })).rejects.toThrow('Layout number must be finite')
  })

  Test('rejects a layout edit on an injected root before producing validator-invalid source', async () => {
    const document = await parseDocument(`
      view MainView() {
         render inject \`\`\`ts
            return null
         \`\`\`
      }
    `)
    const render = document.parseResult.value.statements
      .find(AST.isViewDeclaration)?.block?.statements.find(AST.isRenderStatement)
    Expect.Is(render, AST.isRenderStatement)

    await Expect(SourceActions.applyStudioPatch(document, {
      entry: ['gap', 8],
      kind: 'set-layout-entry',
      renderId: renderId(render),
    })).rejects.toThrow('Cannot add a Tao layout clause to an injected root render')
  })

  Test('promotes ephemeral focused-view arguments into the authored scenario', async () => {
    const document = await parseDocument(`
      data Accounts / Account { Name text }
      app Preview { view Main }
      view Main() { render Card(Title: "Main") }
      view Card(Title text, Owner Account) { render Text(Title) }
      fixture Cards { Lead = create Account { Name: "Ada" } }
      scenarios Card "states" {
         fixture Cards
         device phone
         scenario "lead" {
            render (Title: "Old", Owner: Lead)
         }
      }
    `)

    const patch = await SourceActions.applyStudioPatch(document, {
      appearance: 'dark',
      arguments: {
        Owner: { handle: 'Lead', kind: 'fixture-reference' },
        Title: 'Promoted',
      },
      kind: 'set-scenario-arguments',
      scenarioGroupName: 'states',
      scenarioName: 'lead',
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toContain('render (Owner: Lead, Title: "Promoted")')
    Expect(patch.content).toContain('appearance dark')
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
  })

  Test('promotes strings as ordinary Tao literals with lossless escaping', async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      fixture Cards { }
      scenarios Card "states" {
         fixture Cards
         scenario "special" {
            render (Title: "Old")
         }
      }
    `)
    const title = 'Literal {brace}, "quote", \\ slash\nnext line'
    const patch = await SourceActions.applyStudioPatch(document, {
      arguments: { Title: title },
      kind: 'set-scenario-arguments',
      scenarioGroupName: 'states',
      scenarioName: 'special',
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toContain('Title: "Literal \\{brace}, \\"quote\\", \\\\ slash\\nnext line"')
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
    Expect(stringLiteralValues(updated)).toContain(title)
  })

  Test('creates an entry override when focused arguments were inherited from the group', async () => {
    const document = await parseDocument(`
      data Accounts / Account { Name text }
      view Card(Title text, Owner Account) { render Text(Title) }
      fixture Cards { Lead = create Account { Name: "Ada" } }
      scenarios Card "states" {
         fixture Cards
         render (Title: "Default", Owner: Lead)
         device phone
         scenario "lead" { }
      }
    `)

    const patch = await SourceActions.applyStudioPatch(document, {
      arguments: {
        Owner: { handle: 'Lead', kind: 'fixture-reference' },
        Title: 'Entry override',
      },
      kind: 'set-scenario-arguments',
      scenarioGroupName: 'states',
      scenarioName: 'lead',
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toContain('scenario "lead" {\n      render (Owner: Lead, Title: "Entry override")')
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
  })

  Test('inserts a captured provider snapshot as canonical Tao fixture source', async () => {
    const document = await parseDocument(`
      data Stories / Story { Title text }
      app Preview { view Main }
      view Main() { render Text("Preview") }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      fixtureName: 'CapturedState',
      kind: 'insert-captured-fixture',
      plan: {
        accounts: [],
        creates: [{ entity: 'Story', fields: { Title: 'Captured {draft}' }, name: 'Story1' }],
      },
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toContain('fixture CapturedState')
    Expect(patch.content).toContain('Story1 = create Story {')
    Expect(patch.content).toContain('Title: "Captured \\{draft}"')
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
    Expect(stringLiteralValues(updated)).toContain('Captured {draft}')
  })
})

function source(text: string): string {
  return `${Text.stripIndent(text)}\n`
}

function renderIdsByText(
  document: AST.Document,
  texts: readonly string[] = ['First', 'Second', 'Third', 'From left', 'Right A', 'Right B'],
): Record<string, string | undefined> {
  return Object.fromEntries(texts.map(text => {
    const render = renderByText(document, text)
    return [text, render === undefined ? undefined : renderId(render)]
  }))
}

function requireRenderByText(document: AST.Document, text: string): AST.Render {
  const render = renderByText(document, text)
  if (render === undefined) {
    throw new Error(`Expected render containing text: ${text}`)
  }
  return render
}

function renderByText(document: AST.Document, text: string): AST.Render | undefined {
  return AST.streamAllContents(document.parseResult.value)
    .filter(AST.isRender)
    .filter(candidate => renderSource(document, candidate).includes(text))
    .toSorted((left, right) => sourceSpan(left) - sourceSpan(right))[0]
}

function requireRenderBySource(document: AST.Document, text: string): AST.Render {
  const render = AST.streamAllContents(document.parseResult.value)
    .filter(AST.isRender)
    .filter(candidate => renderSource(document, candidate).includes(text))
    .toSorted((left, right) => sourceSpan(left) - sourceSpan(right))[0]
  if (render === undefined) {
    throw new Error(`Expected render containing source: ${text}`)
  }
  return render
}

function renderSource(document: AST.Document, render: AST.Render): string {
  const cstNode = render.$cstNode
  return cstNode === undefined ? '' : document.textDocument.getText().slice(cstNode.offset, cstNode.end)
}

function sourceSpan(render: AST.Render): number {
  const cstNode = render.$cstNode
  return cstNode === undefined ? Number.MAX_SAFE_INTEGER : cstNode.end - cstNode.offset
}

function renderId(render: AST.Render): string {
  const cstNode = render.$cstNode
  return `${AST.getDocument(render).uri.fsPath}:${cstNode?.offset ?? 0}:${cstNode?.end ?? 0}`
}

function stringLiteralValues(document: AST.Document): string[] {
  return [...AST.streamAllContents(document.parseResult.value).filter(AST.isStringLiteral)]
    .map(literal => literal.value)
}

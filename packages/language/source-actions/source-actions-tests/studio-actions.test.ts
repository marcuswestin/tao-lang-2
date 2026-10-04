import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Assert, FS, Text } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions, {
  type StudioAddSketchEntityParameterPatchRequest,
  type StudioBindSketchFieldPatchRequest,
  type StudioComponentKind,
  type StudioLayoutEntry,
  type StudioSketchSnapElement,
  type StudioSnapSketchToFlowPatchRequest,
  type StudioSourcePatchRequest,
} from '../source-actions-src/source-actions'
import { parseDocument, parseRawDocument, sourceActionOptionsFor } from './test-source-actions'

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
        'Placeholder',
        'Progress',
        'Row',
        'ScrollView',
        'SegmentedControl',
        'Slider',
        'Spinner',
        'Spacer',
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

  Test('rejects missing, unresolved parameterized, and recursive project views', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() { Text("First") }
      }

      scene Card(Title text) {
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
    })).rejects.toThrow('unresolved required parameters: Title')
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'insert-project-view',
      viewName: 'MainView',
    })).rejects.toThrow('Cannot insert project view MainView into its own render block')
  })

  Test('auto-binds a parameterized project view from the exact enclosing loop row', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui
      data Playlists / Playlist { Title text }
      view MainView() {
         query Playlists = Playlists
         render Col() {
            loop Playlists / Playlist {
               Text(Playlist.Title)
               Text("After")
      }  }  }
      view PlaylistRow(Playlist) { render Text(Playlist.Title) }
    `)
    const ids = renderIdsByText(document, ['Playlist.Title', 'After'])
    const patch = await SourceActions.applyStudioPatch(document, {
      afterId: ids['Playlist.Title']!,
      beforeId: ids['After']!,
      kind: 'insert-project-view',
      viewName: 'PlaylistRow',
    })

    Expect(patch.content).toContain(
      'Text(Playlist.Title)\n         PlaylistRow(Playlist: Playlist)\n         Text("After")',
    )
  })

  Test('uses the nearest same-named loop binding without treating its shadowed outer value as ambiguous', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui
      data Playlists / Playlist { Title text }
      view MainView() {
         query Playlists = Playlists
         render Col() {
            loop Playlists / Playlist {
               loop Playlists / Playlist {
                  Text(Playlist.Title)
                  Text("After")
      }  }  }  }
      view PlaylistRow(Playlist) { render Text(Playlist.Title) }
    `)
    const ids = renderIdsByText(document, ['Playlist.Title', 'After'])
    const patch = await SourceActions.applyStudioPatch(document, {
      afterId: ids['Playlist.Title']!,
      beforeId: ids['After']!,
      kind: 'insert-project-view',
      viewName: 'PlaylistRow',
    })

    Expect(patch.content).toContain('PlaylistRow(Playlist: Playlist)')
  })

  for (const visibility of ['public', 'private']) {
    Test(`inserts only a public imported generated view into a typed loop (${visibility})`, async () => {
      await withTaoFiles('tao-source-actions-imported-row-', {
        'Data.tao': 'public data Playlists / Playlist { Title text }',
        '@/studio/View1.tao': `use Playlist from ../../Data\nuse Text from @tao/ui\n${
          visibility === 'public' ? 'public ' : ''
        }view View1(Playlist) { render Text(Playlist.Title) }`,
        'Main.tao': `
          use Playlists, Playlist from ./Data
          use Col, Text from @tao/ui
          view Main() {
            query Playlists = Playlists
            render Col() {
              loop Playlists / Playlist { Text(Playlist.Title) }
            }
          }
        `,
      }, async (paths, root) => {
        const workspace = await Workspace.open(root)
        const parsed = await workspace.parseFiles([paths['Main.tao'], paths['@/studio/View1.tao']])
        const document = parsed[0]!.entry.document
        const loopRender = AST.streamAllContents(document.parseResult.value).filter(AST.isRender)
          .find(render => render.$cstNode?.text === 'Text(Playlist.Title)')!
        const request = {
          beforeId: renderId(loopRender),
          kind: 'insert-project-view' as const,
          viewName: 'View1',
          viewSourcePath: paths['@/studio/View1.tao'],
        }
        const context = { files: [...new Set(parsed.flatMap(result => result.files.map(file => file.ast)))] }
        if (visibility === 'private') {
          await Expect(SourceActions.applyStudioPatch(document, request, context)).rejects.toThrow(
            'only import a public project view',
          )
          return
        }
        const patch = await SourceActions.applyStudioPatch(document, request, context)
        Expect(patch.content).toContain('use View1 from @/studio')
        Expect(patch.content).toContain('View1(Playlist: Playlist)\n         Text(Playlist.Title)')
        const validated =
          await (await Workspace.open(root, { sourceOverrides: { [paths['Main.tao']]: patch.content } })).validate(
            paths['Main.tao'],
          )
        Expect(validated.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
        const imported = validated.entry.ast.statements.filter(AST.isUseStatement)
          .flatMap(AST.resolvedImportedDeclarations).find(declaration => declaration.name === 'View1')
        Expect.Is(imported, AST.isViewDeclaration)
        Expect(AST.getDocument(imported).uri.fsPath).toBe(paths['@/studio/View1.tao'])
        await Expect(SourceActions.applyStudioPatch(document, {
          kind: 'insert-project-view',
          viewName: 'View1',
          viewSourcePath: paths['@/studio/View1.tao'],
        }, context)).rejects.toThrow('unresolved required parameters: Playlist')
      })
    })
  }

  Test('rejects ambiguous inferred values but accepts one explicit parser-resolved lexical binding', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui
      data Playlists / Playlist { Title text }
      view MainView(Left Playlist, Right Playlist) {
         render Col() { Text(Left.Title) }
      }
      view PlaylistRow(Playlist) { render Text(Playlist.Title) }
    `)

    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'insert-project-view',
      viewName: 'PlaylistRow',
    })).rejects.toThrow('ambiguous required parameters: Playlist')
    const patch = await SourceActions.applyStudioPatch(document, {
      bindings: { Playlist: 'Right' },
      kind: 'insert-project-view',
      viewName: 'PlaylistRow',
    })
    Expect(patch.content).toContain('PlaylistRow(Playlist: Right)')
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

  Test('clears one kind of layout entry, and the clause once it is empty', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Stack() [pad 4, aligned left, gap 8, centered] {
            Text("First")
      }  }
    `)
    const alignment = await SourceActions.applyStudioPatch(document, {
      heads: ['aligned', 'centered', 'fill'],
      kind: 'clear-layout-entry',
      renderId: renderId(requireRenderByText(document, 'Stack()')),
    })
    Expect(alignment.content).toBe(source(`
      view MainView() {
         render Stack() [pad 4, gap 8] {
            Text("First")
      }  }
    `))

    const padded = await parseRawDocument(alignment.content)
    const gapless = await parseRawDocument(
      (await SourceActions.applyStudioPatch(padded, {
        heads: ['gap'],
        kind: 'clear-layout-entry',
        renderId: renderId(requireRenderByText(padded, 'Stack()')),
      })).content,
    )
    const bare = await SourceActions.applyStudioPatch(gapless, {
      heads: ['pad'],
      kind: 'clear-layout-entry',
      renderId: renderId(requireRenderByText(gapless, 'Stack()')),
    })
    Expect(bare.content).toBe(source(`
      view MainView() {
         render Stack() {
            Text("First")
      }  }
    `))
    await Expect(SourceActions.applyStudioPatch(gapless, {
      heads: ['hug'],
      kind: 'clear-layout-entry',
      renderId: renderId(requireRenderByText(gapless, 'Stack()')),
    })).rejects.toThrow('sets no hug')
  })

  Test('inspects parsed layout and style values and edits current-dialect inline style', async () => {
    const document = await parseDocument(`
      project design Theme { ink #111 body [fg ink, size 14] }
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

  Test('inspects and edits a clause that reads a color value without treating it as a token', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui
      project design Theme { colors { accent #2f6b4f } }
      app Demo { view MainView Design Theme }
      view MainView() { render Badge(Tint: accent) }
      view Badge(Tint color default accent) {
         render Text("Badge") [background Tint, pad 4]
      }
    `)
    const id = renderId(requireRenderByText(document, 'Text("Badge")'))
    const inspection = SourceActions.inspectStudioRender(document, id)

    Expect(inspection.styleEntries).toEqual([['background', 'Tint']])
    Expect(inspection.explorations).toEqual([['pad', 4]])
    Expect(inspection.styleProvenance[0]?.landing).toEqual({ kind: 'element-inline' })
    // Only a raw color can become a token; a value read is refused as a request, not a crash.
    await Expect(SourceActions.applyStudioPatch(document, {
      entry: ['background', 'Tint'],
      kind: 'set-style-entry',
      landing: { kind: 'token', tokenName: 'badge' },
      renderId: id,
    })).rejects.toThrow('Current Tao design tokens can only promote raw background, bg, border, fg, or ink colors.')

    const patch = await SourceActions.applyStudioPatch(document, {
      entry: ['ink', 'Tint'],
      kind: 'set-style-entry',
      landing: { kind: 'element-inline' },
      renderId: id,
    })
    Expect(patch.content).toContain('Text("Badge") [background Tint, pad 4, ink Tint]')
  })

  Test('inspects the owning view and its root render so a host can size a focused frame to it', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui
      view MainView() {
         render Col() {
            Text("Inner")
         }
      }
      view Alias() from ./Alias.tsx
    `)
    const inner = renderId(requireRenderByText(document, 'Text("Inner")'))
    const root = renderId(requireRenderByText(document, 'Col()'))

    Expect(SourceActions.inspectStudioRender(document, inner).owner).toEqual({ renderId: root, view: 'MainView' })
    Expect(SourceActions.inspectStudioRender(document, root).owner).toEqual({ renderId: root, view: 'MainView' })
  })

  Test('inspects and promotes decided visual aliases and representable numeric families', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui
      project design Theme { ink #111 body [ink ink, size 16] }
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

  Test('sets one entry on a named design member without a render occurrence (semantic agent PoC)', async () => {
    const document = await parseDocument(`
      project design Theme { ink #111 card [gap 10, pad 16, radius 14] }
      project design Other { card [pad 4] }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      designName: 'Theme',
      entry: ['pad', 18],
      kind: 'set-design-entry',
      memberName: 'card',
    })
    Expect(patch.content).toContain('card [gap 10, pad 18, radius 14]')
    Expect(patch.content).toContain('card [pad 4]')
    await Expect(SourceActions.applyStudioPatch(document, {
      designName: 'Theme',
      entry: ['pad', 18],
      kind: 'set-design-entry',
      memberName: 'missing',
    })).rejects.toThrow('not uniquely declared')
  })

  Test('edits and forks a uniquely named current-dialect design bundle', async () => {
    const document = await parseDocument(`
      project design Theme { ink #111 body [fg ink, size 14] }
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
      project design Theme {
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
      project design Theme { colors { ink #111 } styles { card [ink ink] } }
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
      project design Theme {
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
      project design Theme { ink #111 }
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
      project design Theme { ink #111 body [fg ink, size 14] }
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
      project design Theme { ink #111 }
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

  Test('lands new colors and element defaults of a design without typed blocks as canonical source', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui

      design Theme { }

      view MainView() {
         render Text("First") [size 18, background #c00]
      }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))

    const colored = await SourceActions.applyStudioPatch(document, {
      entry: ['background', '#c00'],
      kind: 'set-style-entry',
      landing: { kind: 'token', tokenName: 'danger' },
      renderId: id,
    })
    Expect(colored.content).toContain('design Theme {\n   colors {\n      danger #c00\n   }\n}')
    Expect(colored.content).toContain('Text("First") [size 18, background danger]')
    await expectCanonical(colored.content)

    const defaulted = await SourceActions.applyStudioPatch(document, {
      entry: ['size', 18],
      kind: 'set-style-entry',
      landing: { elementName: 'Text', kind: 'element-default' },
      renderId: id,
    })
    Expect(defaulted.content).toContain('design Theme {\n   styles {\n      Text [size 18]\n   }\n}')
    await expectCanonical(defaulted.content)
  })

  Test('lands new colors and forks of a flat design in typed blocks, leaving flat members as written', async () => {
    const document = await parseDocument(`
      project design Theme { ink #111 body [ink ink, size 14] }
      view MainView() { render Text("First") [body, size 18, background #c00] }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))

    const colored = await SourceActions.applyStudioPatch(document, {
      entry: ['background', '#c00'],
      kind: 'set-style-entry',
      landing: { kind: 'token', tokenName: 'danger' },
      renderId: id,
    })
    Expect(colored.content).toContain('   ink #111\n')
    Expect(colored.content).toContain('   colors {\n      danger #c00\n   }\n')

    const recolored = await SourceActions.applyStudioPatch(document, {
      entry: ['background', '#c00'],
      kind: 'set-style-entry',
      landing: { kind: 'token', tokenName: 'ink' },
      renderId: id,
    })
    Expect(recolored.content).toContain('   ink #c00\n')
    Expect(recolored.content).not.toContain('colors {')

    const forked = await SourceActions.applyStudioPatch(document, {
      entry: ['size', 18],
      kind: 'set-style-entry',
      landing: { bundleName: 'body', kind: 'style-bundle', mode: 'fork' },
      renderId: id,
    })
    Expect(forked.content).toContain('   body [ink ink, size 14]\n')
    Expect(forked.content).toContain('   styles {\n      bodyVariant [ink ink, size 18]\n   }\n')
    Expect(forked.content).toContain('Text("First") [bodyVariant, background #c00]')
  })

  Test('refuses a Capitalized or keyword name for a new color, size, or fork', async () => {
    const document = await parseDocument(`
      project design Theme { colors { ink #111 } styles { card [pad 4] } }
      view MainView() { render Text("First") [card, pad 12, background #c00] }
    `)
    const id = renderId(requireRenderByText(document, 'Text("First")'))
    const color = (tokenName: string): StudioSourcePatchRequest => ({
      entry: ['background', '#c00'],
      kind: 'set-style-entry',
      landing: { kind: 'token', tokenName },
      renderId: id,
    })
    const size = (tokenName: string): StudioSourcePatchRequest => ({
      entry: ['pad', 12],
      kind: 'set-style-entry',
      landing: { kind: 'size-token', tokenName },
      renderId: id,
    })
    const fork = (forkName: string): StudioSourcePatchRequest => ({
      entry: ['pad', 12],
      kind: 'set-style-entry',
      landing: { bundleName: 'card', forkName, kind: 'style-bundle', mode: 'fork' },
      renderId: id,
    })

    await Expect(SourceActions.applyStudioPatch(document, color('Danger'))).rejects.toThrow(
      "Studio color token names start with a lowercase letter; use 'danger' instead of 'Danger'.",
    )
    await Expect(SourceActions.applyStudioPatch(document, color('color'))).rejects.toThrow(
      "Studio color token name 'color' is a Tao keyword; choose another name.",
    )
    await Expect(SourceActions.applyStudioPatch(document, size('CardPad'))).rejects.toThrow(
      "Studio size token names start with a lowercase letter; use 'cardPad' instead of 'CardPad'.",
    )
    await Expect(SourceActions.applyStudioPatch(document, size('when'))).rejects.toThrow(
      "Studio size token name 'when' is a Tao keyword; choose another name.",
    )
    await Expect(SourceActions.applyStudioPatch(document, fork('Special'))).rejects.toThrow(
      "Studio forked style bundle names start with a lowercase letter; use 'special' instead of 'Special'.",
    )
    await Expect(SourceActions.applyStudioPatch(document, fork('color'))).rejects.toThrow(
      "Studio forked style bundle name 'color' is a Tao keyword; choose another name.",
    )
    // A keyword prefix is still a name.
    Expect((await SourceActions.applyStudioPatch(document, color('colorful'))).content).toContain('colorful #c00')
  })

  Test('names a default fork of a Capitalized style as a lowercase style', async () => {
    const document = await parseDocument(`
      project design Theme { styles { Card [pad 4] } }
      view MainView() { render Text("First") [Card, pad 12] }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      entry: ['pad', 12],
      kind: 'set-style-entry',
      landing: { bundleName: 'Card', kind: 'style-bundle', mode: 'fork' },
      renderId: renderId(requireRenderByText(document, 'Text("First")')),
    })

    Expect(patch.content).toContain('cardVariant [pad 12]')
    Expect(patch.content).toContain('Text("First") [cardVariant]')
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
      use Stack from @tao/ui

      view MainView() {
         render Stack() {
            Text("First")
            Stack() [gap 8, pad 8] {
               Text("Second")
      }  }  }
    `))
  })

  Test('wrapping adds the container to an existing @tao/ui use statement', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      view MainView() {
         render Col() {
            Text("First")
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'wrap-render',
      renderId: renderId(requireRenderByText(document, 'Text("First")')),
      wrapper: 'Stack',
    })

    Expect(patch.content).toBe(source(`
      use Col, Stack, Text from @tao/ui

      view MainView() {
         render Col() {
            Stack() [gap 8, pad 8] {
               Text("First")
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
      use Stack from @tao/ui

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
      scene Card(Title text, Owner Account) { render Text(Title) }
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
      scene Card(Title text) { render Text(Title) }
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
      scene Card(Title text, Owner Account) { render Text(Title) }
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

  Test('inserts an inherited render override before an existing scenario journey prefix', async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      scenarios Card "states" {
         render (Title: "Default")
         device phone
         scenario "held" {
            press down #card
            advance 600.ms
            press up #card
         }
      }
    `)

    const patch = await SourceActions.applyStudioPatch(document, {
      appearance: 'dark',
      arguments: { Title: 'Entry override' },
      kind: 'set-scenario-arguments',
      scenarioGroupName: 'states',
      scenarioName: 'held',
    })
    const updated = await parseRawDocument(patch.content)

    const renderIndex = patch.content.indexOf('render (Title: "Entry override")')
    const appearanceIndex = patch.content.indexOf('appearance dark')
    const firstStepIndex = patch.content.indexOf('press down #card')
    Expect(renderIndex).toBeGreaterThan(-1)
    Expect(appearanceIndex).toBeGreaterThan(renderIndex)
    Expect(firstStepIndex).toBeGreaterThan(appearanceIndex)
    Expect(patch.content).toContain('advance 600.ms\n      press up #card')
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
  })

  Test('appends a reviewed semantic recording after the existing scenario journey', async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      scenarios Card "states" {
         scenario "edited" {
            render (Title: "Draft")
            press #edit
         }
      }
    `)

    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'append-scenario-steps',
      scenarioGroupName: 'states',
      scenarioName: 'edited',
      steps: [
        { kind: 'enter', selector: 'label', target: 'Title', value: 'Saved {copy}' },
        { kind: 'submit', selector: 'placeholder', target: 'Story title' },
        { kind: 'press', selector: 'text', target: 'Done' },
      ],
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toContain([
      'press #edit',
      'enter "Saved \\{copy}" into label "Title"',
      'submit placeholder "Story title"',
      'press text "Done"',
    ].join('\n      '))
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
  })

  Test('rejects ambiguous scenario identity and source-shaped recorded steps', async () => {
    const document = await parseDocument(`
      view Card() { render Text("Card") }
      scenarios Card "states" { scenario "same" { } }
      scenarios Card "states" { scenario "same" { } }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'append-scenario-steps',
      scenarioGroupName: 'states',
      scenarioName: 'same',
      steps: [{ kind: 'press', selector: 'tag', target: 'card' }],
    })).rejects.toThrow('not uniquely declared')

    const unique = await parseDocument(`
      view Card() { render Text("Card") }
      scenarios Card "states" { scenario "same" { } }
    `)
    await Expect(SourceActions.applyStudioPatch(unique, {
      kind: 'append-scenario-steps',
      scenarioGroupName: 'states',
      scenarioName: 'same',
      steps: [{ kind: 'press', selector: 'tag', source: 'press #unsafe', target: 'card' }],
    } as unknown as StudioSourcePatchRequest)).rejects.toThrow('unsupported fields')
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

  for (const scope of ['plural-import', 'singular-import', 'folder', 'local'] as const) {
    Test(`resolves captured entity rows with ${scope} scope`, async () => {
      const imported = scope === 'plural-import'
        ? 'use Notes from ./Data.tao'
        : scope === 'singular-import'
        ? 'use Note, Notes from ./Data.tao'
        : ''
      await withTaoFiles('tao-captured-fixture-import-', {
        'Data.tao': `${scope === 'folder' ? 'folder' : 'project'} data Notes / Note { Title text }`,
        'View.tao': `
          ${imported}
          ${scope === 'local' ? 'data Notes / Note { Title text }' : ''}
          view List() {
            query Notes = Notes
            render Empty()
          }
          view Empty() { render inject \`\`\`ts return null \`\`\` }
          scenarios List "states" { device phone scenario "empty" { render () } }
        `,
      }, async paths => {
        const parsed = await Workspace.validate(paths['View.tao'])
        Expect(parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
        const patch = await SourceActions.applyStudioPatch(parsed.entry.document, {
          fixtureName: 'CapturedState',
          kind: 'insert-captured-fixture',
          plan: {
            accounts: [],
            creates: [{ entity: 'Note', fields: { Title: 'Captured' }, name: 'Note1' }],
          },
        })
        await FS.writeText(paths['View.tao'], patch.content)
        const validated = await Workspace.validate(paths['View.tao'])
        Expect(validated.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
        const fixture = validated.entry.ast.statements.find(AST.isFixtureDeclaration)!
        const row = fixture.block.entries.find(AST.isFixtureCreateBinding)!
        Expect.Is(row.entity.ref, AST.isEntityDataDeclaration)
        Expect(AST.getDocument(row.entity.ref).uri.fsPath).toBe(
          scope === 'local' ? paths['View.tao'] : paths['Data.tao'],
        )
        const imports = validated.entry.ast.statements.filter(AST.isUseStatement)
        Expect(imports.flatMap(use => use.importedDeclarations.map(reference => reference.$refText))).toEqual(
          scope === 'plural-import' || scope === 'singular-import' ? ['Note', 'Notes'] : [],
        )
        if (imports.length !== 0) {
          Expect(imports[0]!.importPath).toBe('./Data.tao')
        }
      })
    })
  }

  Test('toggles the nearest owning flow direction from a stable nested leaf id', async () => {
    const document = await parseDocument(`
      use Col, Row, Text from @tao/ui
      view MainView() {
         render Row() {
            Col() {
               Text("Nested")
            }
            Text("Outer")
      }  }
    `)
    const nestedId = renderId(requireRenderByText(document, 'Nested'))
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'toggle-flow-direction',
      renderId: nestedId,
    }, { occurrence: { nodeKind: 'render', renderOwner: 'MainView' } })

    Expect(patch.content).toContain('render Row() {\n      Row() {\n         Text("Nested")')
    Expect(patch.content).toContain('Text("Outer")')
  })

  Test('toggles a selected Row or Col itself rather than the flow around it', async () => {
    const document = await parseDocument(`
      use Col, Row, Text from @tao/ui
      view MainView() {
         render Row() {
            Col() {
               Text("Nested")
            }
            Text("Outer")
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'toggle-flow-direction',
      renderId: renderId(requireRenderBySource(document, 'Col()')),
    }, { occurrence: { nodeKind: 'render', renderOwner: 'MainView' } })

    Expect(patch.content).toContain('render Row() {\n      Row() {\n         Text("Nested")')
    Expect(patch.content).not.toContain('Col()')
  })

  Test('inserts direction-aware separators after or between direct flow siblings', async () => {
    const row = await parseDocument(`
      use Row, Text from @tao/ui
      view MainView() { render Row() { Text("First") Text("Second") } }
    `)
    const rowIds = renderIdsByText(row)
    const rowPatch = await SourceActions.applyStudioPatch(row, {
      afterId: rowIds['First']!,
      beforeId: rowIds['Second']!,
      kind: 'insert-separator',
    })
    Expect(rowPatch.content).toContain('use Box, Row, Text from @tao/ui')
    Expect(rowPatch.content).toContain(
      'Text("First")\n      Box() [width 1, height fill]\n      Text("Second")',
    )

    const col = await parseDocument(`
      use Col, Text from @tao/ui
      view MainView() { render Col() { Text("First") Text("Second") } }
    `)
    const colIds = renderIdsByText(col)
    const colPatch = await SourceActions.applyStudioPatch(col, {
      afterId: colIds['First']!,
      kind: 'insert-separator',
    })
    Expect(colPatch.content).toContain('Text("First")\n      Box() [width fill, height 1]\n      Text("Second")')
  })

  Test('inserts a Spacer between adjacent leaves and rewrites both semantic claim slots', async () => {
    const document = await parseDocument(`
      use Row, Text from @tao/ui
      view MainView() {
         render Row() {
            Text("First") [width 40, claim 9, height 20]
            Text("Second") [claim 8, width 60]
      }  }
    `)
    const ids = renderIdsByText(document)
    const patch = await SourceActions.applyStudioPatch(document, {
      afterId: ids['First']!,
      beforeId: ids['Second']!,
      kind: 'insert-spacer',
      ratio: [2, 5],
    }, { occurrence: { nodeKind: 'render', renderOwner: 'MainView' } })

    Expect(patch.content).toContain('use Row, Spacer, Text from @tao/ui')
    Expect(patch.content).toContain('Text("First") [width 40, height 20, claim 2]')
    Expect(patch.content).toContain('Spacer()')
    Expect(patch.content).toContain('Text("Second") [width 60, claim 5]')
    Expect(patch.content.indexOf('claim 2')).toBeLessThan(patch.content.indexOf('Spacer()'))
    Expect(patch.content.indexOf('Spacer()')).toBeLessThan(patch.content.indexOf('claim 5'))
    const reparsed = await parseRawDocument(patch.content)
    Expect(reparsed.parseResult.parserErrors).toEqual([])
  })

  Test('rejects stale, cross-owner, nested, nonadjacent, and unbounded flow edits', async () => {
    const document = await parseDocument(`
      view FirstView() {
         render Row() {
            Text("First")
            Col() { Text("Nested") }
            Text("Second")
            Text("Third")
      }  }
      view OtherView() { render Row() { Text("Other") } }
    `)
    const ids = renderIdsByText(document, ['First', 'Nested', 'Second', 'Third', 'Other'])
    await Expect(SourceActions.applyStudioPatch(document, {
      afterId: ids['First']!,
      beforeId: ids['Third']!,
      kind: 'insert-spacer',
      ratio: [1, 1],
    })).rejects.toThrow('adjacent render expressions')
    await Expect(SourceActions.applyStudioPatch(document, {
      afterId: ids['First']!,
      beforeId: ids['Other']!,
      kind: 'insert-spacer',
      ratio: [1, 1],
    })).rejects.toThrow('same container')
    await Expect(SourceActions.applyStudioPatch(document, {
      afterId: renderId(requireRenderBySource(document, 'Col()')),
      kind: 'insert-separator',
    })).rejects.toThrow('direct leaf')
    await Expect(SourceActions.applyStudioPatch(document, {
      afterId: ids['Second']!,
      beforeId: ids['Third']!,
      kind: 'insert-spacer',
      ratio: [0, 101],
    })).rejects.toThrow('integers from 1 through 100')
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'toggle-flow-direction',
      renderId: `${document.uri.fsPath}:99999:100000`,
    })).rejects.toThrow('no longer exists')
  })

  Test('drops the freshly drawn Placeholder import once the first snap discards its render', async () => {
    // The exact shape StudioSketchSource.generate writes for a newly drawn sketch: Placeholder is
    // the only use of @tao/ui, and nothing else in the file calls it.
    const document = await parseDocument(`
      use Placeholder from @tao/ui

      public
      view View4() {
        render Placeholder("View4") [width 360, height 76]
      }

      scenarios View4 "sketch" {
        device phone
        scenario "draft" {
          render ()
        }
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, playlistSnapRequest())

    // The first snap replaces the whole Placeholder render, so nothing in the file calls it any more.
    // Left behind, it would be the one thing keeping this Studio-owned, `tao fix`-excluded file from
    // the canonical shape `StudioGeneratedSources` and every other Tao file are held to.
    Expect(patch.content).toContain('use Col, Image, Row, Text from @tao/ui')
    Expect(patch.content).not.toContain('Placeholder')
    const reparsed = await parseRawDocument(patch.content)
    Expect(reparsed.parseResult.lexerErrors).toEqual([])
    Expect(reparsed.parseResult.parserErrors).toEqual([])
  })

  Test('snaps a playlist into a tagged Row with nested Col while preserving unrelated source', async () => {
    const document = await parseDocument(`
      use Placeholder from @tao/ui
      public view Keep() { render Placeholder("Keep") }
      public view View4() { render Placeholder("View4") [width 360, height 76] }
      scenarios View4 "sketch" { device phone scenario "draft" { render () } }
    `)
    const patch = await SourceActions.applyStudioPatch(document, playlistSnapRequest())

    Expect(patch.content).toContain('use Col, Image, Placeholder, Row, Text from @tao/ui')
    Expect(patch.content).toContain('public\nview Keep() {\n   render Placeholder("Keep")\n}')
    Expect(patch.content).toContain('render Row() [gap 12, pad horizontal 12 vertical 8] {')
    Expect(patch.content).toContain('#studio_rect_006100720074\n      Image("cover.png") [hug]')
    Expect(patch.content).toContain('Col() [gap 4] {')
    Expect(patch.content).toContain('#studio_rect_007400690074006c0065\n         Text("Night Drive") [hug]')
    Expect(patch.content).toContain('#studio_rect_006100720074006900730074\n         Text("Signals") [hug]')
    Expect(patch.content).toContain(
      '#studio_rect_006400750072006100740069006f006e\n      Text("3:42") [width 38, height 20, claim 1]',
    )
    Expect(patch.content).toContain('scenarios View4 "sketch"')
    const reparsed = await parseRawDocument(patch.content)
    Expect(reparsed.parseResult.lexerErrors).toEqual([])
    Expect(reparsed.parseResult.parserErrors).toEqual([])
  })

  Test('escapes leaf arguments and merges UI imports without duplication', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui
      public view View4() { render Text("old") }
      scenarios View4 "sketch" { device phone scenario "draft" { render () } }
    `)
    const request = playlistSnapRequest({
      rectIds: ['quoted'],
      tree: {
        arguments: ['Say "hi" {now}\\later\nnext'],
        component: 'Text',
        layout: [['hug']],
        rectId: 'quoted',
        type: 'element',
      },
    })
    const patch = await SourceActions.applyStudioPatch(document, request)

    Expect(patch.content.match(/use Text from @tao\/ui/g)).toHaveLength(1)
    Expect(patch.content).toContain('Text("Say \\"hi\\" \\{now}\\\\later\\nnext") [hug]')
    Expect(patch.content).toContain('#studio_rect_00710075006f007400650064')
    await Expect(SourceActions.applyStudioPatch(await parseDocument(patch.content), request)).rejects.toThrow(
      'already snapped',
    )
  })

  Test('adds and removes snapped leaves without rebuilding manual flow or declarations', async () => {
    const document = await parseDocument(`
      use Box, Placeholder, Row, Text from @tao/ui
      data Playlists / Playlist { Title text }
      public view View4(Playlist) {
        state Expanded = true
        render Row() [gap 37, pad 11] {
          #studio_rect_006f006c0064
          Text(Playlist.Title) [width 111, height 23]
          Box() [width 1, height fill]
        }
      }
      scenarios View4 "sketch" {
        scenario "draft" { render (Playlist: Example) }
      }
    `)
    const snapped = await SourceActions.applyStudioPatch(
      document,
      playlistSnapRequest({
        rectIds: ['new'],
        tree: leaf('new'),
      }),
    )

    Expect(snapped.content).toContain('view View4(Playlist)')
    Expect(snapped.content).toContain('state Expanded = true')
    Expect(snapped.content).toContain('Row() [gap 37, pad 11]')
    Expect(snapped.content).toContain('Text(Playlist.Title) [width 111, height 23]')
    Expect(snapped.content).toContain('Box() [width 1, height fill]')
    Expect(snapped.content).toContain('#studio_rect_006e00650077')
    Expect(snapped.content).toContain('render (Playlist: Example)')

    const partiallyUnsnapped = await SourceActions.applyStudioPatch(await parseDocument(snapped.content), {
      fallback: { height: 76, label: 'View4', width: 360 },
      kind: 'unsnap-sketch-from-flow',
      rectIds: ['new'],
      sketchId: 'playlist-row',
      viewName: 'View4',
    })
    Expect(partiallyUnsnapped.content).toContain('Row() [gap 37, pad 11]')
    Expect(partiallyUnsnapped.content).toContain('Text(Playlist.Title) [width 111, height 23]')
    Expect(partiallyUnsnapped.content).toContain('Box() [width 1, height fill]')
    Expect(partiallyUnsnapped.content).not.toContain('#studio_rect_006e00650077')

    const fullyUnsnapped = await SourceActions.applyStudioPatch(await parseDocument(partiallyUnsnapped.content), {
      fallback: { height: 76, label: 'View4', width: 360 },
      kind: 'unsnap-sketch-from-flow',
      rectIds: ['old'],
      sketchId: 'playlist-row',
      viewName: 'View4',
    })
    Expect(fullyUnsnapped.content).toContain('view View4(Playlist)')
    Expect(fullyUnsnapped.content).toContain('state Expanded = true')
    Expect(fullyUnsnapped.content).toContain('Box() [width 1, height fill]')
    Expect(fullyUnsnapped.content).not.toContain('#studio_rect_006f006c0064')
    Expect(fullyUnsnapped.content).toContain('render (Playlist: Example)')
  })

  Test('wraps a previously snapped root leaf while keeping its identity on the leaf', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui
      public view View4() {
        #studio_rect_006f006c0064
        render Text("Edited") [width 111, height 23]
      }
      scenarios View4 "sketch" { scenario "draft" { render () } }
    `)
    const patch = await SourceActions.applyStudioPatch(
      document,
      playlistSnapRequest({
        mergeDirection: 'Col',
        rectIds: ['new'],
        tree: leaf('new'),
      }),
    )

    Expect(patch.content).toContain('render Col()')
    Expect(patch.content).toContain('#studio_rect_006f006c0064\n      Text("Edited") [width 111, height 23]')
    Expect(patch.content).toContain('#studio_rect_006e00650077\n      Text("text") [hug]')
    Expect(patch.content).not.toContain('render Text("Edited")')
  })

  Test('prepends new geometry to a same-axis authored container without rebuilding its children', async () => {
    const document = await parseDocument(`
      use Box, Row, Text from @tao/ui
      public view View4() {
        render Row() [gap 37, pad 11] {
          #studio_rect_006f006c0064
          Text("Edited") [width 111, height 23]
          Box() [width 1, height fill]
        }
      }
      scenarios View4 "sketch" { scenario "draft" { render () } }
    `)
    const patch = await SourceActions.applyStudioPatch(
      document,
      playlistSnapRequest({
        mergePosition: 'before',
        rectIds: ['new'],
        tree: leaf('new'),
      }),
    )

    const newTag = patch.content.indexOf('#studio_rect_006e00650077')
    const oldTag = patch.content.indexOf('#studio_rect_006f006c0064')
    Expect(newTag).toBeGreaterThan(-1)
    Expect(oldTag).toBeGreaterThan(newTag)
    Expect(patch.content).toContain('Row() [gap 37, pad 11]')
    Expect(patch.content).toContain('Text("Edited") [width 111, height 23]')
    Expect(patch.content).toContain('Box() [width 1, height fill]')
  })

  Test('wraps an authored container when the combined sketch changes axis', async () => {
    const document = await parseDocument(`
      use Col, Row, Text from @tao/ui
      public view View4() {
        render Col() [gap 37, pad 11] {
          #studio_rect_006f006c0064
          Text("Edited") [width 111, height 23]
          Text("Manual")
        }
      }
      scenarios View4 "sketch" { scenario "draft" { render () } }
    `)
    const patch = await SourceActions.applyStudioPatch(
      document,
      playlistSnapRequest({
        mergeDirection: 'Row',
        mergePosition: 'after',
        rectIds: ['new'],
        tree: leaf('new'),
      }),
    )

    Expect(patch.content).toContain('render Row()')
    Expect(patch.content).toContain('Col() [gap 37, pad 11]')
    Expect(patch.content).toContain('Text("Edited") [width 111, height 23]')
    Expect(patch.content).toContain('Text("Manual")')
    Expect(patch.content.indexOf('#studio_rect_006f006c0064')).toBeLessThan(
      patch.content.indexOf('#studio_rect_006e00650077'),
    )
  })

  Test('rejects a missing, non-public, or multiply owned generated view', async () => {
    const privateView = await parseDocument(`
      view View4() { render Text("private") }
      scenarios View4 "sketch" { device phone scenario "draft" { render () } }
    `)
    await Expect(SourceActions.applyStudioPatch(privateView, playlistSnapRequest())).rejects.toThrow(
      'requires one generated public view',
    )
    const wrongView = await parseDocument(`
      public view View5() { render Text("wrong") }
      scenarios View5 "sketch" { device phone scenario "draft" { render () } }
    `)
    await Expect(SourceActions.applyStudioPatch(wrongView, playlistSnapRequest())).rejects.toThrow(
      'requires one generated public view',
    )
    const wrongOwner = await parseDocument('public view View4() { render Text("not generated") }')
    await Expect(SourceActions.applyStudioPatch(wrongOwner, playlistSnapRequest())).rejects.toThrow(
      'not owned by one generated sketch scenario',
    )
  })

  Test('rejects duplicate rectangle identities and identity order mismatches', async () => {
    const document = await generatedSketchDocument()
    const duplicate = playlistSnapRequest({
      rectIds: ['same', 'same'],
      tree: {
        children: [leaf('same'), leaf('same')],
        direction: 'Row',
        layout: [],
        type: 'container',
      },
    })
    await Expect(SourceActions.applyStudioPatch(document, duplicate)).rejects.toThrow('invalid or duplicated')
    await Expect(SourceActions.applyStudioPatch(document, {
      ...playlistSnapRequest(),
      rectIds: ['duration', 'art', 'title', 'artist'],
    })).rejects.toThrow('identities do not match')
  })

  Test('rejects invalid component, layout ownership, empty tree, and arbitrary source fields', async () => {
    const document = await generatedSketchDocument()
    const invalidTrees: unknown[] = [
      { ...leaf('bad'), component: 'Script' },
      { ...leaf('bad'), layout: [['gap', 8]] },
      { children: [], direction: 'Row', layout: [], type: 'container' },
      { children: [leaf('bad')], direction: 'Stack', layout: [], type: 'container' },
    ]
    for (const tree of invalidTrees) {
      await Expect(SourceActions.applyStudioPatch(
        document,
        playlistSnapRequest({
          rectIds: ['bad'],
          tree: tree as StudioSketchSnapElement,
        }),
      )).rejects.toThrow()
    }
    await Expect(SourceActions.applyStudioPatch(document, {
      ...playlistSnapRequest({ rectIds: ['bad'], tree: leaf('bad') }),
      source: 'render Script(`unsafe`)',
    } as unknown as StudioSourcePatchRequest)).rejects.toThrow('unsupported fields')
  })

  for (const existingImport of ['', 'use Playlists from ./Data.tao']) {
    Test(
      `adds an imported entity parameter to every sketch scenario with ${existingImport || 'no data import'}`,
      async () => {
        await withTaoFiles('tao-source-actions-sketch-feed-', {
          'Data.tao': `project data Playlists / Playlist { Cover text, Title text, Score number }\n`,
          'View1.tao': `
          use Placeholder from @tao/ui
          ${existingImport}
          public view View1() { render Placeholder("View1") [width 360, height 76] }
          fixture Sketches {
            ChillVibes = create Playlist { Cover: "cover.png", Title: "Chill Vibes", Score: 7 }
            MorningRun = create Playlist { Cover: "run.png", Title: "Morning Run", Score: 12 }
          }
          scenarios View1 "sketch" {
            device phone
            scenario "first" { render () }
            scenario "second" { render () }
          }
        `,
        }, async paths => {
          const parsed = await Workspace.parse(paths['View1.tao'])
          const patch = await SourceActions.applyStudioPatch(parsed.entry.document, addEntityRequest(), {
            files: parsed.files.map(file => file.ast),
          })
          const updated = await Workspace.shared(FS.dirname(paths['View1.tao'])).then(workspace =>
            workspace.parseSource(patch.content, parsed.entry.document.uri)
          )

          Expect(patch.content).toContain(
            existingImport === '' ? 'use Playlist from ./Data.tao' : 'use Playlist, Playlists from ./Data.tao',
          )
          const entityImport = updated.entry.ast.statements.filter(AST.isUseStatement)
            .flatMap(statement => statement.importedDeclarations)
            .find(reference => reference.$refText === 'Playlist')
          Expect.Is(entityImport?.ref, AST.isEntityDataDeclaration)
          Expect(patch.content).toContain('public\nview View1(Playlist)')
          Expect(patch.content).toContain('fixture Sketches\n   device phone')
          Expect(patch.content).toContain('scenario "first" {\n      render (Playlist: ChillVibes)')
          Expect(patch.content).toContain('scenario "second" {\n      render (Playlist: MorningRun)')
          Expect(updated.entry.document.parseResult.lexerErrors).toEqual([])
          Expect(updated.entry.document.parseResult.parserErrors).toEqual([])
        }, { location: 'host' })
      },
    )
  }

  Test('rejects incomplete sketch scenario bindings and arbitrary source text', async () => {
    const document = await parseDocument(`
      data Playlists / Playlist { Title text }
      public view View1() { render Placeholder("View1") }
      fixture Sketches { ChillVibes = create Playlist { Title: "Chill" } }
      scenarios View1 "sketch" {
        scenario "first" { render () }
        scenario "second" { render () }
      }
    `)
    const request = addEntityRequest({
      entity: { declarationName: 'Playlists', importPath: './Data', parameterName: 'Playlist' },
      scenarioArguments: [{ fixtureHandle: 'ChillVibes', scenarioName: 'first' }],
    })

    await Expect(SourceActions.applyStudioPatch(document, request)).rejects.toThrow('every sketch scenario entry')
    await Expect(SourceActions.applyStudioPatch(document, {
      ...request,
      source: 'Text(`unsafe`)',
    } as unknown as StudioSourcePatchRequest)).rejects.toThrow('unsupported fields')
  })

  Test('binds tagged sketch leaves to text, interpolation, and accessible image fields', async () => {
    const first = await parseDocument(`
      use Image, Placeholder, Row, Text from @tao/ui
      data Playlists / Playlist { Cover text, Title text, Score number }
      public view View1(Playlist) {
        render Row() {
          #studio_rect_0063006f007600650072
          Placeholder("Cover") [width 52, height 52]
          #studio_rect_007400690074006c0065
          Placeholder("Title") [width 100, height 20]
          #studio_rect_00730063006f00720065
          Text("7") [width 36, height 20]
      } }
      scenarios View1 "sketch" { scenario "draft" { render () } }
    `)
    const coverPatch = await SourceActions.applyStudioPatch(
      first,
      bindFieldRequest({
        fieldPath: ['Cover'],
        presentation: { kind: 'image', labelFieldPath: ['Title'] },
        rectId: 'cover',
        renderId: renderId(requireRenderByText(first, 'Cover')),
      }),
    )
    const second = await parseRawDocument(coverPatch.content)
    const titlePatch = await SourceActions.applyStudioPatch(
      second,
      bindFieldRequest({
        fieldPath: ['Title'],
        presentation: { kind: 'text' },
        rectId: 'title',
        renderId: renderId(requireRenderByText(second, 'Title')),
      }),
    )
    const third = await parseRawDocument(titlePatch.content)
    const scorePatch = await SourceActions.applyStudioPatch(
      third,
      bindFieldRequest({
        fieldPath: ['Score'],
        presentation: { kind: 'text', suffix: ' points' },
        rectId: 'score',
        renderId: renderId(requireRenderByText(third, '7')),
      }),
    )

    Expect(coverPatch.content).toContain(
      '#studio_rect_0063006f007600650072\n      Image(Playlist.Cover, Label: Playlist.Title) [width 52, height 52]',
    )
    Expect(titlePatch.content).toContain(
      '#studio_rect_007400690074006c0065\n      Text(Playlist.Title) [width 100, height 20]',
    )
    Expect(scorePatch.content).toContain(
      '#studio_rect_00730063006f00720065\n      Text("{ Playlist.Score } points") [width 36, height 20]',
    )
    const updated = await parseRawDocument(scorePatch.content)
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
  })

  Test('rejects stale sketch tags, unknown paths, and non-text image fields', async () => {
    const document = await parseDocument(`
      use Placeholder from @tao/ui
      data Playlists / Playlist { Title text, Score number }
      public view View1(Playlist) {
        #studio_rect_007400690074006c0065
        render Placeholder("Title") [width 100]
      }
      scenarios View1 "sketch" { scenario "draft" { render () } }
    `)
    const target = renderId(requireRenderByText(document, 'Title'))

    await Expect(SourceActions.applyStudioPatch(
      document,
      bindFieldRequest({
        fieldPath: ['Missing'],
        renderId: target,
      }),
    )).rejects.toThrow('has no field Missing')
    await Expect(SourceActions.applyStudioPatch(
      document,
      bindFieldRequest({
        fieldPath: ['Score'],
        presentation: { kind: 'image' },
        renderId: target,
      }),
    )).rejects.toThrow('image source must be a text field')
    await Expect(SourceActions.applyStudioPatch(
      document,
      bindFieldRequest({
        rectId: 'other',
        renderId: target,
      }),
    )).rejects.toThrow('does not match rectangle other')
  })
})

function addEntityRequest(
  overrides: Partial<StudioAddSketchEntityParameterPatchRequest> = {},
): StudioAddSketchEntityParameterPatchRequest {
  return {
    entity: { declarationName: 'Playlists', importPath: './Data.tao', parameterName: 'Playlist' },
    fixtureName: 'Sketches',
    kind: 'add-sketch-entity-parameter',
    scenarioArguments: [
      { fixtureHandle: 'ChillVibes', scenarioName: 'first' },
      { fixtureHandle: 'MorningRun', scenarioName: 'second' },
    ],
    scenarioGroupName: 'sketch',
    viewName: 'View1',
    ...overrides,
  }
}

function bindFieldRequest(
  overrides: Partial<StudioBindSketchFieldPatchRequest> = {},
): StudioBindSketchFieldPatchRequest {
  return {
    fieldPath: ['Title'],
    kind: 'bind-sketch-field',
    parameterName: 'Playlist',
    presentation: { kind: 'text' },
    rectId: 'title',
    renderId: '/source.tao:0:1',
    viewName: 'View1',
    ...overrides,
  }
}

function playlistSnapRequest(
  overrides: Partial<StudioSnapSketchToFlowPatchRequest> = {},
): StudioSnapSketchToFlowPatchRequest {
  return {
    expectedCatalogRevision: 7,
    kind: 'snap-sketch-to-flow',
    mergeDirection: 'Row',
    mergePosition: 'after',
    rectIds: ['art', 'title', 'artist', 'duration'],
    sketchId: 'playlist-row',
    tree: {
      children: [
        { arguments: ['cover.png'], component: 'Image', layout: [['hug']], rectId: 'art', type: 'element' },
        {
          children: [
            { arguments: ['Night Drive'], component: 'Text', layout: [['hug']], rectId: 'title', type: 'element' },
            { arguments: ['Signals'], component: 'Text', layout: [['hug']], rectId: 'artist', type: 'element' },
          ],
          direction: 'Col',
          layout: [['gap', 4]],
          type: 'container',
        },
        {
          arguments: ['3:42'],
          component: 'Text',
          layout: [['width', 38], ['height', 20], ['claim', 1]],
          rectId: 'duration',
          type: 'element',
        },
      ],
      direction: 'Row',
      layout: [['gap', 12], ['pad', 'horizontal', 12, 'vertical', 8]],
      type: 'container',
    },
    viewName: 'View4',
    ...overrides,
  }
}

function leaf(rectId: string): StudioSketchSnapElement {
  return { arguments: ['text'], component: 'Text', layout: [['hug']], rectId, type: 'element' }
}

async function generatedSketchDocument(): Promise<AST.Document> {
  return await parseDocument(`
    public view View4() { render Text("old") }
    scenarios View4 "sketch" { device phone scenario "draft" { render () } }
  `)
}

Describe('Studio canvas-mode source actions', () => {
  Test('inspection offers text-binding candidates from parameters, entity fields, and loop items', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      data Stories / Story {
         Title text,
         Score number,
         Author text,
         Summary text?
      }

      view StoryRow(Story, Caption text) {
         render Col() [gap 4] {
            Text("Meta") [meta]
            Text(Story.Title)
      }  }
    `)
    const meta = SourceActions.inspectStudioRender(document, renderId(requireRenderByText(document, 'Meta')))
    Expect(meta.text).toEqual({
      candidates: [
        { expression: 'Caption', type: 'text' },
        { expression: 'Story.Author', type: 'text' },
        { expression: 'Story.Score', type: 'number' },
        { expression: 'Story.Title', type: 'text' },
      ],
      expression: '"Meta"',
      literal: 'Meta',
    })
    const bound = SourceActions.inspectStudioRender(document, renderId(requireRenderByText(document, 'Story.Title')))
    Expect(bound.text?.expression).toBe('Story.Title')
    Expect(bound.text?.literal).toBeUndefined()
    const container = SourceActions.inspectStudioRender(document, renderId(requireRenderByText(document, 'Col()')))
    Expect(container.text).toBeUndefined()
  })

  Test('inspection recognizes standard text leaves by declaration and omits enum bindings', async () => {
    const standard = await parseDocument(`
      use Text from @tao/ui

      type Status is one of Ready, Done

      view Main(Status Status, Caption text) {
         render Text("Label")
      }
    `)
    const inspection = SourceActions.inspectStudioRender(
      standard,
      renderId(requireRenderByText(standard, 'Label')),
    )
    Expect(inspection.text?.candidates).toEqual([{ expression: 'Caption', type: 'text' }])

    const custom = await parseDocument(`
      view Text(Value text) { render inject \`\`\`ts return null \`\`\` }
      view Main() { render Text("Custom") }
    `)
    const customInspection = SourceActions.inspectStudioRender(
      custom,
      renderId(requireRenderByText(custom, 'Custom')),
    )
    Expect(customInspection.text).toBeUndefined()
    await Expect(SourceActions.applyStudioPatch(custom, {
      content: 'Changed',
      kind: 'set-text-content',
      renderId: renderId(requireRenderByText(custom, 'Custom')),
    })).rejects.toThrow('Text or TextMultiline leaf')
  })

  Test('inspection decodes escaped literals and includes locals before a root text render', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui

      view Main(Caption text) {
         let Local = "local"
         render Text("literal \\{ brace, \\"quote\\", and \\\\ slash")
      }
    `)
    const inspection = SourceActions.inspectStudioRender(
      document,
      renderId(requireRenderByText(document, 'literal')),
    )
    Expect(inspection.text).toEqual({
      candidates: [
        { expression: 'Caption', type: 'text' },
        { expression: 'Local', type: 'text' },
      ],
      expression: '"literal \\{ brace, \\"quote\\", and \\\\ slash"',
      literal: 'literal { brace, "quote", and \\ slash',
    })
  })

  Test('text-binding candidates carry the enclosing loop item and stop at the render statement', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      view LabelList(Caption text) {
         render Col() [gap 4] {
            let Before = "before"
            loop ["Inbox", "Today"] / Label {
               Text("Meta") [meta]
               let After = "after"
               Text(After)
      }  }  }
    `)
    const meta = SourceActions.inspectStudioRender(document, renderId(requireRenderByText(document, 'Meta')))
    Expect(meta.text?.candidates).toEqual([
      { expression: 'Before', type: 'text' },
      { expression: 'Caption', type: 'text' },
      { expression: 'Label', type: 'text' },
    ])
    await Expect(SourceActions.applyStudioPatch(document, {
      expression: 'After',
      kind: 'bind-text',
      renderId: renderId(requireRenderByText(document, 'Meta')),
    })).rejects.toThrow('not visible at this render')
    const bound = await SourceActions.applyStudioPatch(document, {
      expression: 'Label',
      kind: 'bind-text',
      renderId: renderId(requireRenderByText(document, 'Meta')),
    })
    Expect(bound.content).toContain('Text(Label) [meta]')
  })

  Test('bind-text points a text leaf at a visible value and interpolates a number', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      data Stories / Story {
         Title text,
         Score number
      }

      view StoryRow(Story) {
         render Col() [gap 4] {
            Text("Meta") [meta]
            Text("Points")
      }  }
    `)
    const title = await SourceActions.applyStudioPatch(document, {
      expression: 'Story.Title',
      kind: 'bind-text',
      renderId: renderId(requireRenderByText(document, 'Meta')),
    })
    Expect(title.content).toContain('Text(Story.Title) [meta]')
    const score = await SourceActions.applyStudioPatch(document, {
      expression: 'Story.Score',
      kind: 'bind-text',
      renderId: renderId(requireRenderByText(document, 'Points')),
    })
    Expect(score.content).toContain('Text("{ Story.Score }")')
    await Expect(SourceActions.applyStudioPatch(document, {
      expression: 'Story.Missing',
      kind: 'bind-text',
      renderId: renderId(requireRenderByText(document, 'Meta')),
    })).rejects.toThrow('not visible at this render')
    await Expect(SourceActions.applyStudioPatch(document, {
      expression: 'Story.Title',
      kind: 'bind-text',
      renderId: renderId(requireRenderByText(document, 'Col()')),
    })).rejects.toThrow('Text or TextMultiline leaf')
  })

  Test('set-text-content rewrites only the literal and keeps layout and named arguments', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      view MainView() {
         render Col() {
            Text("Old", Lines: 1) [meta]
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      content: 'New "quoted" text',
      kind: 'set-text-content',
      renderId: renderId(requireRenderByText(document, 'Old')),
    })
    Expect(patch.content).toContain('Text("New \\"quoted\\" text", Lines: 1) [meta]')
  })

  Test('remove-render deletes a direct child with its tag and refuses the root render', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      view MainView() {
         render Col() {
            Text("First")
            #second
            Text("Second")
            Text("Third")
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'remove-render',
      renderId: renderId(requireRenderByText(document, 'Second')),
    })
    Expect(patch.content).toBe(source(`
      use Col, Text from @tao/ui

      view MainView() {
         render Col() {
            Text("First")
            Text("Third")
      }  }
    `))
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'remove-render',
      renderId: renderId(requireRenderByText(document, 'Col()')),
    })).rejects.toThrow('root render stays')
  })

  Test('remove-render owns its leading comments without deleting the next render comments', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      view MainView() {
         render Col() {
            Text("First")
            // Explanation for Second.
            #second
            Text("Second")
            // Explanation for Third.
            Text("Third")
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'remove-render',
      renderId: renderId(requireRenderByText(document, 'Second')),
    })
    Expect(patch.content).not.toContain('Explanation for Second')
    Expect(patch.content).toContain('// Explanation for Third.')
    Expect(patch.content).toContain('Text("Third")')
  })

  Test("remove-render keeps a snapped render and a container's only child", async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      view MainView() {
         render Col() {
            #studio_rect_00720031
            Text("Snapped")
            Text("Plain")
      }  }

      view SoloView() {
         render Col() {
            Text("Only")
      }  }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'remove-render',
      renderId: renderId(requireRenderByText(document, 'Snapped')),
    })).rejects.toThrow('Unsnap the sketch first')
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'remove-render',
      renderId: renderId(requireRenderByText(document, 'Only')),
    })).rejects.toThrow("container's only child")
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'remove-render',
      renderId: renderId(requireRenderByText(document, 'Plain')),
    })
    Expect(patch.content).toContain('#studio_rect_00720031')
    Expect(patch.content).toContain('Text("Snapped")')
    Expect(patch.content).not.toContain('Text("Plain")')
  })

  Test('remove-render refuses a container that owns a snapped descendant', async () => {
    const document = await parseDocument(`
      use Col, Stack, Text from @tao/ui

      view MainView() {
         render Col() {
            Stack() {
               #studio_rect_00720031
               Text("Snapped")
            }
            Text("Plain")
      }  }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'remove-render',
      renderId: renderId(requireRenderByText(document, 'Stack()')),
    })).rejects.toThrow('Unsnap the sketch first')
  })

  Test('wrap-render accepts Row and Col and imports the wrapper it introduces', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      view MainView() {
         render Col() {
            Text("First")
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'wrap-render',
      renderId: renderId(requireRenderByText(document, 'First')),
      wrapper: 'Row',
    })
    Expect(patch.content).toContain('use Col, Row, Text from @tao/ui')
    Expect(patch.content).toContain('Row() [gap 8, pad 8] {')
  })

  Test('wrap-render refuses a wrapper name already owned by a local declaration', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui

      view Row() { render Text("Custom Row") }
      view MainView() { render Text("First") }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'wrap-render',
      renderId: renderId(requireRenderByText(document, 'First')),
      wrapper: 'Row',
    })).rejects.toThrow("cannot import 'Row' from @tao/ui")
  })

  Test('wrap-render refuses a wrapper name owned by a folder-visible sibling declaration', async () => {
    await withTaoFiles('tao-source-actions-sibling-wrapper-', {
      'Main.tao': `
        use Text from @tao/ui

        view MainView() { render Text("First") }
      `,
      'Sibling.tao': `
        use Text from @tao/ui

        folder view Row() { render Text("Project Row") }
      `,
    }, async paths => {
      const workspace = await Workspace.open(FS.dirname(paths['Main.tao']))
      const sibling = await workspace.parse(paths['Sibling.tao'])
      const parsed = await workspace.parse(paths['Main.tao'])
      await Expect(SourceActions.applyStudioPatch(parsed.entry.document, {
        kind: 'wrap-render',
        renderId: renderId(requireRenderByText(parsed.entry.document, 'First')),
        wrapper: 'Row',
      }, { files: [parsed.entry.ast, sibling.entry.ast] })).rejects.toThrow("cannot import 'Row' from @tao/ui")
    }, { location: 'host' })
  })

  Test('wrap-render keeps a Snap marker attached to the render it identifies', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      view MainView() {
         render Col() {
            #studio_rect_00720031
            Text("Snapped")
            Text("Plain")
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'wrap-render',
      renderId: renderId(requireRenderByText(document, 'Snapped')),
      wrapper: 'Row',
    })
    Expect(patch.content).toContain('Row() [gap 8, pad 8] {\n         #studio_rect_00720031\n         Text("Snapped")')
    Expect(patch.content.indexOf('Row()')).toBeLessThan(patch.content.indexOf('#studio_rect_00720031'))
  })
})

Describe('Studio make view and group', () => {
  const header = `
      use Col, Text from @tao/ui

      view MainView(Title text, Count number) {
         let Note = "Kept"
         render Col() {
            Text("Before")
            Text(Title)
            Text("{ Count } of { Note }")
            Text("After")
         }
      }
    `

  Test('extract-view makes a view from one render and passes the values it reads', async () => {
    const document = await parseDocument(header)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'Heading',
      renderIds: [renderId(requireRenderBySource(document, 'Text(Title)'))],
    })
    Expect(patch.content).toBe(source(`
      use Col, Text from @tao/ui

      view MainView(Title text, Count number) {
         let Note = "Kept"
         render Col() {
            Text("Before")
            Heading(Title: Title)
            Text("{ Count } of { Note }")
            Text("After")
      }  }

      view Heading(Title text) {
         render Text(Title)
      }
    `))
    await expectCanonical(patch.content)
  })

  Test('extract-view groups adjacent renders under a Col and types a local from its value', async () => {
    const document = await parseDocument(header)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'Summary',
      renderIds: [
        renderId(requireRenderBySource(document, 'Text("{ Count }')),
        renderId(requireRenderBySource(document, 'Text(Title)')),
      ],
    })
    Expect(patch.content).toContain('Summary(Title: Title, Count: Count, Note: Note)')
    Expect(patch.content).toContain(source(`
      view Summary(Title text, Count number, Note text) {
         render Col() {
            Text(Title)
            Text("{ Count } of { Note }")
      }  }
    `))
    Expect(patch.content).toContain('   render Col() {\n      Text("Before")\n      Summary(')
    await expectCanonical(patch.content)
  })

  Test('extract-view copies a shorthand parameter and names a loop item by its entity', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui
      data Playlists / Playlist { Title text }

      view Shelf(Playlist, Others list of Playlist) {
         render Col() {
            Text(Playlist.Title)
            loop Others / Other {
               Text(Other.Title)
            }
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'Pair',
      renderIds: [renderId(requireRenderBySource(document, 'Text(Other.Title)'))],
    })
    Expect(patch.content).toContain('Pair(Other: Other)')
    Expect(patch.content).toContain('view Pair(Other Playlist) {\n   render Text(Other.Title)\n}')
    await expectCanonical(patch.content)

    const lead = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'Lead',
      renderIds: [renderId(requireRenderBySource(document, 'Text(Playlist.Title)'))],
    })
    Expect(lead.content).toContain('view Lead(Playlist) {\n   render Text(Playlist.Title)\n}')
    Expect(lead.content).toContain('Lead(Playlist: Playlist)')
    await expectCanonical(lead.content)
  })

  Test('extract-view numbers an unnamed view after the views already visible', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      view View1() { render Text("Taken") }
      view MainView() {
         render Col() {
            Text("Loose")
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      renderIds: [renderId(requireRenderBySource(document, 'Text("Loose")'))],
    })
    Expect(patch.content).toContain('      View2()\n')
    Expect(patch.content).toContain('view View2() {\n   render Text("Loose")\n}')
  })

  Test('extract-view refuses a selection it cannot move without changing meaning', async () => {
    const document = await parseDocument(header)
    const extract = (name: string, texts: readonly string[]) =>
      SourceActions.applyStudioPatch(document, {
        kind: 'extract-view',
        name,
        renderIds: texts.map(text => renderId(requireRenderBySource(document, text))),
      })
    await Expect(extract('Split', ['Text("Before")', 'Text("After")'])).rejects.toThrow('adjacent elements')
    await Expect(extract('MainView', ['Text("Before")'])).rejects.toThrow('already visible here')
    await Expect(extract('lower', ['Text("Before")'])).rejects.toThrow('capital letter')
    await Expect(extract('Whole', ['Col()'])).rejects.toThrow("not a view's root render")

    const stateful = await parseDocument(`
      use Col, Text from @tao/ui

      view MainView() {
         state Taps = 0
         render Col() {
            Text("{ Taps } taps")
         }
      }
    `)
    await Expect(SourceActions.applyStudioPatch(stateful, {
      kind: 'extract-view',
      name: 'Tapper',
      renderIds: [renderId(requireRenderBySource(stateful, 'taps")'))],
    })).rejects.toThrow('cannot make a view that reads Taps')
  })

  Test('group-renders wraps adjacent renders in place and imports the wrapper', async () => {
    const document = await parseDocument(header)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'group-renders',
      renderIds: [
        renderId(requireRenderBySource(document, 'Text(Title)')),
        renderId(requireRenderBySource(document, 'Text("{ Count }')),
      ],
      wrapper: 'Row',
    })
    Expect(patch.content).toContain('use Col, Row, Text from @tao/ui')
    Expect(patch.content).toContain(`      Text("Before")
      Row() {
         Text(Title)
         Text("{ Count } of { Note }")
      }
      Text("After")`)
    await expectCanonical(patch.content)
  })

  Test('extract-view passes a guard error message as a text parameter', async () => {
    await withStudioProject(
      {
        'Main.tao': `
        use Col, Text from @tao/ui

        project
        data Notes / Note {
           Title text,
        }
        view MainView() {
           query Notes = Notes with { }
           render Col() {
              guard Notes {
                 loading -> { Text("Loading") }
                 error -> Message {
                    Text(Message)
                    Text("Try again")
              }  }
              Text("After")
        }  }
      `,
      },
      'Main.tao',
      async project => {
        const content = await project.patch({
          kind: 'extract-view',
          name: 'Failure',
          renderIds: [renderId(requireRenderBySource(project.document, 'Text(Message)'))],
        })
        Expect(content).toContain('Failure(Message: Message)')
        Expect(content).toContain('view Failure(Message text) {\n   render Text(Message)\n}')
      },
    )
  })

  Test('extract-view refuses caller content, a bare render slot, and a query read', async () => {
    const document = await parseDocument(`
      use Col, Row, Text from @tao/ui

      data Notes / Note { Title text }
      view Frame() {
         @header = empty
         query Notes = Notes with { }
         render Col() {
            Row() {
               @@content
            }
            Col() {
               @header
            }
            Col() {
               loop Notes / Note {
                  Text(Note.Title)
            }  }
            Text("After")
      }  }
    `)
    const extract = (text: string) =>
      SourceActions.applyStudioPatch(document, {
        kind: 'extract-view',
        name: 'Inner',
        renderIds: [renderId(requireRenderBySource(document, text))],
      })
    await Expect(extract('Row()')).rejects.toThrow('caller content and render slots stay in the view that owns them')
    await Expect(extract('Col() {\n         @header')).rejects.toThrow(
      'caller content and render slots stay in the view that owns them',
    )
    await Expect(extract('Col() {\n         loop')).rejects.toThrow(
      'cannot make a view that reads Notes yet: queries, state, actions and commands stay in the view that owns them',
    )

    const later = await parseDocument(`
      use Col, Text from @tao/ui

      view MainView() {
         render Col() {
            Text(Later)
            Text("After")
         }
         let Later = "Later"
      }
    `)
    await Expect(SourceActions.applyStudioPatch(later, {
      kind: 'extract-view',
      name: 'Inner',
      renderIds: [renderId(requireRenderBySource(later, 'Text(Later)'))],
    })).rejects.toThrow('cannot make a view that reads Later: MainView binds it outside the selection')
  })

  Test('group-renders and extract-view keep a bare when arm and a one-line block valid', async () => {
    const files = {
      'Main.tao': `
        use Col, Row, Text from @tao/ui

        view MainView(Flag boolean, Name text) {
           render Row() {
              when Flag
                 | true -> Text(Name)
                 | otherwise -> Text("n")
              Col() { Text("C") }
        }  }
      `,
    }
    const cases = [
      { kind: 'extract-view', name: 'Arm', text: 'Text(Name)', written: '| true -> Arm(Name: Name)' },
      {
        kind: 'group-renders',
        text: 'Text("n")',
        written: '| otherwise -> Col() {\n            Text("n")\n         }',
      },
      { kind: 'extract-view', name: 'Inner', text: 'Text("C")', written: 'Col() {\n         Inner()' },
      { kind: 'group-renders', text: 'Text("C")', written: 'Col() {\n         Col() {\n            Text("C")' },
    ] as const
    for (const testCase of cases) {
      await withStudioProject(files, 'Main.tao', async project => {
        const renderIds = [renderId(requireRenderBySource(project.document, testCase.text))]
        const content = await project.patch(
          testCase.kind === 'extract-view'
            ? { kind: 'extract-view', name: testCase.name, renderIds }
            : { kind: 'group-renders', renderIds, wrapper: 'Col' },
        )
        Expect(content).toContain(testCase.written)
      })
    }
  })

  Test("extract-view roots several siblings in their parent's direction", async () => {
    await withStudioProject(
      {
        'Main.tao': `
        use Col, Row, Text from @tao/ui

        view MainView() {
           render Col() {
              Row() {
                 Text("A")
                 Text("B")
              }
              Text("C")
        }  }
      `,
      },
      'Main.tao',
      async project => {
        const content = await project.patch({
          kind: 'extract-view',
          name: 'Pair',
          renderIds: ['Text("A")', 'Text("B")'].map(text => renderId(requireRenderBySource(project.document, text))),
        })
        Expect(content).toContain('view Pair() {\n   render Row() {\n      Text("A")\n      Text("B")\n}  }')
      },
    )
  })

  Test('extract-view refuses an entity name and the name of a value the view takes', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui

      data Notes / Note { Title text }
      view MainView(Title text) {
         render Col() {
            Text(Title)
            Text("After")
      }  }
    `)
    const extract = (name: string) =>
      SourceActions.applyStudioPatch(document, {
        kind: 'extract-view',
        name,
        renderIds: [renderId(requireRenderBySource(document, 'Text(Title)'))],
      })
    await Expect(extract('Note')).rejects.toThrow('A declaration named Note is already visible here')
    await Expect(extract('Title')).rejects.toThrow('The new view takes a value named Title')
    await Expect(SourceActions.applyStudioPatch(document, { kind: 'copy-view', name: 'Note', view: 'MainView' }))
      .rejects.toThrow('A declaration named Note is already visible here')
  })
})

Describe('Studio copy-view', () => {
  Test('copy-view duplicates a declared view right after the original, keeping its public modifier', async () => {
    const document = await parseDocument(`
      public view Card(Title text) {
         render Text(Title)
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'copy-view',
      name: 'CardCopy',
      view: 'Card',
    })

    Expect(patch.content).toBe(source(`
      public
      view Card(Title text) {
         render Text(Title)
      }

      public
      view CardCopy(Title text) {
         render Text(Title)
      }
    `))
    await expectCanonical(patch.content)
  })

  Test('copy-view excludes the original doc comment from the copy', async () => {
    const document = await parseDocument(`
      // Renders one card.
      view Card(Title text) {
         render Text(Title)
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'copy-view',
      name: 'CardCopy',
      view: 'Card',
    })

    Expect(patch.content).toBe(source(`
      // Renders one card.
      view Card(Title text) {
         render Text(Title)
      }

      view CardCopy(Title text) {
         render Text(Title)
      }
    `))
  })

  Test('copy-view does not rewrite a recursive self-reference in the body', async () => {
    const document = await parseDocument(`
      view Item() {
         render Stack() {
            Item()
      }  }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'copy-view',
      name: 'ItemCopy',
      view: 'Item',
    })

    Expect(patch.content).toContain('view ItemCopy() {')
    Expect(patch.content.match(/ItemCopy\(\)/g)).toHaveLength(1)
    Expect(patch.content.match(/Item\(\)/g)).toHaveLength(3)
  })

  Test('copy-view refuses a view that is not declared here', async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'copy-view',
      name: 'CardCopy',
      view: 'Missing',
    })).rejects.toThrow('not uniquely declared')
  })

  Test('copy-view refuses an ambiguous view name', async () => {
    const document = await parseRawDocument(`
      view Card() { render Text("A") }
      view Card() { render Text("B") }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'copy-view',
      name: 'CardCopy',
      view: 'Card',
    })).rejects.toThrow('not uniquely declared')
  })

  Test('copy-view refuses a name already visible in the file', async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      view Other() { render Text("Other") }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'copy-view',
      name: 'Other',
      view: 'Card',
    })).rejects.toThrow('already visible here')
  })
})

Describe('Studio add-render-scenario', () => {
  Test("adds a new entry from another entry's own render clause and a chosen device size", async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      scenarios Card "states" {
         scenario "lead" {
            device phone 390 x 844
            render (Title: "Lead")
         }
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      fromScenarioName: 'lead',
      height: 900,
      kind: 'add-render-scenario',
      scenarioGroupName: 'states',
      scenarioName: 'copy',
      width: 400,
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toBe(source(`
      view Card(Title text) {
         render Text(Title)
      }

      scenarios Card "states" {
         scenario "lead" {
            device phone 390 x 844
            render (Title: "Lead")
         }
         scenario "copy" {
            device phone 400 x 900
            render (Title: "Lead")
      }  }
    `))
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
  })

  Test("writes only the device line when the from-entry inherits the group's render clause", async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      scenarios Card "states" {
         render (Title: "Default")
         device phone
         scenario "lead" { }
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      fromScenarioName: 'lead',
      height: 900,
      kind: 'add-render-scenario',
      scenarioGroupName: 'states',
      scenarioName: 'copy',
      width: 400,
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toBe(source(`
      view Card(Title text) {
         render Text(Title)
      }

      scenarios Card "states" {
         render (Title: "Default")
         device phone
         scenario "lead" { }
         scenario "copy" {
            device phone 400 x 900
      }  }
    `))
    const newScenario = updated.parseResult.value.statements
      .filter(AST.isScenarioGroupDeclaration)
      .flatMap(group => AST.scenarioDeclarations(group))
      .find(scenario => scenario.name === 'copy')!
    Expect(newScenario.block.entries.filter(AST.isScenarioRenderClause)).toEqual([])
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
  })

  Test('refuses ambiguous scenario identity', async () => {
    const document = await parseDocument(`
      view Card() { render Text("Card") }
      scenarios Card "states" { scenario "lead" { } }
      scenarios Card "states" { scenario "lead" { } }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      fromScenarioName: 'lead',
      height: 900,
      kind: 'add-render-scenario',
      scenarioGroupName: 'states',
      scenarioName: 'copy',
      width: 400,
    })).rejects.toThrow('not uniquely declared')
  })

  Test('refuses a from-entry whose effective subject is not a view', async () => {
    const document = await parseDocument(`
      app Preview { view Main }
      view Main() { render Text("Main") }
      scenarios Preview "flows" {
         scenario "boot" { }
      }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      fromScenarioName: 'boot',
      height: 900,
      kind: 'add-render-scenario',
      scenarioGroupName: 'flows',
      scenarioName: 'copy',
      width: 400,
    })).rejects.toThrow('can only add a render scenario from a focused render scenario')
  })

  Test('refuses a new scenario name that already exists in the group', async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      scenarios Card "states" {
         scenario "lead" { device phone render (Title: "Lead") }
         scenario "taken" { device phone render (Title: "Taken") }
      }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      fromScenarioName: 'lead',
      height: 900,
      kind: 'add-render-scenario',
      scenarioGroupName: 'states',
      scenarioName: 'taken',
      width: 400,
    })).rejects.toThrow('already exists')
  })

  Test('refuses invalid scenario names', async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      scenarios Card "states" {
         scenario "lead" { device phone render (Title: "Lead") }
      }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      fromScenarioName: 'lead',
      height: 900,
      kind: 'add-render-scenario',
      scenarioGroupName: 'states',
      scenarioName: '',
      width: 400,
    })).rejects.toThrow('identity is invalid')
    await Expect(SourceActions.applyStudioPatch(document, {
      fromScenarioName: 'lead',
      height: 900,
      kind: 'add-render-scenario',
      scenarioGroupName: 'states',
      scenarioName: 'bad\x01name',
      width: 400,
    })).rejects.toThrow('identity is invalid')
  })

  Test('refuses a non-positive or non-whole device size', async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      scenarios Card "states" {
         scenario "lead" { device phone render (Title: "Lead") }
      }
    `)
    const attempt = (width: number, height: number) =>
      SourceActions.applyStudioPatch(document, {
        fromScenarioName: 'lead',
        height,
        kind: 'add-render-scenario',
        scenarioGroupName: 'states',
        scenarioName: 'copy',
        width,
      })
    await Expect(attempt(0, 900)).rejects.toThrow('positive whole number')
    await Expect(attempt(400, -1)).rejects.toThrow('positive whole number')
    await Expect(attempt(400.5, 900)).rejects.toThrow('positive whole number')
  })

  Test("copies the from-entry's own fixture and prepare clauses, which its render arguments read", async () => {
    await withStudioProject(
      { ...notebookFiles, 'Scenarios.tao': notebookScenarios(ownFixtureEntries) },
      'Scenarios.tao',
      async project => {
        const content = await project.patch({
          fromScenarioName: 'groceries',
          height: 200,
          kind: 'add-render-scenario',
          scenarioGroupName: 'notes states',
          scenarioName: 'drawn1',
          width: 300,
        })
        Expect(content).toContain(
          source(`
           scenario "drawn1" {
              device phone 300 x 200
              fixture Sample
              prepare {
                 update Groceries {
                    Title: "Milk"
              }  }
              render (Note: Groceries)
        }  }
      `).trimStart(),
        )
      },
    )
  })
})

Describe('Studio retarget-scenario-render', () => {
  Test("retargets an entry's own render clause at a different view, keeping its arguments", async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      view OtherCard(Title text) { render Text(Title) }
      scenarios Card "states" {
         scenario "lead" {
            render (Title: "Lead")
         }
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'retarget-scenario-render',
      scenarioGroupName: 'states',
      scenarioName: 'lead',
      view: 'OtherCard',
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toBe(source(`
      view Card(Title text) {
         render Text(Title)
      }

      view OtherCard(Title text) {
         render Text(Title)
      }

      scenarios Card "states" {
         scenario "lead" {
            render OtherCard(Title: "Lead")
      }  }
    `))
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
  })

  Test("adds an inherited render clause as the entry's first line, retargeted at another view", async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      view OtherCard(Title text) { render Text(Title) }
      scenarios Card "states" {
         render (Title: "Default")
         device phone
         scenario "lead" {
            press #edit
         }
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'retarget-scenario-render',
      scenarioGroupName: 'states',
      scenarioName: 'lead',
      view: 'OtherCard',
    })
    const updated = await parseRawDocument(patch.content)

    Expect(patch.content).toBe(source(`
      view Card(Title text) {
         render Text(Title)
      }

      view OtherCard(Title text) {
         render Text(Title)
      }

      scenarios Card "states" {
         render (Title: "Default")
         device phone
         scenario "lead" {
            render OtherCard(Title: "Default")
            press #edit
      }  }
    `))
    Expect(updated.parseResult.lexerErrors).toEqual([])
    Expect(updated.parseResult.parserErrors).toEqual([])
  })

  Test('refuses ambiguous scenario identity', async () => {
    const document = await parseDocument(`
      view Card() { render Text("Card") }
      scenarios Card "states" { scenario "lead" { } }
      scenarios Card "states" { scenario "lead" { } }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'retarget-scenario-render',
      scenarioGroupName: 'states',
      scenarioName: 'lead',
      view: 'Card',
    })).rejects.toThrow('not uniquely declared')
  })

  Test('refuses an entry with no effective render clause', async () => {
    const document = await parseDocument(`
      app Preview { view Main }
      view Main() { render Text("Main") }
      scenarios Preview "flows" {
         scenario "boot" { }
      }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'retarget-scenario-render',
      scenarioGroupName: 'flows',
      scenarioName: 'boot',
      view: 'Main',
    })).rejects.toThrow('can only retarget a focused render scenario')
  })

  Test('adds the new view to the use statement that brought the original view in', async () => {
    await withStudioProject(
      { ...notebookFiles, 'Scenarios.tao': notebookScenarios(groupFixtureEntries) },
      'Scenarios.tao',
      async project => {
        const content = await project.patch({
          kind: 'retarget-scenario-render',
          scenarioGroupName: 'notes states',
          scenarioName: 'ideas',
          view: 'View3',
        })
        Expect(content).toContain('use NoteRow, View3 from ./Notes\n')
        Expect(content).toContain('render View3(Note: Ideas)')
      },
    )
  })

  Test(
    'writes a render clause for an entry of a view group that has none, leaving a same-file view unimported',
    async () => {
      await withStudioProject(
        {
          'Main.tao': `
        use Text from @tao/ui

        view Badge() { render Text("Badge") }
        view View2() { render Text("Badge") }
        scenarios Badge "states" {
           scenario "drawn2" {
              device phone 100 x 100
        }  }
      `,
        },
        'Main.tao',
        async project => {
          const content = await project.patch({
            kind: 'retarget-scenario-render',
            scenarioGroupName: 'states',
            scenarioName: 'drawn2',
            view: 'View2',
          })
          Expect(content).toContain('   scenario "drawn2" {\n      render View2()\n      device phone 100 x 100\n')
          Expect(content.startsWith('use Text from @tao/ui\n')).toBe(true)
        },
      )
    },
  )

  Test('refuses a view name that is not a capitalized identifier', async () => {
    const document = await parseDocument(`
      view Card(Title text) { render Text(Title) }
      scenarios Card "states" { scenario "lead" { render (Title: "Lead") } }
    `)
    for (const view of ['card', 'Card)', '']) {
      await Expect(SourceActions.applyStudioPatch(document, {
        kind: 'retarget-scenario-render',
        scenarioGroupName: 'states',
        scenarioName: 'lead',
        view,
      })).rejects.toThrow('Studio view name')
    }
  })
})

const notebookFiles = {
  'Data.tao': `
    package
    data Notes / Note {
       Title text,
    }
  `,
  'Notes/Notes.tao': `
    use Text from @tao/ui
    use Note from ..

    package
    view NoteRow(Note) {
       render Text(Note.Title)
    }

    package
    view View3(Note) {
       render Text(Note.Title)
    }
  `,
}

const ownFixtureEntries = `
   device phone
   scenario "groceries" {
      fixture Sample
      prepare {
         update Groceries {
            Title: "Milk"
      }  }
      render (Note: Groceries)
   }
   scenario "ideas" {
      fixture Sample
      render (Note: Ideas)
   }`

const groupFixtureEntries = `
   fixture Sample
   device phone
   scenario "groceries" {
      render (Note: Groceries)
   }
   scenario "ideas" {
      render (Note: Ideas)
   }`

/** notebookScenarios mirrors the Notebook starter's scenarios file around the given group entries. */
function notebookScenarios(entries: string): string {
  return `use Note from ./
use NoteRow from ./Notes

fixture Sample {
   Groceries = create Note {
      Title: "Groceries"
   }
   Ideas = create Note {
      Title: "Ideas"
}  }

scenarios NoteRow "notes states" {${entries}
}
`
}

type StudioProject = Readonly<{
  document: AST.Document
  /** patch applies one request to the entry and asserts the whole project still links and validates with it. */
  patch: (request: StudioSourcePatchRequest) => Promise<string>
}>

/**
 * withStudioProject writes a temporary project and parses its entry together with every other file, as
 * Studio's server does, so a patch sees the same workspace context and its output is judged by the
 * linker and validator rather than by its shape alone.
 */
async function withStudioProject(
  files: Readonly<Record<string, string>>,
  entry: string,
  test: (project: StudioProject) => Promise<void>,
): Promise<void> {
  await withTaoFiles('tao-studio-validated-', files, async (paths, root) => {
    const entryPath = paths[entry]
    Assert.defined(entryPath, `the Studio project declares its entry file: ${entry}`)
    const allPaths = [entryPath, ...Object.values(paths).filter(path => path !== entryPath)]
    const parsed = await (await Workspace.open(root)).parseFiles(allPaths)
    const document = parsed[0]!.entry.document
    const context = { files: [...new Set(parsed.flatMap(result => result.files.map(file => file.ast)))] }
    await test({
      document,
      patch: async request => {
        const { content } = await SourceActions.applyStudioPatch(document, request, context)
        const validated = await (await Workspace.open(root, { sourceOverrides: { [entryPath]: content } }))
          .validateFiles(allPaths)
        Expect(
          validated.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
            diagnostic.message
          ),
        ).toEqual([])
        return content
      },
    })
  })
}

/** expectCanonical asserts that `tao check` finds edited source canonical: every source fix leaves it unchanged. */
async function expectCanonical(content: string): Promise<void> {
  const document = await parseRawDocument(content)
  Expect(await SourceActions.fixSource(document, await sourceActionOptionsFor(document))).toBe(content)
}

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
  Assert.defined(render, `a render containing text: ${text}`)
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
  Assert.defined(render, `a render containing source: ${text}`)
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

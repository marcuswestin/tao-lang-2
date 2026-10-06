import { AST } from '@parser'
import { Assert, Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import Validator from '@validator'
import SourceActions from '../source-actions-src/source-actions'
import { parseDocument } from './test-source-actions'

function textRender(document: AST.Document, text: string): AST.Render {
  const render = AST.streamAllContents(document.parseResult.value)
    .find((node): node is AST.Render =>
      AST.isRender(node) && node.view?.$refText === 'Text'
      && AST.argumentsOf(node).some(argument => AST.isStringLiteral(argument.value) && argument.value.value === text)
    )
  Expect.Is(render, AST.isRender)
  return render
}

function renderId(render: AST.Render): string {
  const cst = render.$cstNode!
  return `${AST.getDocument(render).uri.fsPath}:${cst.offset}:${cst.end}`
}

function labels(render: AST.Render): string[] {
  return AST.renderPrefixCluster(render).filter(AST.isRenderAccessibilityStatement).map(label =>
    label.value.$cstNode!.text
  )
}

async function updatedDocument(content: string): Promise<AST.Document> {
  const updated = await parseDocument(content)
  Expect(updated.parseResult.parserErrors).toEqual([])
  return updated
}

Describe('Studio render occurrence prefixes', () => {
  Test('removes an occurrence label with its render without relabelling the next sibling', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui
      view Main() { render Col() { accessible label "A name" Text("A") Text("B") } }
    `)
    const selected = textRender(document, 'A')
    Expect(selected).toBeDefined()
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'remove-render',
      renderId: renderId(selected),
    })
    const updated = await parseDocument(patch.content)
    Expect(textRender(updated, 'B')).toBeDefined()
    Expect(AST.streamAllContents(updated.parseResult.value).filter(AST.isRenderAccessibilityStatement)).toHaveLength(0)
    Expect(AST.renderPrefixCluster(textRender(updated, 'B'))).toEqual([])
  })

  Test('removes last same-line and multiline metadata clusters without leaving dangling prefixes', async () => {
    for (const prefix of ['accessible label "A name"', '#a accessible label "A name"', 'a11y label "A name" #a']) {
      for (const gap of [' ', '\n']) {
        const document = await parseDocument(`use Col, Text from @tao/ui view Main() { render Col() {
          Text("B") ${prefix}${gap}Text("A")
        } }`)
        const patch = await SourceActions.applyStudioPatch(document, {
          kind: 'remove-render',
          renderId: renderId(textRender(document, 'A')),
        })
        const updated = await updatedDocument(patch.content)
        Expect(textRender(updated, 'B')).toBeDefined()
        Expect(AST.streamAllContents(updated.parseResult.value).filter(AST.isRenderAccessibilityStatement))
          .toHaveLength(0)
        Expect(AST.streamAllContents(updated.parseResult.value).filter(AST.isTagStatement)).toHaveLength(0)
      }
    }
  })

  Test('counts an entire prefix cluster as metadata when refusing the only child removal', async () => {
    for (const prefix of ['accessible label "Only"', '#only accessible label "Only"', 'a11y label "Only" #only']) {
      const document = await parseDocument(
        `use Col, Text from @tao/ui view Main() { render Col() { ${prefix} Text("A") } }`,
      )
      await Expect(SourceActions.applyStudioPatch(document, {
        kind: 'remove-render',
        renderId: renderId(textRender(document, 'A')),
      })).rejects.toThrow("container's only child")
    }
  })

  Test('moves a commented reversed cluster with its occurrence and preserves the next sibling comments', async () => {
    const document = await parseDocument(`
      use Col, Text from @tao/ui
      view Main() { render Col() {
        // A documentation.
        accessible label "A name"
        // A prefix explanation.
        #a
        Text("A")
        // B documentation.
        Text("B")
        Text("C")
      } }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'move-render',
      draggedId: renderId(textRender(document, 'A')),
      afterId: renderId(textRender(document, 'C')),
    })
    const updated = await updatedDocument(patch.content)
    Expect(labels(textRender(updated, 'A'))).toEqual(['"A name"'])
    Expect(AST.attachedTag(textRender(updated, 'A'))?.tag).toBe('#a')
    Expect(labels(textRender(updated, 'B'))).toEqual([])
    Expect(patch.content.indexOf('B documentation')).toBeLessThan(patch.content.indexOf('Text("B")'))
    Expect(patch.content.indexOf('Text("C")')).toBeLessThan(patch.content.indexOf('A documentation'))
    Expect(patch.content).toContain('// A prefix explanation.')
  })

  Test(
    'moves a complete cluster between blocks without labelling the source sibling or destination wrapper',
    async () => {
      const document = await parseDocument(`use Col, Row, Text from @tao/ui view Main() { render Col() {
      Row() { #a accessible label "A name" Text("A") Text("B") }
      Row() { Text("C") Text("D") }
    } }`)
      const patch = await SourceActions.applyStudioPatch(document, {
        kind: 'move-render',
        draggedId: renderId(textRender(document, 'A')),
        beforeId: renderId(textRender(document, 'D')),
        afterId: renderId(textRender(document, 'C')),
      })
      const updated = await updatedDocument(patch.content)
      const moved = textRender(updated, 'A')
      Expect(moved.$container === textRender(updated, 'C').$container).toBe(true)
      Expect(labels(moved)).toEqual(['"A name"'])
      Expect(AST.attachedTag(moved)?.tag).toBe('#a')
      Expect(labels(textRender(updated, 'B'))).toEqual([])
    },
  )

  Test('wraps labelled children and roots with metadata still on the original native occurrence', async () => {
    for (const root of [false, true]) {
      for (
        const prefix of ['accessible label "A name"', '#a accessible label "A name"', 'accessible label "A name" #a']
      ) {
        const body = root ? `${prefix}\nrender Text("A")` : `render Col() { ${prefix} Text("A") Text("B") }`
        const document = await parseDocument(`use Col, Text from @tao/ui view Main() { ${body} }`)
        const patch = await SourceActions.applyStudioPatch(document, {
          kind: 'wrap-render',
          renderId: renderId(textRender(document, 'A')),
          wrapper: 'Stack',
        })
        const updated = await updatedDocument(patch.content)
        const child = textRender(updated, 'A')
        Expect(labels(child)).toEqual(['"A name"'])
        Expect(AST.isViewRender(child)).toBe(true)
        const wrappers = AST.streamAllContents(updated.parseResult.value)
          .filter(AST.isRender).filter(render => render.view?.$refText === 'Stack')
        Expect(wrappers).toHaveLength(1)
        Expect(AST.renderPrefixCluster(wrappers[0]!)).toEqual([])
      }
    }
  })

  Test('groups public tagged and labelled siblings with each cluster inside the new wrapper', async () => {
    const document = await parseDocument(`use Col, Text from @tao/ui view Main() { render Col() {
      #a accessible label "A name" Text("A")
      accessible label "B name" #b Text("B")
      Text("C")
    } }`)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'group-renders',
      wrapper: 'Row',
      renderIds: [renderId(textRender(document, 'B')), renderId(textRender(document, 'A'))],
    })
    const updated = await updatedDocument(patch.content)
    Expect(labels(textRender(updated, 'A'))).toEqual(['"A name"'])
    Expect(labels(textRender(updated, 'B'))).toEqual(['"B name"'])
    Expect(AST.attachedTag(textRender(updated, 'A'))?.tag).toBe('#a')
    Expect(AST.attachedTag(textRender(updated, 'B'))?.tag).toBe('#b')
    Expect(textRender(updated, 'A').$container === textRender(updated, 'B').$container).toBe(true)
    Expect(labels(textRender(updated, 'C'))).toEqual([])
    const wrapper = AST.streamAllContents(updated.parseResult.value)
      .find(node => AST.isRender(node) && node.view?.$refText === 'Row') as AST.Render
    Expect(wrapper).toBeDefined()
    Expect(AST.renderPrefixCluster(wrapper)).toEqual([])
  })

  Test('extracts a labelled public-tagged leaf and captures a parameter used only by its label', async () => {
    const document = await parseDocument(`use Col, Text from @tao/ui
      type Caption is text
      view Main(Caption) { render Col() { #a accessible label (Caption) Text("A") Text("B") } }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'Leaf',
      renderIds: [renderId(textRender(document, 'A'))],
    })
    const updated = await updatedDocument(patch.content)
    const leaf = textRender(updated, 'A')
    Expect(AST.findOwningView(leaf)?.name).toBe('Leaf')
    Expect(AST.isRenderStatement(leaf)).toBe(true)
    Expect(labels(leaf)).toEqual(['(Caption)'])
    Expect(AST.attachedTag(leaf)?.tag).toBe('#a')
    Expect(patch.content).toContain('view Leaf(Caption)')
    Expect(patch.content).toContain('Leaf(Caption: Caption)')
    Expect(labels(textRender(updated, 'B'))).toEqual([])
    Expect(Diagnostics.errorMessages((await Validator.validateCode(patch.content)).diagnostics)).toEqual([])
  })

  Test('extracts adjacent labels and captures label-only aliases in first-read order', async () => {
    const document = await parseDocument(`use Col, Text from @tao/ui
      type Caption is text with {
        static func +(Left Caption, Right text) fails never -> text { return "{Left}{Right}" }
      }
      view Main(Caption) {
        let Alias = Caption
        render Col() {
          accessible label (Caption) Text("A")
          accessible label (Alias + " second") Text("B")
          Text("C")
        }
      }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'Summary',
      renderIds: [renderId(textRender(document, 'B')), renderId(textRender(document, 'A'))],
    })
    const updated = await updatedDocument(patch.content)
    Expect(patch.content).toContain('Summary(Caption: Caption, Alias: Alias)')
    Expect(patch.content).toContain('view Summary(Caption, Alias Caption)')
    Expect(labels(textRender(updated, 'A'))).toEqual(['(Caption)'])
    Expect(labels(textRender(updated, 'B'))).toEqual(['(Alias + " second")'])
    Expect(AST.findOwningView(textRender(updated, 'A'))?.name).toBe('Summary')
    Expect(labels(textRender(updated, 'C'))).toEqual([])
    Expect(Diagnostics.errorMessages((await Validator.validateCode(patch.content)).diagnostics)).toEqual([])
  })

  Test('rejects label-only state dependencies instead of moving their owner', async () => {
    const document = await parseDocument(`use Col, Text from @tao/ui
      view Main() { state Caption = "A name" render Col() { accessible label (Caption) Text("A") Text("B") } }
    `)
    await Expect(SourceActions.applyStudioPatch(document, {
      kind: 'extract-view',
      name: 'Leaf',
      renderIds: [renderId(textRender(document, 'A'))],
    })).rejects.toThrow('queries, state, actions and commands stay in the view')
  })

  Test('retains Snap protection even when an accessibility prefix intervenes', async () => {
    const document = await parseDocument(`use Col, Text from @tao/ui view Main() { render Col() {
      #studio_rect_00720031 accessible label "A name" Text("A") Text("B")
    } }`)
    const id = renderId(textRender(document, 'A'))
    await Expect(SourceActions.applyStudioPatch(document, { kind: 'remove-render', renderId: id }))
      .rejects.toThrow('Unsnap the sketch first')
    await Expect(SourceActions.applyStudioPatch(document, { kind: 'extract-view', name: 'Leaf', renderIds: [id] }))
      .rejects.toThrow('Unsnap the sketch first')
  })

  Test('refuses extraction and grouping of containers with a snapped descendant', async () => {
    const document = await parseDocument(`use Col, Row, Text from @tao/ui view Main() { render Col() {
      accessible label "Container" Row() { accessible label "A name" #studio_rect_00720031 Text("A") }
      Text("B")
    } }`)
    const container = AST.streamAllContents(document.parseResult.value)
      .find((node): node is AST.ViewRender => AST.isViewRender(node) && node.view?.$refText === 'Row')
    Expect.Is(container, AST.isViewRender)
    Assert.defined(container.view, 'the snapped descendant fixture has a named container reference')
    Expect(container.view.$refText).toBe('Row')
    const renderIds = [renderId(container), renderId(textRender(document, 'B'))]
    await Expect(SourceActions.applyStudioPatch(document, { kind: 'extract-view', name: 'Pair', renderIds }))
      .rejects.toThrow('Unsnap the sketch first')
    await Expect(SourceActions.applyStudioPatch(document, { kind: 'group-renders', wrapper: 'Stack', renderIds }))
      .rejects.toThrow('Unsnap the sketch first')
  })

  Test('inserts into a gap before a labelled occurrence without splitting its cluster', async () => {
    const document = await parseDocument(`use Col, Text from @tao/ui view Main() { render Col() {
      Text("B") accessible label "A name" #a Text("A")
    } }`)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'insert-component',
      component: 'Number',
      beforeId: renderId(textRender(document, 'A')),
    })
    const updated = await updatedDocument(patch.content)
    const inserted = AST.streamAllContents(updated.parseResult.value)
      .find((node): node is AST.Render => AST.isRender(node) && node.view?.$refText === 'Number')!
    Expect(inserted).toBeDefined()
    Expect(AST.renderPrefixCluster(inserted)).toEqual([])
    Expect(labels(textRender(updated, 'A'))).toEqual(['"A name"'])
    Expect(AST.attachedTag(textRender(updated, 'A'))?.tag).toBe('#a')
    Expect(patch.content.indexOf('Number(0)')).toBeLessThan(patch.content.indexOf('#a'))
  })

  Test('preserves a foreign slot fill when removing a labelled content sibling', async () => {
    const document = await parseDocument(`use Text from @tao/ui
      view Host() accepts content slots @toolbar from ./Host.tsx
      view Main() { render Host() {
        @toolbar: Text("Tools")
        #a accessible label "A name" Text("A")
        Text("B")
      } }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'remove-render',
      renderId: renderId(textRender(document, 'A')),
    })
    const updated = await updatedDocument(patch.content)
    Expect(patch.content).toContain('@toolbar: Text("Tools")')
    Expect(textRender(updated, 'Tools')).toBeDefined()
    Expect(labels(textRender(updated, 'Tools'))).toEqual([])
    Expect(labels(textRender(updated, 'B'))).toEqual([])
    Expect(patch.content).not.toContain('A name')
    Expect(patch.content).not.toContain('#a')
  })

  Test('keeps a loop tag and its labelled children attached while moving a neighbouring render', async () => {
    const document = await parseDocument(`use Col, Text from @tao/ui
      data Items / Item { Name text }
      view Main() { query Items = Items render Col() {
        Text("A")
        #items loop Items / Item { accessible label "Item name" Text("Item") }
        Text("B")
      } }
    `)
    const patch = await SourceActions.applyStudioPatch(document, {
      kind: 'move-render',
      draggedId: renderId(textRender(document, 'A')),
      afterId: renderId(textRender(document, 'B')),
    })
    const updated = await updatedDocument(patch.content)
    const loop = AST.streamAllContents(updated.parseResult.value).find(AST.isForStatement)!
    Expect(loop).toBeDefined()
    Expect(AST.renderPrefixCluster(loop).filter(AST.isTagStatement).map(tag => tag.tag)).toEqual(['#items'])
    Expect(labels(textRender(updated, 'Item'))).toEqual(['"Item name"'])
    Expect(labels(textRender(updated, 'A'))).toEqual([])
    Expect(patch.content.indexOf('Text("B")')).toBeLessThan(patch.content.indexOf('Text("A")'))
  })

  Test('wraps and extracts a labelled quoted child without changing its visible text', async () => {
    for (const kind of ['wrap-render', 'extract-view'] as const) {
      const document = await parseDocument(`use Col, Text from @tao/ui view Main() {
        render Col() { accessible label "Spoken" "Visible" Text("B") }
      }`)
      const quote = AST.streamAllContents(document.parseResult.value).find(AST.isQuotedRender)!
      const patch = await SourceActions.applyStudioPatch(
        document,
        kind === 'wrap-render'
          ? { kind, renderId: renderId(quote), wrapper: 'Stack' }
          : { kind, renderIds: [renderId(quote)], name: 'Quoted' },
      )
      const updated = await updatedDocument(patch.content)
      const child = AST.streamAllContents(updated.parseResult.value).find(AST.isQuotedRender)!
      Expect(child).toBeDefined()
      Expect(child.argumentList!.arguments[0]!.value.$cstNode!.text).toBe('"Visible"')
      Expect(labels(child)).toEqual(['"Spoken"'])
      Expect(labels(textRender(updated, 'B'))).toEqual([])
      if (kind === 'extract-view') {
        Expect(AST.findOwningView(child)?.name).toBe('Quoted')
      }
    }
  })
})

import { EditorState, RangeSet } from '@codemirror/state'
import { type Decoration, EditorView } from '@codemirror/view'
import { Assert } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { CodeEditorLens, type CodeEditorLensNode } from '../code-editor-src/CodeEditorLens'

const doc = [
  'view Main() {',
  '   state Open = true',
  '   render Col() [gap] {',
  '      Text("Hi") [title] // note',
  '      Button("Go") {',
  '         on press -> { set Open = false }',
  '      }',
  '      Col() [hero] {',
  '         Text("A")',
  '         Text("B")',
  '      }',
  '   }',
  '}',
  '',
].join('\n')

const facets = [
  { glyph: '▢', label: 'Structure', name: 'structure' },
  { glyph: '▦', label: 'Layout', name: 'layout' },
  { glyph: '➜', label: 'Behavior', name: 'behavior' },
  { glyph: '▤', label: 'Data', name: 'data' },
  { glyph: '¶', label: 'Comments', name: 'comments' },
]

function at(text: string, occurrence = 0): number {
  let index = -1
  for (let count = 0; count <= occurrence; count++) {
    index = doc.indexOf(text, index + 1)
  }
  Assert(index >= 0, `Test document lacks ${JSON.stringify(text)}`)
  return index
}

function span(start: string, end: string, startOccurrence = 0): { from: number; to: number } {
  const from = at(start, startOccurrence)
  return { from, to: doc.indexOf(end, from) + end.length }
}

function node(
  kind: string,
  facet: string,
  collapse: 'head' | 'vanish',
  range: { from: number; to: number },
  body?: { from: number; to: number },
  children: CodeEditorLensNode[] = [],
): CodeEditorLensNode {
  return { ...(body === undefined ? {} : { body }), children, collapse, facet, from: range.from, kind, to: range.to }
}

const layoutGap = node('layout', 'layout', 'head', span('[gap]', ']'), { from: at('[gap]') + 1, to: at('[gap]') + 4 })
const layoutTitle = node('layout', 'layout', 'head', span('[title]', ']'), {
  from: at('[title]') + 1,
  to: at('[title]') + 6,
})
const layoutHero = node('layout', 'layout', 'head', span('[hero]', ']'), {
  from: at('[hero]') + 1,
  to: at('[hero]') + 5,
})
const handlerRange = span('on press', '}')
const handler = node('handler', 'behavior', 'head', handlerRange, { from: at('-> {'), to: handlerRange.to })
const button = node('render', 'structure', 'vanish', span('Button("Go")', '      }'), undefined, [handler])
const textHi = node('render', 'structure', 'vanish', span('Text("Hi")', '[title]'), undefined, [layoutTitle])
const note = node('comment', 'comments', 'vanish', span('// note', 'note'))
const hero = node('render', 'structure', 'vanish', span('Col() [hero]', '      }'), undefined, [
  layoutHero,
  node('render', 'structure', 'vanish', span('Text("A")', ')')),
  node('render', 'structure', 'vanish', span('Text("B")', ')')),
])
const renderRange = span('render Col()', '\n   }')
const render = node('render', 'structure', 'vanish', renderRange, undefined, [layoutGap, textHi, note, button, hero])
const state = node('state', 'data', 'vanish', span('state Open', 'true'))
const viewRange = { from: 0, to: doc.lastIndexOf('}') + 1 }
const view = node('view', 'structure', 'head', viewRange, { from: at('{'), to: viewRange.to }, [state, render])
const map = { complete: true, nodes: [view] }

type Replaced = { block: boolean; from: number; text: string; to: number; widget: boolean }

function replaced(state: EditorState): Replaced[] {
  const found: Replaced[] = []
  for (const set of state.facet(EditorView.decorations)) {
    if (!(set instanceof RangeSet)) {
      continue
    }
    set.between(0, state.doc.length, (from, to, value) => {
      const decoration = value as Decoration
      found.push({
        block: decoration.spec['block'] === true,
        from,
        text: state.doc.sliceString(from, to),
        to,
        widget: decoration.spec['widget'] !== undefined,
      })
    })
  }
  return found.sort((left, right) => left.from - right.from)
}

function lensState(active: readonly string[], document = doc): EditorState {
  const initial = EditorState.create({ doc: document, extensions: CodeEditorLens.extension })
  return initial.update({
    effects: [
      CodeEditorLens.effects.setConfig.of({ active, facets }),
      CodeEditorLens.effects.setMap.of(map),
    ],
  }).state
}

function hiddenTexts(state: EditorState): string[] {
  return CodeEditorLens.spans(state).map(span => state.doc.sliceString(span.from, span.to))
}

Describe('code editor syntax lens', () => {
  Test('shows nothing hidden while every facet is on, and nothing before any facet is known', () => {
    Expect(hiddenTexts(lensState(facets.map(facet => facet.name)))).toEqual([])
    const unconfigured = EditorState.create({ doc, extensions: CodeEditorLens.extension })
      .update({ effects: CodeEditorLens.effects.setMap.of(map) }).state
    Expect(hiddenTexts(unconfigured)).toEqual([])
  })

  Test('composing keeps the render tree and glyphs layout, handlers, and vanishes data', () => {
    const state = lensState(['structure'])

    Expect(hiddenTexts(state)).toEqual([
      'state Open = true',
      'gap',
      'title',
      '// note',
      '-> { set Open = false }',
      'hero',
    ])
    const decorations = replaced(state)
    // The one-line state declaration folds silently onto the end of the view head.
    Expect(decorations[0]).toEqual({
      block: false,
      from: at('{') + 1,
      text: '\n   state Open = true',
      to: at('true') + 4,
      widget: false,
    })
    // A hidden trailing comment leaves the line, and the line, in place.
    Expect(decorations.find(item => item.text === '// note')).toEqual({
      block: false,
      from: at('// note'),
      text: '// note',
      to: at('// note') + 7,
      widget: false,
    })
    Expect(decorations.find(item => item.text === '-> { set Open = false }')?.widget).toBe(true)
  })

  Test('tracing keeps only the path down to each handler and marks a hidden subtree with a run widget', () => {
    const state = lensState(['behavior', 'data'])

    Expect(hiddenTexts(state)).toEqual([
      'gap',
      'Text("Hi") [title]',
      '// note',
      doc.slice(hero.from, hero.to),
    ])
    const run = replaced(state).find(item => item.block)
    Expect(run).toBeDefined()
    Expect(run?.widget).toBe(true)
    Expect(state.doc.lineAt(run!.from).text).toBe('      Col() [hero] {')
    Expect(state.doc.lineAt(run!.to).number).toBe(state.doc.lineAt(run!.from).number + 3)
    Expect(run!.to).toBe(state.doc.lineAt(run!.to).to)
    // The one-liner render and its comment on the same line vanish silently, folded onto the line before.
    Expect(replaced(state).some(item => item.text === '\n      Text("Hi") [title] // note' && !item.widget)).toBe(true)
  })

  Test('outlining collapses a declaration to its head with one glyph', () => {
    const state = lensState([])

    Expect(hiddenTexts(state)).toEqual([doc.slice(at('{'), viewRange.to)])
    const decorations = replaced(state)
    Expect(decorations).toHaveLength(1)
    Expect(decorations[0]?.widget).toBe(true)
    Expect(decorations[0]?.block).toBe(false)
  })

  Test('peeking reveals a whole subtree until the lens changes or re-folds', () => {
    const outline = lensState([])
    const peeked = outline.update({ effects: CodeEditorLens.effects.peek.of([view.from]) }).state

    Expect(hiddenTexts(peeked)).toEqual([])
    Expect(CodeEditorLens.peeks(peeked)).toEqual([0])
    Expect(hiddenTexts(peeked.update({ effects: CodeEditorLens.effects.refold.of(null) }).state)).toHaveLength(1)
    Expect(
      hiddenTexts(
        peeked.update({ effects: CodeEditorLens.effects.setConfig.of({ active: ['structure'], facets }) }).state,
      ),
    ).toHaveLength(6)
  })

  Test('a selection landing inside hidden text peeks that region open', () => {
    const composing = lensState(['structure'])
    const inside = at('set Open = false') + 4
    const moved = composing.update({ selection: { anchor: inside } }).state

    Expect(CodeEditorLens.peeks(moved)).toEqual([handler.from])
    Expect(hiddenTexts(moved)).toEqual(['state Open = true', 'gap', 'title', '// note', 'hero'])
  })

  Test('maps its nodes through edits until the next classification arrives', () => {
    const composing = lensState(['structure'])
    const edited = composing.update({ changes: { from: 0, insert: '// top\n' } }).state

    Expect(hiddenTexts(edited)).toEqual([
      'state Open = true',
      'gap',
      'title',
      '// note',
      '-> { set Open = false }',
      'hero',
    ])
    Expect(CodeEditorLens.spans(edited)[1]?.from).toBe(layoutGap.body!.from + 7)
  })

  Test('drops its projection when the whole document is replaced and ignores an incomplete map', () => {
    const composing = lensState(['structure'])
    const replacedDocument =
      composing.update({ changes: { from: 0, insert: 'view Other() { }', to: doc.length } }).state
    Expect(hiddenTexts(replacedDocument)).toEqual([])

    const incomplete = composing.update({ effects: CodeEditorLens.effects.setMap.of({ complete: false, nodes: [] }) })
      .state
    Expect(hiddenTexts(incomplete)).toHaveLength(6)
  })

  Test('merges hidden runs separated only by blank lines', () => {
    const spaced = doc.replace('      }\n      Col() [hero]', '      }\n\n      Col() [hero]')
    const shift = (position: number): number => position > at('      }\n      Col()') + 7 ? position + 1 : position
    const remap = (item: CodeEditorLensNode): CodeEditorLensNode => ({
      ...item,
      ...(item.body === undefined ? {} : { body: { from: shift(item.body.from), to: shift(item.body.to) } }),
      children: item.children.map(remap),
      from: shift(item.from),
      to: shift(item.to),
    })
    const initial = EditorState.create({ doc: spaced, extensions: CodeEditorLens.extension })
    const state = initial.update({
      effects: [
        CodeEditorLens.effects.setConfig.of({ active: ['data'], facets }),
        CodeEditorLens.effects.setMap.of({ complete: true, nodes: [remap(view)] }),
      ],
    }).state

    const blocks = replaced(state).filter(item => item.block)
    Expect(blocks).toHaveLength(1)
    Expect(state.doc.lineAt(blocks[0]!.from).text).toBe('   render Col() [gap] {')
    Expect(state.doc.lineAt(blocks[0]!.to).text).toBe('   }')
  })
})

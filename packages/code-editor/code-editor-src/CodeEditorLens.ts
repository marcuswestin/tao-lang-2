import {
  type ChangeDesc,
  EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Text,
  type Transaction,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'

/**
 * A syntax lens hides Tao syntax by meaning rather than by line. The host classifies the document
 * into facet-tagged nodes; the editor keeps the facets the person has switched on, keeps the path
 * down to anything shown, and collapses the rest. A collapsed node either keeps its head and turns
 * its body into a glyph, or vanishes. Whatever vanishes across whole lines leaves one faint run
 * marker when it was more than a line, and nothing at all when it was not.
 */

export type CodeEditorLensRange = Readonly<{ from: number; to: number }>

export type CodeEditorLensNode = Readonly<{
  body?: CodeEditorLensRange
  children: readonly CodeEditorLensNode[]
  collapse: 'head' | 'vanish'
  facet: string
  from: number
  kind: string
  to: number
}>

export type CodeEditorLensMap = Readonly<{
  complete: boolean
  nodes: readonly CodeEditorLensNode[]
}>

export type CodeEditorLensFacet = Readonly<{
  glyph: string
  label: string
  name: string
}>

export type CodeEditorLensConfig = Readonly<{
  active: readonly string[]
  facets: readonly CodeEditorLensFacet[]
}>

/** CodeEditorLensSpan is one collapsed region: a glyphed body or a vanished subtree. */
export type CodeEditorLensSpan = Readonly<{
  from: number
  glyph: boolean
  node: CodeEditorLensNode
  to: number
}>

type CodeEditorLensState = Readonly<{
  config: CodeEditorLensConfig
  decorations: DecorationSet
  nodes: readonly CodeEditorLensNode[]
  peeks: readonly number[]
  spans: readonly CodeEditorLensSpan[]
}>

const setLensMap = StateEffect.define<CodeEditorLensMap>()
const setLensConfig = StateEffect.define<CodeEditorLensConfig>()
const peekLens = StateEffect.define<readonly number[]>()
const refoldLens = StateEffect.define<null>()
const externalEditLens = StateEffect.define<null>()

const runGlyph = '⋯'
const summaryLength = 80

const emptyState: CodeEditorLensState = {
  config: { active: [], facets: [] },
  decorations: Decoration.none,
  nodes: [],
  peeks: [],
  spans: [],
}

const lensField = StateField.define<CodeEditorLensState>({
  create() {
    return emptyState
  },
  provide: field => [
    EditorView.decorations.from(field, state => state.decorations),
    EditorView.atomicRanges.of(view => view.state.field(field).decorations),
  ],
  update(state, transaction) {
    let next = state
    let rebuild = false
    if (transaction.docChanged) {
      next = replacesWholeDocument(transaction)
        ? { ...next, nodes: [], peeks: [] }
        : {
          ...next,
          nodes: next.nodes.map(node => mapNode(node, transaction.changes)),
          peeks: next.peeks.map(position => transaction.changes.mapPos(position, 1)),
        }
      rebuild = true
    }
    for (const effect of transaction.effects) {
      if (effect.is(setLensMap)) {
        // A parse that recovered from errors misplaces structure; the last good map, mapped through
        // the edits since, is a better picture until the file parses again.
        if (effect.value.complete) {
          next = { ...next, nodes: effect.value.nodes }
          rebuild = true
        }
      } else if (effect.is(setLensConfig)) {
        next = { ...next, config: effect.value, peeks: [] }
        rebuild = true
      } else if (effect.is(peekLens)) {
        next = { ...next, peeks: [...new Set([...next.peeks, ...effect.value])] }
        rebuild = true
      } else if (effect.is(refoldLens)) {
        next = { ...next, peeks: [] }
        rebuild = true
      }
    }
    if (rebuild) {
      next = build(next, transaction.state)
    }
    if (transaction.selection !== undefined) {
      // The caret is never left inside hidden text: navigation from a preview, a diagnostic, or a
      // search peeks the region open instead. Re-folding and changing lenses deliberately do not
      // inspect the existing caret: otherwise the region under it immediately opens again.
      const selection = transaction.state.selection.main
      const hit = next.spans.find(span => selectionTouchesSpan(selection.from, selection.to, span))
      if (hit !== undefined) {
        next = build({ ...next, peeks: [...next.peeks, hit.node.from] }, transaction.state)
      }
    }
    return next
  },
})

const protectHiddenSyntax = EditorState.transactionFilter.of(transaction => {
  if (!transaction.docChanged || transaction.effects.some(effect => effect.is(externalEditLens))) {
    return transaction
  }
  const spans = transaction.startState.field(lensField, false)?.spans ?? []
  const peeks = new Set<number>()
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (fromA === toA) {
      return
    }
    for (const span of spans) {
      if (fromA < span.to && toA > span.from) {
        peeks.add(span.node.from)
      }
    }
  })
  if (peeks.size === 0) {
    return transaction
  }
  // CodeMirror expands Backspace/Delete across atomic replacement decorations. Cancelling that
  // first deletion and revealing the source makes the next edit operate on syntax the person can see.
  return {
    effects: peekLens.of([...peeks]),
    selection: transaction.startState.selection,
  }
})

const lensTheme = EditorView.baseTheme({
  '.cm-lens-glyph': {
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'inline-block',
    fontSize: '85%',
    lineHeight: '1.3',
    margin: '0 0.1em',
    padding: '0 0.4em',
    userSelect: 'none',
    verticalAlign: 'baseline',
  },
  '&light .cm-lens-glyph': { backgroundColor: 'rgba(0, 0, 0, 0.08)', color: '#3b4a3f' },
  '&dark .cm-lens-glyph': { backgroundColor: 'rgba(255, 255, 255, 0.12)', color: '#b8c4bb' },
  '.cm-lens-glyph:hover': { backgroundColor: 'rgba(120, 180, 140, 0.35)' },
  '.cm-lens-glyph:focus-visible, .cm-lens-run:focus-visible': {
    outline: '2px solid currentColor',
    outlineOffset: '2px',
  },
  '.cm-lens-run': {
    cursor: 'pointer',
    fontSize: '85%',
    letterSpacing: '0.1em',
    opacity: '0.65',
    padding: '0 1em',
    userSelect: 'none',
  },
  '.cm-lens-run:hover': { opacity: '1' },
})

/** CodeEditorLens exposes the extension, its effects, and the pure pieces tests exercise directly. */
export const CodeEditorLens = {
  extension: [lensField, protectHiddenSyntax, lensTheme] as Extension,
  effects: {
    externalEdit: externalEditLens,
    peek: peekLens,
    refold: refoldLens,
    setConfig: setLensConfig,
    setMap: setLensMap,
  },
  /** spans returns the regions the lens currently collapses in `state`. */
  spans(state: EditorState): readonly CodeEditorLensSpan[] {
    return state.field(lensField, false)?.spans ?? []
  },
  /** peeks returns the node starts the person has revealed since the lens last changed. */
  peeks(state: EditorState): readonly number[] {
    return state.field(lensField, false)?.peeks ?? []
  },
  testing: {
    decorations: lensDecorations,
    project: projectLens,
  },
} as const

function build(state: CodeEditorLensState, editorState: EditorState): CodeEditorLensState {
  // A lens that was never configured knows no facets and therefore hides nothing.
  if (state.config.facets.length === 0) {
    return { ...state, decorations: Decoration.none, spans: [] }
  }
  const spans = projectLens(state.nodes, new Set(state.config.active), new Set(state.peeks))
  const glyphs = new Map(state.config.facets.map(facet => [facet.name, facet.glyph]))
  return { ...state, decorations: lensDecorations(spans, editorState.doc, glyphs), spans }
}

/**
 * projectLens decides what collapses. A node is shown when its facet is on, when it is peeked, or
 * when something shown lives inside it; a shown node contributes only its hidden children. A hidden
 * head-collapsing node glyphs its body; a hidden vanishing node disappears whole. A peek reveals
 * the entire subtree, because the person asked to see inside.
 */
function projectLens(
  nodes: readonly CodeEditorLensNode[],
  active: ReadonlySet<string>,
  peeks: ReadonlySet<number>,
): CodeEditorLensSpan[] {
  const spans: CodeEditorLensSpan[] = []
  const visit = (node: CodeEditorLensNode): boolean => {
    if (peeks.has(node.from)) {
      return true
    }
    const own = active.has(node.facet)
    const before = spans.length
    let childShown = false
    for (const child of node.children) {
      childShown = visit(child) || childShown
    }
    if (own || childShown) {
      return true
    }
    spans.length = before
    if (node.collapse === 'vanish') {
      spans.push({ from: node.from, glyph: false, node, to: node.to })
    } else if (node.body !== undefined && node.body.to > node.body.from) {
      spans.push({ from: node.body.from, glyph: true, node, to: node.body.to })
    }
    return false
  }
  for (const node of nodes) {
    visit(node)
  }
  return spans.sort((left, right) => left.from - right.from || right.to - left.to)
}

type LineCover = { intervals: CodeEditorLensRange[]; nodes: Set<CodeEditorLensNode> }

/**
 * lensDecorations turns spans into CodeMirror decorations. Glyphed bodies collapse inline onto their
 * head line. Vanished text hides inline where a line keeps other content, and whole lines disappear
 * in runs: a run that swallowed anything longer than a line leaves a marker to peek, a run of
 * one-liners leaves nothing.
 */
function lensDecorations(
  spans: readonly CodeEditorLensSpan[],
  doc: Text,
  glyphs: ReadonlyMap<string, string>,
): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const covers = new Map<number, LineCover>()
  for (const span of spans) {
    if (span.glyph) {
      const glyph = glyphs.get(span.node.facet) ?? runGlyph
      const widget = new LensGlyphWidget(
        glyph,
        span.node.facet,
        summarize(doc.sliceString(span.from, span.to)),
        span.node.from,
      )
      ranges.push(Decoration.replace({ widget }).range(span.from, span.to))
      continue
    }
    let line = doc.lineAt(span.from)
    while (true) {
      const cover = covers.get(line.number) ?? { intervals: [], nodes: new Set() }
      cover.intervals.push({ from: Math.max(span.from, line.from), to: Math.min(span.to, line.to) })
      cover.nodes.add(span.node)
      covers.set(line.number, cover)
      if (line.to >= span.to || line.number >= doc.lines) {
        break
      }
      line = doc.line(line.number + 1)
    }
  }
  const hiddenLines = new Set<number>()
  for (const [number, cover] of covers) {
    const line = doc.line(number)
    if (fullyCovered(line.text, line.from, cover.intervals)) {
      hiddenLines.add(number)
    } else {
      for (const interval of cover.intervals) {
        if (interval.to > interval.from) {
          ranges.push(Decoration.replace({}).range(interval.from, interval.to))
        }
      }
    }
  }
  for (const run of lineRuns(doc, hiddenLines)) {
    const nodes = new Set<CodeEditorLensNode>()
    for (let number = run.first; number <= run.last; number++) {
      for (const node of covers.get(number)?.nodes ?? []) {
        nodes.add(node)
      }
    }
    const first = doc.line(run.first)
    const last = doc.line(run.last)
    const multiline = [...nodes].some(node => doc.lineAt(node.to).number > doc.lineAt(node.from).number)
    if (multiline) {
      const facets = [...new Set([...nodes].map(node => glyphs.get(node.facet) ?? ''))].filter(glyph => glyph !== '')
      const widget = new LensRunWidget(run.last - run.first + 1, facets, [...nodes].map(node => node.from))
      ranges.push(Decoration.replace({ block: true, widget }).range(first.from, last.to))
    } else if (run.first > 1) {
      ranges.push(Decoration.replace({}).range(doc.line(run.first - 1).to, last.to))
    } else if (run.last < doc.lines) {
      ranges.push(Decoration.replace({}).range(first.from, doc.line(run.last + 1).from))
    } else if (doc.length > 0) {
      ranges.push(Decoration.replace({}).range(0, doc.length))
    }
  }
  return Decoration.set(ranges, true)
}

function fullyCovered(text: string, lineFrom: number, intervals: readonly CodeEditorLensRange[]): boolean {
  for (let index = 0; index < text.length; index++) {
    if (/\s/.test(text[index]!)) {
      continue
    }
    const position = lineFrom + index
    if (!intervals.some(interval => interval.from <= position && position < interval.to)) {
      return false
    }
  }
  return true
}

/**
 * lineRuns groups hidden lines into maximal runs. Blank lines between two runs join them, and a
 * blank line right after a run is absorbed when the run already followed a blank line or opened the
 * document, so hiding never doubles the whitespace that separated what is left.
 */
function lineRuns(doc: Text, hiddenLines: ReadonlySet<number>): { first: number; last: number }[] {
  const blank = (number: number): boolean => number >= 1 && number <= doc.lines && doc.line(number).text.trim() === ''
  const hidden = (number: number): boolean => hiddenLines.has(number)
  const runs: { first: number; last: number }[] = []
  const sorted = [...hiddenLines].sort((left, right) => left - right)
  for (const number of sorted) {
    const current = runs[runs.length - 1]
    if (current !== undefined && number <= current.last) {
      continue
    }
    if (current !== undefined && onlyBlankBetween(current.last, number)) {
      current.last = number
    } else {
      runs.push({ first: number, last: number })
    }
  }
  for (const run of runs) {
    if (blank(run.last + 1) && !hidden(run.last + 1) && (run.first === 1 || blank(run.first - 1))) {
      run.last += 1
    }
  }
  return runs

  function onlyBlankBetween(last: number, next: number): boolean {
    for (let number = last + 1; number < next; number++) {
      if (!blank(number)) {
        return false
      }
    }
    return true
  }
}

function summarize(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > summaryLength ? `${collapsed.slice(0, summaryLength - 1)}…` : collapsed
}

function mapNode(node: CodeEditorLensNode, changes: ChangeDesc): CodeEditorLensNode {
  return {
    ...node,
    ...(node.body === undefined
      ? {}
      : { body: { from: changes.mapPos(node.body.from, 1), to: changes.mapPos(node.body.to, -1) } }),
    children: node.children.map(child => mapNode(child, changes)),
    from: changes.mapPos(node.from, 1),
    to: changes.mapPos(node.to, -1),
  }
}

function replacesWholeDocument(transaction: Transaction): boolean {
  let whole = false
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (fromA === 0 && toA === transaction.startState.doc.length) {
      whole = true
    }
  })
  return whole
}

class LensGlyphWidget extends WidgetType {
  constructor(
    readonly glyph: string,
    readonly facet: string,
    readonly summary: string,
    readonly key: number,
  ) {
    super()
  }

  override eq(other: LensGlyphWidget): boolean {
    return other.glyph === this.glyph && other.facet === this.facet && other.summary === this.summary
      && other.key === this.key
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('span')
    element.setAttribute('aria-label', `Reveal hidden ${this.facet} syntax`)
    element.setAttribute('role', 'button')
    element.tabIndex = 0
    element.className = 'cm-lens-glyph'
    element.dataset['facet'] = this.facet
    element.dataset['lensPeek'] = String(this.key)
    element.textContent = this.glyph
    element.title = this.summary
    element.addEventListener('mousedown', event => {
      event.preventDefault()
      view.dispatch({ effects: peekLens.of([this.key]) })
    })
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        view.dispatch({ effects: peekLens.of([this.key]) })
      }
    })
    return element
  }
}

class LensRunWidget extends WidgetType {
  constructor(
    readonly lines: number,
    readonly facets: readonly string[],
    readonly keys: readonly number[],
  ) {
    super()
  }

  override eq(other: LensRunWidget): boolean {
    return other.lines === this.lines && other.facets.join() === this.facets.join()
      && other.keys.join() === this.keys.join()
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('div')
    element.setAttribute('aria-label', `Reveal ${this.lines} hidden ${this.lines === 1 ? 'line' : 'lines'}`)
    element.setAttribute('role', 'button')
    element.tabIndex = 0
    element.className = 'cm-lens-run'
    element.dataset['lensPeek'] = this.keys.join(',')
    element.textContent = `${runGlyph} ${this.facets.join(' ')}`.trimEnd()
    element.title = `${this.lines} hidden ${this.lines === 1 ? 'line' : 'lines'}`
    element.addEventListener('mousedown', event => {
      event.preventDefault()
      view.dispatch({ effects: peekLens.of(this.keys) })
    })
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        view.dispatch({ effects: peekLens.of(this.keys) })
      }
    })
    return element
  }
}

function selectionTouchesSpan(from: number, to: number, span: CodeEditorLensSpan): boolean {
  return from === to ? span.from <= from && from < span.to : from < span.to && to > span.from
}

import { AST } from '@parser'
import type { FormatHandlers, NodeFormat } from '../formatting'

export const ViewsFormatter = {
  TagStatement() {},

  /** RenderAccessibilityStatement keeps the label expression's authored grouping intact. */
  RenderAccessibilityStatement(f) {
    f.oneSpaceAfter('accessible', 'a11y', 'label')
  },

  ViewCommandExclusion(f) {
    f.oneSpaceAfter('hide')
    f.commaSpacedList()
  },
  /** ViewDeclaration formats a `view Name parameters` header with its optional responds clause. */
  ViewDeclaration: ViewDeclaration,

  /** AssociatedViewDeclaration keeps the receiver-qualified name and ordinary view header spacing. */
  AssociatedViewDeclaration(f) {
    f.oneSpaceAfter('view')
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
    f.noSpaceBefore('(')
    f.oneSpaceBeforeProperty('layoutClause')
  },

  /** ForeignViewImplementation formats its declared capabilities before the sidecar boundary. */
  ForeignViewImplementation(f) {
    f.oneSpaceAfter('accepts')
    f.oneSpaceBefore('slots', 'from')
    f.oneSpaceAfter('slots', 'from')
    f.commaSpacedList()
  },

  ForeignViewSlotDeclaration() {},

  /** RenderStatement formats `render` view and injection targets. */
  RenderStatement(f) {
    f.oneSpaceAfter('render')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
    f.oneSpaceBeforeProperty('layoutClause')
  },

  /** ViewRender formats a child view invocation and its arguments. */
  ViewRender(f) {
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
    f.oneSpaceBeforeProperty('layoutClause')
  },

  /** RenderSlotDeclaration formats the optional `@name = empty` slot contract. */
  RenderSlotDeclaration(f) {
    f.oneSpaceAround('=')
  },

  /** RenderSlotUse separates a named slot fill from its visual value. */
  RenderSlotUse(f) {
    if (f.node.inputBindings.length === 0) {
      f.oneSpaceBeforeProperty('render')
    }
    f.noSpaceBefore('(')
    f.noSpaceBefore(':')
    if (AST.renderSlotBodyOf(f.node).kind === 'block') {
      f.noSpaceAfter(':')
    } else {
      f.oneSpaceAfter(':')
    }
    f.commaSpacedList()
    f.oneSpaceAround('->')
  },

  /** RenderSlotInputBinding is one name owned by its inline renderer. */
  RenderSlotInputBinding() {},

  /** CallerContentStatement is one atomic ambient placeholder. */
  CallerContentStatement() {},

  /** LayoutClause formats bracketed render layout entries. */
  LayoutClause(f) {
    f.commaSpacedList()
  },

  /** LayoutEntry formats one layout entry's head and terms. */
  LayoutEntry(f) {
    f.oneSpaceBeforeProperty('terms')
    f.oneSpaceBeforeProperty('condition')
  },

  /** LayoutCondition formats the narrow postfix design condition as one readable clause. */
  LayoutCondition(f) {
    f.oneSpaceAfter('when', 'is')
    f.oneSpaceBefore('when', 'is')
  },

  /** LayoutWord is a single token with no interior formatting. */
  LayoutWord() {},

  /** LayoutNumberLiteral is a single token with no interior formatting. */
  LayoutNumberLiteral() {},

  /** LayoutColorLiteral is a single token with no interior formatting. */
  LayoutColorLiteral() {},

  /** LayoutNoneLiteral is a single token with no interior formatting. */
  LayoutNoneLiteral() {},
} satisfies Partial<FormatHandlers>

/** renderPrefixLine returns a tag/label pair that can share a line without moving comments. */
export function renderPrefixLine(render: AST.Render): AST.RenderPrefix[] {
  const cluster = AST.renderPrefixCluster(render)
  if (
    cluster.length !== 2 || !cluster.some(AST.isTagStatement)
    || !cluster.some(AST.isRenderAccessibilityStatement)
  ) {
    return []
  }
  const first = AST.nodeRange(cluster[0]!)
  const last = AST.nodeRange(cluster[1]!)
  const target = AST.nodeRange(render)
  const block = render.$container
  if (
    !first || !last || !target || !AST.isBlock(block)
    || AST.commentRanges(block).some(comment => comment.from >= first.from && comment.to <= target.from)
  ) {
    return []
  }
  return cluster
}

/** canonicalRenderPrefixSource normalizes metadata by CST ranges without guessing expression ends. */
export function canonicalRenderPrefixSource(
  document: AST.Document,
  preserveOrder: ReadonlySet<AST.RenderAccessibilityStatement> = new Set(),
): string | undefined {
  const source = document.textDocument.getText()
  const edits: { range: AST.SyntaxRange; text: string }[] = []
  const reordered = new Set<AST.RenderAccessibilityStatement>()
  const nodes = AST.streamAllContents(document.parseResult.value)
  for (const render of nodes.filter(AST.isRender)) {
    const cluster = renderPrefixLine(render)
    const [label, tag] = cluster
    if (!AST.isRenderAccessibilityStatement(label) || !AST.isTagStatement(tag) || preserveOrder.has(label)) {
      continue
    }
    const labelRange = AST.nodeRange(label)!
    const tagRange = AST.nodeRange(tag)!
    const spelling = AST.propertyRange(label, 'spelling')!
    // Take the complete statement CST, including parentheses omitted from the expression AST.
    const labelText = source.slice(labelRange.from, spelling.from) + 'accessible'
      + source.slice(spelling.to, labelRange.to)
    edits.push({
      range: { from: labelRange.from, to: tagRange.to },
      text: `${source.slice(tagRange.from, tagRange.to)} ${labelText}`,
    })
    reordered.add(label)
  }
  for (const label of nodes.filter(AST.isRenderAccessibilityStatement)) {
    if (label.spelling === 'a11y' && !reordered.has(label)) {
      const spelling = AST.propertyRange(label, 'spelling')
      if (spelling) {
        edits.push({ range: spelling, text: 'accessible' })
      }
    }
  }
  if (edits.length === 0) {
    return undefined
  }
  return edits.sort((left, right) => right.range.from - left.range.from).reduce(
    (text, edit) => text.slice(0, edit.range.from) + edit.text + text.slice(edit.range.to),
    source,
  )
}

function ViewDeclaration(f: NodeFormat<AST.ViewDeclaration>): void {
  f.visibilityOnOwnLine()
  f.oneSpaceAfter('view', 'scene')
  if (f.node.genericParameters.length > 0) {
    f.oneSpaceAround('where')
    f.commaSpacedList()
  } else {
    f.noSpaceBefore('(')
  }
  f.oneSpaceBefore('responds')
  f.oneSpaceAfter('responds')
  // The header clause sits between the parameters (or `responds`) and the body, spaced as a render
  // site's clause is.
  f.oneSpaceBeforeProperty('layoutClause')
  // The pass-through alias form: `view Name = ns.Member`.
  f.oneSpaceAround('=')
  if (f.node.foreign?.accepts) {
    f.oneSpaceBeforeProperty('foreign')
  }
}

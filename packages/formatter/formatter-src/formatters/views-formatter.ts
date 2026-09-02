import { AST } from '@parser'
import type { FormatHandlers, NodeFormat } from '../formatting'

export default {
  TagStatement() {},
  /** ViewDeclaration formats a `view Name parameters` header with its optional responds clause. */
  ViewDeclaration: ViewDeclaration,

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
    f.oneSpaceBeforeProperty('render')
  },

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
    f.oneSpaceAround('when', 'is')
  },

  /** LayoutWord is a single token with no interior formatting. */
  LayoutWord() {},

  /** LayoutNumberLiteral is a single token with no interior formatting. */
  LayoutNumberLiteral() {},

  /** LayoutColorLiteral is a single token with no interior formatting. */
  LayoutColorLiteral() {},
} satisfies Partial<FormatHandlers>

function ViewDeclaration(f: NodeFormat<AST.ViewDeclaration>): void {
  f.visibilityOnOwnLine()
  f.oneSpaceAfter('view', 'scene')
  f.noSpaceBefore('(')
  f.oneSpaceBefore('responds')
  f.oneSpaceAfter('responds')
  // The pass-through alias form: `view Name = ns.Member`.
  f.oneSpaceAround('=')
}

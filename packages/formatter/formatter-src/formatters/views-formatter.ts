import { AST } from '@parser'
import type { FormatHandlers, NodeFormat } from '../formatting'

export default {
  /** ViewDeclaration formats a `view Name parameters` view header. */
  ViewDeclaration: ViewDeclaration,

  /** LayoutDeclaration formats a `layout Name parameters` view header. */
  LayoutDeclaration: ViewDeclaration,

  /** RenderStatement formats `render` view and injection targets. */
  RenderStatement(f) {
    f.oneSpaceAfter('render')
    f.oneSpaceBeforeProperty('argumentList')
    f.oneSpaceBeforeProperty('layoutClause')
  },

  /** ViewRender formats a child view invocation and its arguments. */
  ViewRender(f) {
    f.oneSpaceBeforeProperty('argumentList')
    f.oneSpaceBeforeProperty('layoutClause')
  },

  /** LayoutClause formats bracketed render layout entries. */
  LayoutClause(f) {
    f.commaSpacedList()
  },

  /** LayoutEntry formats one layout entry's head and terms. */
  LayoutEntry(f) {
    f.oneSpaceBeforeProperty('terms')
  },

  /** LayoutWord is a single token with no interior formatting. */
  LayoutWord() {},

  /** LayoutNumberLiteral is a single token with no interior formatting. */
  LayoutNumberLiteral() {},
} satisfies Partial<FormatHandlers>

function ViewDeclaration(f: NodeFormat<AST.RenderableDeclaration>): void {
  f.oneSpaceAfter('package', 'project', 'publish', 'view', 'layout')
  f.oneSpaceBeforeProperty('parameterList')
}

import { AST } from '@parser'
import type { FormatHandlers, NodeFormat } from '../formatting'

export default {
  TagStatement() {},
  /** ViewDeclaration formats a `view Name parameters` view header. */
  ViewDeclaration: ViewDeclaration,

  /** LayoutDeclaration formats a `layout Name parameters` view header. */
  LayoutDeclaration: ViewDeclaration,

  /** UiDeclaration formats a first-class presentation declaration. */
  UiDeclaration: ViewDeclaration,

  /** DialogueDeclaration formats its parameters and response enum header. */
  DialogueDeclaration(f) {
    ViewDeclaration(f)
    f.oneSpaceBefore('responds')
    f.oneSpaceAfter('responds')
  },

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

function ViewDeclaration(f: NodeFormat<AST.VisualDeclaration>): void {
  f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'view', 'layout', 'ui', 'dialogue')
  f.oneSpaceBeforeProperty('parameterList')
}

import { AST } from '@parser'
import type { FormatHandlers, NodeFormat } from './formatting'

export default {
  /** UiDeclaration formats a `ui Name parameters` view header. */
  UiDeclaration: ViewDeclaration,

  /** LayoutDeclaration formats a `layout Name parameters` view header. */
  LayoutDeclaration: ViewDeclaration,

  /** RenderStatement formats `render` view and injection targets. */
  RenderStatement(f) {
    f.oneSpaceAfter('render')
    f.oneSpaceBeforeProperty('argumentList')
  },

  /** ViewRender formats a child view invocation and its arguments. */
  ViewRender(f) {
    f.oneSpaceBeforeProperty('argumentList')
  },
} satisfies Partial<FormatHandlers>

function ViewDeclaration(f: NodeFormat<AST.ViewDeclaration>): void {
  f.oneSpaceAfter('share', 'hide', 'ui', 'layout')
  f.oneSpaceBeforeProperty('parameterList')
}

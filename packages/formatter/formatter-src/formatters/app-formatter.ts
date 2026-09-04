import type { FormatHandlers } from '../formatting'

export default {
  /** AppDeclaration formats the `app Name` header; the app body is formatted as a Block. */
  AppDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('app')
    f.oneSpaceAround('=')
  },

  AppBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
    f.lineSeparatedList(f.node.statements)
  },

  AppAuxiliaryNavigator(f) {
    f.oneSpaceBeforeProperty('value')
  },

  /** AppView formats the `view Shell(Navigator)` root-view statement and its bound arguments. */
  AppView(f) {
    f.oneSpaceAfter('view')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** AppProperty formats any Prelude-owned app supplied slot generically. */
  AppProperty(f) {
    f.oneSpaceBeforeProperty('patch', 'value')
  },
} satisfies Partial<FormatHandlers>

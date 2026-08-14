import type { FormatHandlers } from '../formatting'

export default {
  /** AppDeclaration formats the `app Name` header; the app body is formatted as a Block. */
  AppDeclaration(f) {
    f.oneSpaceAfter('app')
  },

  AppBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
    f.lineSeparatedList(f.node.statements)
  },

  AppName(f) {
    f.oneSpaceBeforeProperty('value')
  },

  AppNavigator(f) {
    f.oneSpaceBeforeProperty('value')
  },

  AppAuxiliaryNavigator(f) {
    f.oneSpaceBeforeProperty('value')
  },

  /** AppView formats the `view MainView` entry-view statement. */
  AppView(f) {
    f.oneSpaceAfter('view')
  },

  /** AppDatasource formats app-owned schema storage bindings. */
  AppDatasource(f) {
    f.oneSpaceBeforeProperty('value')
  },
} satisfies Partial<FormatHandlers>

import type { FormatHandlers } from '../formatting'

export default {
  /** AppDeclaration formats the `app Name` header; the app body is formatted as a Block. */
  AppDeclaration(f) {
    f.oneSpaceAfter('app')
  },

  /** AppView formats the `view MainView` entry-view statement. */
  AppView(f) {
    f.oneSpaceAfter('view')
  },

  /** AppDatasource formats app-owned schema storage bindings. */
  AppDatasource(f) {
    f.oneSpaceAfter('datasource', 'through')
    f.oneSpaceBefore('through')
  },
} satisfies Partial<FormatHandlers>

import type { FormatHandlers } from './formatting'

export default {
  /** AppDeclaration formats the `app Name` header; the app body is formatted as a Block. */
  AppDeclaration(f) {
    f.oneSpaceAfter('app')
  },

  /** AppUi formats the `ui MainView` entry-view statement. */
  AppUi(f) {
    f.oneSpaceAfter('ui')
  },
} satisfies FormatHandlers

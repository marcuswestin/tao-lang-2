import AliasesFormatter from './aliases-formatter'
import AppFormatter from './app-formatter'
import ExpressionsFormatter from './expressions-formatter'
import FilesFormatter from './files-formatter'
import type { FormatHandlers } from './formatting'
import InjectionsFormatter from './injections-formatter'
import StatementsFormatter from './statements-formatter'
import UseFormatter from './use-formatter'
import ViewsFormatter from './views-formatter'

/** Format formats parsed Tao AST nodes via per-feature formatting handlers keyed by node type. */
export const Format = {
  ...FilesFormatter,
  ...UseFormatter,
  ...AppFormatter,
  ...AliasesFormatter,
  ...ViewsFormatter,
  ...StatementsFormatter,
  ...ExpressionsFormatter,
  ...InjectionsFormatter,
} as const satisfies FormatHandlers

import AliasesFormatter from './formatters/aliases-formatter'
import AppFormatter from './formatters/app-formatter'
import ExpressionsFormatter from './formatters/expressions-formatter'
import FilesFormatter from './formatters/files-formatter'
import InjectionsFormatter from './formatters/injections-formatter'
import ProjectFormatter from './formatters/project-formatter'
import StatementsFormatter from './formatters/statements-formatter'
import UseFormatter from './formatters/use-formatter'
import ViewsFormatter from './formatters/views-formatter'
import type { FormatHandlers } from './formatting'

/** Format formats parsed Tao AST nodes via per-feature formatting handlers keyed by node type. */
export const Format = {
  ...FilesFormatter,
  ...UseFormatter,
  ...ProjectFormatter,
  ...AppFormatter,
  ...AliasesFormatter,
  ...ViewsFormatter,
  ...StatementsFormatter,
  ...ExpressionsFormatter,
  ...InjectionsFormatter,
} as const satisfies FormatHandlers

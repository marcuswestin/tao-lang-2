import { ActionsFormatter } from './formatters/ActionsFormatter'
import AliasesFormatter from './formatters/aliases-formatter'
import AppFormatter from './formatters/app-formatter'
import ConfigurationFormatter from './formatters/configuration-formatter'
import DataFormatter from './formatters/data-formatter'
import DesignFormatter from './formatters/design-formatter'
import ExpressionsFormatter from './formatters/expressions-formatter'
import FilesFormatter from './formatters/files-formatter'
import InjectionsFormatter from './formatters/injections-formatter'
import NavigationFormatter from './formatters/navigation-formatter'
import ProjectFormatter from './formatters/project-formatter'
import { StateFormatter } from './formatters/StateFormatter'
import StatementsFormatter from './formatters/statements-formatter'
import TestsFormatter from './formatters/tests-formatter'
import TypesFormatter from './formatters/types-formatter'
import UseFormatter from './formatters/use-formatter'
import ViewsFormatter from './formatters/views-formatter'
import type { FormatHandlers } from './formatting'

/** Format formats parsed Tao AST nodes via per-feature formatting handlers keyed by node type. */
export const Format = {
  ...FilesFormatter,
  ...UseFormatter,
  ...ProjectFormatter,
  ...TestsFormatter,
  ...AppFormatter,
  ...ConfigurationFormatter,
  ...DataFormatter,
  ...DesignFormatter,
  ...ActionsFormatter,
  ...StateFormatter,
  ...AliasesFormatter,
  ...ViewsFormatter,
  ...TypesFormatter,
  ...StatementsFormatter,
  ...ExpressionsFormatter,
  ...InjectionsFormatter,
  ...NavigationFormatter,
} as const satisfies FormatHandlers

import { ActionsFormatter } from './formatters/ActionsFormatter'
import { AliasesFormatter } from './formatters/AliasesFormatter'
import { AppFormatter } from './formatters/AppFormatter'
import { AssociatedMethodsFormatter } from './formatters/AssociatedMethodsFormatter'
import { ConfigurationFormatter } from './formatters/ConfigurationFormatter'
import { DataFormatter } from './formatters/DataFormatter'
import { DesignFormatter } from './formatters/DesignFormatter'
import { ExpressionsFormatter } from './formatters/ExpressionsFormatter'
import { FilesFormatter } from './formatters/FilesFormatter'
import { InjectionsFormatter } from './formatters/InjectionsFormatter'
import { NavigationFormatter } from './formatters/NavigationFormatter'
import { NumericUnitsFormatter } from './formatters/NumericUnitsFormatter'
import { PackageFormatter } from './formatters/PackageFormatter'
import { RestorationFormatter } from './formatters/RestorationFormatter'
import { ScenariosFormatter } from './formatters/ScenariosFormatter'
import { StateFormatter } from './formatters/StateFormatter'
import { StatementsFormatter } from './formatters/StatementsFormatter'
import { TestsFormatter } from './formatters/TestsFormatter'
import { TypesFormatter } from './formatters/TypesFormatter'
import { UseFormatter } from './formatters/UseFormatter'
import { ViewsFormatter } from './formatters/ViewsFormatter'
import type { FormatHandlers } from './formatting'

/** Format formats parsed Tao AST nodes via per-feature formatting handlers keyed by node type. */
export const Format = {
  ...FilesFormatter,
  ...UseFormatter,
  ...PackageFormatter,
  ...RestorationFormatter,
  ...TestsFormatter,
  ...ScenariosFormatter,
  ...AppFormatter,
  ...ConfigurationFormatter,
  ...DataFormatter,
  ...DesignFormatter,
  ...ActionsFormatter,
  ...StateFormatter,
  ...AliasesFormatter,
  ...ViewsFormatter,
  ...TypesFormatter,
  ...AssociatedMethodsFormatter,
  ...StatementsFormatter,
  ...ExpressionsFormatter,
  ...NumericUnitsFormatter,
  ...InjectionsFormatter,
  ...NavigationFormatter,
} as const satisfies FormatHandlers

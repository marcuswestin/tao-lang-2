import { ActionsCompiler } from './app/ActionsCompiler'
import { AliasesCompiler } from './app/AliasesCompiler'
import { AppCompiler } from './app/AppCompiler'
import { ConfigurationCompiler } from './app/ConfigurationCompiler'
import { DataCompiler } from './app/DataCompiler'
import { DesignCompiler } from './app/DesignCompiler'
import { ExpressionsCompiler } from './app/ExpressionsCompiler'
import { FilesCompiler } from './app/FilesCompiler'
import { FunctionalCoreCompiler } from './app/FunctionalCoreCompiler'
import { InjectionsCompiler } from './app/InjectionsCompiler'
import { InteractionOutlineCompiler } from './app/InteractionOutlineCompiler'
import { InvocationsCompiler } from './app/InvocationsCompiler'
import { NavigationCompiler } from './app/NavigationCompiler'
import { RenderStatementCompiler } from './app/RenderStatementCompiler'
import { StateCompiler } from './app/StateCompiler'
import { StatementsCompiler } from './app/StatementsCompiler'
import { TaoPropsCompiler } from './app/TaoPropsCompiler'
import { TestsCompiler } from './app/TestsCompiler'
import { UseStatementCompiler } from './app/UseStatementCompiler'
import { ViewsCompiler } from './app/ViewsCompiler'

/** Compile compiles parsed Tao AST nodes into Expo-compatible TSX source. */
export const Compile = {
  ...FilesCompiler,
  ...StatementsCompiler,
  ...TestsCompiler,
  ...AppCompiler,
  ...ActionsCompiler,
  ...StateCompiler,
  ...AliasesCompiler,
  ...ViewsCompiler,
  ...InvocationsCompiler,
  ...TaoPropsCompiler,
  ...RenderStatementCompiler,
  ...UseStatementCompiler,
  ...InjectionsCompiler,
  ...InteractionOutlineCompiler,
  ...NavigationCompiler,
  ...FunctionalCoreCompiler,
  ...DataCompiler,
  ...DesignCompiler,
  ...ExpressionsCompiler,
  ...ConfigurationCompiler,
} as const

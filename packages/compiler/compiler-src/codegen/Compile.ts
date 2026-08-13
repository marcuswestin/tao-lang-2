import { ActionsCompiler } from './app/ActionsCompiler'
import AliasesCompiler from './app/aliases-compiler'
import AppCompiler from './app/app-compiler'
import { ConfigurationCompiler } from './app/configuration-compiler'
import { DataCompiler } from './app/DataCompiler'
import { ExpressionsCompiler } from './app/expressions-compiler'
import FilesCompiler from './app/files-compiler'
import { FunctionalCoreCompiler } from './app/FunctionalCoreCompiler'
import { InjectionsCompiler } from './app/injections-compiler'
import InvocationsCompiler from './app/invocations-compiler'
import { NavigationCompiler } from './app/NavigationCompiler'
import ProjectDeclarationCompiler from './app/project-declaration-compiler'
import RenderStatementCompiler from './app/render-statement-compiler'
import { StateCompiler } from './app/StateCompiler'
import { StatementsCompiler } from './app/statements-compiler'
import { TaoPropsCompiler } from './app/tao-props-compiler'
import TestsCompiler from './app/tests-compiler'
import UseStatementCompiler from './app/use-statement-compiler'
import { ViewsCompiler } from './app/views-compiler'

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
  ...ProjectDeclarationCompiler,
  ...InjectionsCompiler,
  ...NavigationCompiler,
  ...FunctionalCoreCompiler,
  ...DataCompiler,
  ...ExpressionsCompiler,
  ...ConfigurationCompiler,
} as const

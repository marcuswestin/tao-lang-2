import { ActionsCompiler } from './app/ActionsCompiler'
import AliasesCompiler from './app/aliases-compiler'
import AppCompiler from './app/app-compiler'
import { ExpressionsCompiler } from './app/expressions-compiler'
import FilesCompiler from './app/files-compiler'
import { InjectionsCompiler } from './app/injections-compiler'
import InvocationsCompiler from './app/invocations-compiler'
import ProjectDeclarationCompiler from './app/project-declaration-compiler'
import RenderStatementCompiler from './app/render-statement-compiler'
import { StateCompiler } from './app/StateCompiler'
import { StatementsCompiler } from './app/statements-compiler'
import UseStatementCompiler from './app/use-statement-compiler'
import { ViewsCompiler } from './app/views-compiler'

/** Compile compiles parsed Tao AST nodes into Expo-compatible TSX source. */
export const Compile = {
  ...FilesCompiler,
  ...StatementsCompiler,
  ...AppCompiler,
  ...ActionsCompiler,
  ...StateCompiler,
  ...AliasesCompiler,
  ...ViewsCompiler,
  ...InvocationsCompiler,
  ...RenderStatementCompiler,
  ...UseStatementCompiler,
  ...ProjectDeclarationCompiler,
  ...InjectionsCompiler,
  ...ExpressionsCompiler,
} as const

import AliasesCompiler from './app/aliases-compiler'
import AppCompiler from './app/app-compiler'
import ExpressionsCompiler from './app/expressions-compiler'
import FilesCompiler from './app/files-compiler'
import InjectionsCompiler from './app/injections-compiler'
import InvocationsCompiler from './app/invocations-compiler'
import StatementsCompiler from './app/statements-compiler'
import ViewsCompiler from './app/views-compiler'

/** Compile compiles parsed Tao AST nodes into Expo-compatible TSX source. */
export const Compile = {
  ...FilesCompiler,
  ...StatementsCompiler,
  ...AppCompiler,
  ...AliasesCompiler,
  ...ViewsCompiler,
  ...InvocationsCompiler,
  ...InjectionsCompiler,
  ...ExpressionsCompiler,
} as const

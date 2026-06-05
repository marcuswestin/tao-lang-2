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
  TaoFile: FilesCompiler.CompileTaoFile,
  Statement: StatementsCompiler.CompileStatement,
  App: AppCompiler.CompileApp,
  AppUi: AppCompiler.CompileAppUi,
  AliasDeclaration: AliasesCompiler.CompileAliasDeclaration,
  UiDeclaration: ViewsCompiler.CompileUiDeclaration,
  ViewParameterList: ViewsCompiler.CompileViewParameterList,
  ParameterDeclaration: ViewsCompiler.CompileParameterDeclaration,
  ParameterType: ViewsCompiler.CompileParameterType,
  ViewBlock: ViewsCompiler.CompileViewBlock,
  ViewStatement: ViewsCompiler.CompileViewStatement,
  Render: InvocationsCompiler.CompileRender,
  RenderProps: InvocationsCompiler.CompileRenderProps,
  InvocationPair: InvocationsCompiler.CompileInvocationPair,
  Argument: InvocationsCompiler.CompileArgument,
  Injection: InjectionsCompiler.CompileInjection,
  Expression: ExpressionsCompiler.CompileExpression,
  StringLiteral: ExpressionsCompiler.CompileStringLiteral,
  NumberLiteral: ExpressionsCompiler.CompileNumberLiteral,
  ValueReference: ExpressionsCompiler.CompileValueReference,
} as const

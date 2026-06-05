import AliasesCompiler from './aliases-compiler'
import AppCompiler from './app-compiler'
import ExpressionsCompiler from './expressions-compiler'
import FilesCompiler from './files-compiler'
import InjectionsCompiler from './injections-compiler'
import InvocationsCompiler from './invocations-compiler'
import StatementsCompiler from './statements-compiler'
import ViewsCompiler from './views-compiler'

/** Compile compiles parsed Tao AST nodes into Expo-compatible TSX source. */
export const Compile = {
  TaoFile: FilesCompiler.CompileTaoFile,
  Statement: StatementsCompiler.CompileStatement,
  App: AppCompiler.CompileApp,
  AppUi: AppCompiler.CompileAppUi,
  AliasDeclaration: AliasesCompiler.CompileAliasDeclaration,
  UiDeclaration: ViewsCompiler.CompileUiDeclaration,
  ViewParameterList: ViewsCompiler.CompileViewParameterList,
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

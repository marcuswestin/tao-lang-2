import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const StatementsCompiler = {
  /** Statement compiles one Tao statement. */
  Statement(statement: AST.Statement): Compiled {
    return Switch.type(statement, {
      AliasDeclaration: Compile.AliasDeclaration,
      AppDeclaration: Compile.App,
      AppStack: Compile.AppStack,
      AppView: Compile.AppView,
      ActionDeclaration: Compile.ActionDeclaration,
      CheckDeclaration: Compile.CheckDeclaration,
      DataDeclaration: Compile.DataDeclaration,
      DataStatusStep: Compile.DataStatusStep,
      EnterTextStep: Compile.EnterTextStep,
      ExpectTextStep: Compile.ExpectTextStep,
      ForStatement: Compile.ForStatement,
      FunctionDeclaration: Compile.FunctionDeclaration,
      IfStatement: Compile.IfStatement,
      Injection: Compile.Injection,
      LayoutDeclaration: Compile.LayoutDeclaration,
      PressTextStep: Compile.PressTextStep,
      ProjectDeclaration: Compile.ProjectDeclaration,
      QueryDeclaration: Compile.QueryDeclaration,
      RenderStatement: Compile.RenderStatement,
      RunStep: Compile.RunStep,
      StateDeclaration: Compile.StateDeclaration,
      StackDeclaration: Compile.StackDeclaration,
      SubmitInputStep: Compile.SubmitInputStep,
      TestDeclaration: Compile.TestDeclaration,
      TypeDeclaration: Compile.TypeDeclaration,
      UseStatement: Compile.UseStatement,
      ViewDeclaration: Compile.ViewDeclaration,
      ViewRender: Compile.ViewRender,
    })
  },

  /** TypeDeclaration emits no runtime code; Tao named types are compile-time only. */
  TypeDeclaration(): Compiled {
    return gen.noop()
  },
} as const

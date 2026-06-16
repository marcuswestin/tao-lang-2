import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled } from '../codegen-util'
import { Compile } from '../Compile'

export const StatementsCompiler = {
  /** Statement compiles one Tao statement. */
  Statement(statement: AST.Statement): Compiled {
    return Switch.type(statement, {
      AliasDeclaration: Compile.AliasDeclaration,
      AppDeclaration: Compile.App,
      AppView: Compile.AppView,
      ActionDeclaration: Compile.ActionDeclaration,
      Injection: Compile.Injection,
      LayoutDeclaration: Compile.LayoutDeclaration,
      ProjectDeclaration: Compile.ProjectDeclaration,
      RenderStatement: Compile.RenderStatement,
      StateDeclaration: Compile.StateDeclaration,
      UseStatement: Compile.UseStatement,
      ViewDeclaration: Compile.ViewDeclaration,
      ViewRender: Compile.ViewRender,
    })
  },
} as const

import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** Statement compiles one Tao statement. */
  Statement(statement: AST.Statement): Compiled {
    return Switch.type(statement, {
      AliasDeclaration: Compile.AliasDeclaration,
      AppDeclaration: Compile.App,
      AppView: Compile.AppView,
      CheckDeclaration: Compile.CheckDeclaration,
      ExpectTextStep: Compile.ExpectTextStep,
      Injection: Compile.Injection,
      LayoutDeclaration: Compile.LayoutDeclaration,
      ProjectDeclaration: Compile.ProjectDeclaration,
      RenderStatement: Compile.RenderStatement,
      RunStep: Compile.RunStep,
      TestDeclaration: Compile.TestDeclaration,
      UseStatement: Compile.UseStatement,
      ViewDeclaration: Compile.ViewDeclaration,
      ViewRender: Compile.ViewRender,
    })
  },
} as const

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
      AppUi: Compile.AppUi,
      Injection: Compile.Injection,
      LayoutDeclaration: Compile.LayoutDeclaration,
      ProjectDeclaration: Compile.ProjectDeclaration,
      RenderStatement: Compile.RenderStatement,
      UseStatement: Compile.UseStatement,
      UiDeclaration: Compile.UiDeclaration,
      ViewRender: Compile.ViewRender,
    })
  },
} as const

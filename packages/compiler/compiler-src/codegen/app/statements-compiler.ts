import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, genNoop } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** Statement compiles one Tao statement. */
  Statement(statement: AST.Statement): Compiled {
    return Switch.type(statement, {
      AliasDeclaration: Compile.AliasDeclaration,
      AppDeclaration: Compile.App,
      AppView: Compile.AppView,
      Injection: Compile.Injection,
      LayoutDeclaration: Compile.LayoutDeclaration,
      ProjectDeclaration: Compile.ProjectDeclaration,
      RenderStatement: Compile.RenderStatement,
      TypeDeclaration: Compile.TypeDeclaration,
      UseStatement: Compile.UseStatement,
      ViewDeclaration: Compile.ViewDeclaration,
      ViewRender: Compile.ViewRender,
    })
  },

  /** TypeDeclaration emits no runtime code; Tao named types are compile-time only. */
  TypeDeclaration(): Compiled {
    return genNoop()
  },
} as const

import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled } from '../codegen-util'
import { Compile } from './Compile'

export default {
  /** CompileStatement compiles one Tao statement. */
  CompileStatement(statement: AST.Statement): Compiled {
    return Switch.type(statement, {
      AliasDeclaration: Compile.AliasDeclaration,
      AppDeclaration: Compile.App,
      AppUi: Compile.AppUi,
      Injection: Compile.Injection,
      Render: Compile.Render,
      UiDeclaration: Compile.UiDeclaration,
    })
  },
} as const

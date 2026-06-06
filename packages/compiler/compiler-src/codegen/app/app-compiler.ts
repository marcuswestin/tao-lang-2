import { AST } from '@parser'
import { type Compiled, gen, genList, genScopeName, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** App compiles a Tao app declaration into the generated default app component. */
  App(app: AST.AppDeclaration): Compiled {
    return gen`
      export default function TaoApp() {
        ${genList(app.block.statements, Compile.Statement)}
      }
    `
  },

  /** AppUi compiles an app ui statement into the generated app root return. */
  AppUi(appUi: AST.AppUi): Compiled {
    const view = resolveRef(appUi.ui)
    return gen`return <${genScopeName(view)} />`
  },
} as const

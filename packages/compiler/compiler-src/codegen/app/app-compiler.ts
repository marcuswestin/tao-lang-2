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

  /** AppView compiles an app view statement into the generated app root return. */
  AppView(appView: AST.AppView): Compiled {
    const view = resolveRef(appView.view)
    return gen`
      return <TR.AppShell>
        <${genScopeName(view)} __tao={TR.TaoProps({ parentDirection: "column" })} />
      </TR.AppShell>
    `
  },
} as const

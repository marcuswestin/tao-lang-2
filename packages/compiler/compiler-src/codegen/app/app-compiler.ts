import { AST } from '@parser'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** App compiles a Tao app declaration into the generated default app component. */
  App(app: AST.AppDeclaration): Compiled {
    return gen`
      export default function TaoApp() {
        ${gen.block(app, Compile.Statement)}
      }
    `
  },

  /** AppView compiles an app view statement into the generated app root return. */
  AppView(appView: AST.AppView): Compiled {
    const view = resolveRef(appView.view)
    return gen`
      return <TR.AppShell>
        <${gen.scopeName(view)} />
      </TR.AppShell>
    `
  },

  /** AppStack compiles an app-owned navigation stack into the generated app root. */
  AppStack(appStack: AST.AppStack): Compiled {
    const stack = resolveRef(appStack.stack)
    return gen`
      return <TR.AppShell>
        <TR.Navigation.Host stack={${gen.scopeName(stack)}} />
      </TR.AppShell>
    `
  },
} as const

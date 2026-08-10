import { AST } from '@parser'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** App compiles a Tao app declaration into the generated default app component. */
  App(app: AST.AppDeclaration): Compiled {
    // Datasources are configured before the root view returns, whatever their source order.
    const statements = AST.blockStatements(app)
    const setup = statements.filter(AST.isAppDatasource)
    const roots = statements.filter(AST.isAppView)
    return gen`
      export default function TaoApp() {
        ${gen.list(setup, Compile.AppDatasource)}
        ${gen.list(roots, Compile.AppView)}
      }
    `
  },

  /** AppDatasource compiles a datasource binding into a provider configuration hook. */
  AppDatasource(datasource: AST.AppDatasource): Compiled {
    const data = resolveRef(datasource.data)
    return gen`TR.Data.useConfigure(${gen.scopeName(data)}, TR.Data.${datasource.provider}Provider())`
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
} as const

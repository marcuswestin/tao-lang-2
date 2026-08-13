import { AST } from '@parser'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** App compiles a Tao app declaration into the generated default app component. */
  App(app: AST.AppDeclaration): Compiled {
    const statements = AST.blockStatements(app)
    const datasources = statements.filter(AST.isAppDatasource)
    const navigator = statements.find(AST.isAppNavigator)
    if (navigator) {
      const appName = statements.find(AST.isAppName)?.value.value ?? app.name
      const auxiliaries = statements.filter(AST.isAppAuxiliaryNavigator)
      const definition = { name: `_TaoAppDefinition_${app.name}` }
      return gen`
        const ${gen.Name(definition)} = TR.Navigation.App({
          name: ${gen.jsLiteral(appName)},
          navigator: () => ${compileAppValue(navigator.value)},
          auxiliaries: () => ({
            ${
        gen.list(auxiliaries, auxiliary =>
          gen`${gen.jsLiteral(auxiliary.name.slice(1))}: ${compileAppValue(auxiliary.value)},`)
      }
          }),
        })
        function ${gen.Name({ name: `TaoApp_${app.name}` })}() {
          ${gen.list(datasources, Compile.AppDatasource)}
          return <TR.AppShell>
            <TR.Navigation.AppHost app={${gen.Name(definition)}} />
          </TR.AppShell>
        }
      `
    }
    const roots = statements.filter(AST.isAppView)
    return gen`
      function ${gen.Name({ name: `TaoApp_${app.name}` })}() {
        ${gen.list(datasources, Compile.AppDatasource)}
        ${gen.list(roots, Compile.AppView)}
      }
    `
  },

  /** AppDatasource uses lifecycle-safe provider binding for one stable schema at the app root. */
  AppDatasource(datasource: AST.AppDatasource): Compiled {
    return gen`TR.Data.UseConfigured(
      ${gen.scopeName({ name: '_TaoDataCatalog' })},
      ${Compile.ConfiguredValue(datasource.value)},
    )`
  },

  /** AppName is compiled as part of its owning app definition. */
  AppName(): Compiled {
    return gen.noop()
  },

  /** AppNavigator is compiled as part of its owning app definition. */
  AppNavigator(): Compiled {
    return gen.noop()
  },

  /** AppAuxiliaryNavigator is compiled as part of its owning app definition. */
  AppAuxiliaryNavigator(): Compiled {
    return gen.noop()
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

function compileAppValue(value: AST.Expression | AST.NavigationConfiguredValue): Compiled {
  return AST.isConfiguredValue(value) ? Compile.ConfiguredValue(value) : Compile.Expression(value)
}

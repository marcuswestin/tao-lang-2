import { AST } from '@parser'
import { Assert } from '@shared'
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
          declaration: TR.Navigation.AppDeclaration(${gen.jsLiteral(app.name)}),
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

  /** AppVariant emits an independently mounted app descriptor derived from declaration-linked config. */
  AppVariant(variant: AST.AliasDeclaration): Compiled {
    const definition = { name: `_TaoAppDefinition_${variant.name}` }
    const navigator = compileEffectiveNavigator(variant)
    const datasource = compileEffectiveDatasource(variant)
    const auxiliaries = AST.blockStatements(rootApp(variant)).filter(AST.isAppAuxiliaryNavigator)
    // Cross-module apps require lazy derivation from the immediate base variant's runtime value.
    return gen`
      const ${gen.Name(definition)} = TR.Navigation.App({
        declaration: ${gen.Name({ name: `_TaoAppDefinition_${rootApp(variant).name}` })}.declaration,
        name: ${compileEffectiveAppName(variant)},
        navigator: () => ${navigator},
        auxiliaries: () => ({
          ${
      gen.list(auxiliaries, auxiliary =>
        gen`${gen.jsLiteral(auxiliary.name.slice(1))}: ${compileAppValue(auxiliary.value)},`)
    }
        }),
      })
      function ${gen.Name({ name: `TaoApp_${variant.name}` })}() {
        ${
      datasource
        ? gen`TR.Data.UseConfigured(${gen.scopeName({ name: '_TaoDataCatalog' })}, ${datasource})`
        : gen.noop()
    }
        return <TR.AppShell>
          <TR.Navigation.AppHost app={${gen.Name(definition)}} />
        </TR.AppShell>
      }
      ${gen.scopeName(variant)} = ${gen.Name(definition)}
    `
  },

  /** AppDatasource uses lifecycle-safe provider binding for one stable schema at the app root. */
  AppDatasource(datasource: AST.AppDatasource): Compiled {
    return gen`TR.Data.UseConfigured(
      ${gen.scopeName({ name: '_TaoDataCatalog' })},
      ${compileDatasourceValue(datasource.value)},
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

function compileAppValue(value: AST.AppPropertyValue | AST.ConfigurationConstructor): Compiled {
  if (AST.isConfigurationConstructor(value)) {
    return Compile.ConfiguredValue(value)
  }
  return compileConfiguredAppProperty(value)
}

function appVariantChain(value: AST.AppValueDeclaration): AST.AppVariantDeclaration[] {
  if (AST.isAppDeclaration(value)) {
    return []
  }
  const variant = AST.isAppVariantDeclaration(value)
    ? value
    : Assert.never(value as never, 'validated app value alias is an app variant')
  const base = resolveRef(variant.value.target)
  Assert.is(base, AST.isAppValueDeclaration, 'validated app patch base is an app value')
  return [...appVariantChain(base), variant]
}

function rootApp(value: AST.AppValueDeclaration): AST.AppDeclaration {
  const app = AST.appDeclarationOf(value)
  Assert.defined(app, 'validated app value resolves its root declaration')
  return app
}

function propertyPatch(
  variant: AST.AppVariantDeclaration,
  name: 'Name' | 'Navigator' | 'Datasource',
): AST.ConfigurationValue | undefined {
  return variant.value.patchBlock.entries.find(entry => entry.name === name)?.value
}

function compileEffectiveAppName(value: AST.AppValueDeclaration): Compiled {
  let result: Compiled = gen`${
    gen.jsLiteral(
      AST.blockStatements(rootApp(value)).find(AST.isAppName)?.value.value ?? rootApp(value).name,
    )
  }`
  for (const variant of appVariantChain(value)) {
    const patch = propertyPatch(variant, 'Name')
    if (patch) {
      Assert(!AST.isPropertyConfigurationPatch(patch), 'validated app Name patch overwrites a text value')
      result = gen`${Compile.ConfigurationValue(patch)}.evaluate().jsValue as string`
    }
  }
  return result
}

function compileEffectiveNavigator(value: AST.AppValueDeclaration): Compiled {
  const navigator = AST.blockStatements(rootApp(value)).find(AST.isAppNavigator)
  Assert.defined(navigator, 'validated app has a navigator')
  let result = compileAppValue(navigator.value)
  for (const variant of appVariantChain(value)) {
    const patch = propertyPatch(variant, 'Navigator')
    if (!patch) {
      continue
    }
    result = AST.isPropertyConfigurationPatch(patch)
      ? gen`TR.Navigation.Patch(${result}, ${Compile.ConfigurationPatchObject(patch.block)})`
      : Compile.ConfigurationValue(patch)
  }
  return result
}

function compileEffectiveDatasource(value: AST.AppValueDeclaration): Compiled | undefined {
  const datasource = AST.blockStatements(rootApp(value)).find(AST.isAppDatasource)
  let result = datasource ? compileDatasourceValue(datasource.value) : undefined
  for (const variant of appVariantChain(value)) {
    const patch = propertyPatch(variant, 'Datasource')
    if (!patch) {
      continue
    }
    if (AST.isPropertyConfigurationPatch(patch)) {
      Assert.defined(result, 'validated app datasource property patch has a base value')
      result = gen`TR.Data.Patch(${result}, ${Compile.ConfigurationPatchObject(patch.block)})`
    } else {
      result = Compile.ConfigurationValue(patch)
    }
  }
  return result
}

function compileDatasourceValue(value: AST.AppPropertyValue): Compiled {
  return compileConfiguredAppProperty(value)
}

function compileConfiguredAppProperty(value: AST.AppPropertyValue): Compiled {
  const target = AST.isConfiguredAppPropertyValue(value)
    ? resolveRef(value.target)
    : AST.inferredAppPropertyDeclaration(value)
  Assert.defined(target, 'validated bare app property resolves its slot-named declaration')
  if (AST.isConfigurableDeclaration(target)) {
    const block = value.block ?? {
      $type: 'ConfigurationBlock',
      entries: [],
      $container: value,
    } as unknown as AST.ConfigurationBlock
    const constructor = {
      $type: 'ConfigurationConstructor',
      type: AST.isConfiguredAppPropertyValue(value)
        ? value.target
        : { $refText: target.name, ref: target },
      members: [],
      block,
      $container: value.$container,
    } as unknown as AST.ConfigurationConstructor
    return Compile.ConfiguredValue(constructor)
  }
  if (AST.isAliasDeclaration(target)) {
    return Compile.ValueDeclarationReference(target)
  }
  return Assert.never(target as never, 'validated app property references a configured declaration')
}

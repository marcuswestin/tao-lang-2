import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type CodegenOptions, type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import { compileDeclarationIdentity } from './declaration-identity'

type AppPropertySource = AST.Expression | AST.ConfigurationValue

type EffectiveAppProperty = {
  patches: AST.ConfigurationBlock[]
  value: AppPropertySource
}

type EffectiveAppConfiguration = Map<string, EffectiveAppProperty>

export default {
  /** App compiles legacy root-view apps and complete primitive-headed app values. */
  App(app: AST.AppDeclaration, options: CodegenOptions = {}): Compiled {
    return isLegacyViewApp(app) ? compileLegacyViewApp(app, options) : compileAppValue(app, options)
  },

  /** AppValue compiles an inferred `let` whose value family is app. */
  AppValue(app: AST.AppValueDeclaration): Compiled {
    return compileAppValue(app)
  },

  /** PrimitiveValueDeclaration binds one complete nav or datasource descriptor as an immutable Tao value. */
  PrimitiveValueDeclaration(declaration: AST.NavDeclaration | AST.DatasourceDeclaration): Compiled {
    const value = declaration.value
      ? Compile.Expression(declaration.value)
      : compilePrimitiveBlock(declaration)
    return gen`${gen.scopeName(declaration)} = TR.Alias(${value})`
  },

  /** AppAuxiliaryNavigator is compiled as part of its root app definition. */
  AppAuxiliaryNavigator(): Compiled {
    return gen.noop()
  },

  /** AppProperty is compiled as part of its owning app definition. */
  AppProperty(): Compiled {
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

function compileAppValue(app: AST.AppValueDeclaration, options: CodegenOptions = {}): Compiled {
  const configuration = effectiveAppConfiguration(app)
  const navigator = configuration.get('Navigator')
  Assert.defined(navigator, 'validated app value has a Navigator')
  const name = configuration.get('Name')
  const datasource = configuration.get('Datasource')
  const design = configuration.get('Design')
  const restoration = effectiveRestorationPolicy(app)
  const root = ASTUtils.rootAppValue(app)
  Assert.defined(root, 'validated app derivation is acyclic')
  const definition = { name: `_TaoAppDefinition_${app.name}` }
  const rootDeclaration = root === app
    ? gen`TR.Navigation.AppDeclaration(${gen.jsLiteral(app.name)}, ${compileDeclarationIdentity(app)})`
    : gen`${appDefinitionReference(root)}.declaration`
  const auxiliaries = rootAuxiliaryNavigators(root)
  const persistedStates = AST.isAppDeclaration(root) && root.block
    ? root.block.statements.filter(AST.isStateDeclaration)
    : []
  const appActions = AST.isAppDeclaration(root) && root.block
    ? root.block.statements.filter(AST.isActionDeclaration)
    : []
  const declaredPersistedStates = root === app ? persistedStates : []
  const declaredAppActions = root === app ? appActions : []
  return gen`
    ${gen.list(declaredPersistedStates, Compile.StateDeclaration)}
    ${gen.list(declaredAppActions, Compile.ActionDeclaration)}
    const ${gen.Name(definition)} = TR.Navigation.App({
      declaration: ${rootDeclaration},
      name: ${name ? gen`${compileAppProperty(name, 'Name')}.evaluate().jsValue as string` : gen.jsLiteral(app.name)},
      navigator: () => ${compileAppProperty(navigator, 'Navigator')},
      restoration: {
        exclusions: ${gen.jsLiteral(restoration.exclusions)},
        mode: ${gen.jsLiteral(restoration.mode)},
        variant: ${gen.jsLiteral(app.name)},
        ${
    datasource
      ? gen`providerIdentity: () => ${compileAppProperty(datasource, 'Datasource')}.bindingIdentity(),`
      : gen.noop()
  }
      },
      ${
    design && !AST.isNoneLiteral(design.value)
      ? gen`design: () => ${compileAppProperty(design, 'Design')},`
      : gen.noop()
  }
      auxiliaries: () => ({
        ${
    gen.list(auxiliaries, auxiliary =>
      gen`${gen.jsLiteral(auxiliary.name.slice(1))}: ${Compile.ConfiguredValue(auxiliary.value)},`)
  }
      }),
    })
    function ${gen.Name({ name: `TaoApp_${app.name}` })}() {
      ${gen.list(persistedStates, state => gen`TR.UsePersistedState(${gen.scopeName(state)})`)}
      ${
    datasource
      ? gen`TR.Data.UseConfigured(
          ${gen.scopeName({ name: '_TaoDataCatalog' })},
          ${compileAppProperty(datasource, 'Datasource')},
        )`
      : gen.noop()
  }
      ${compileStudioSubject(options, definition)}
      return <TR.AppShell>
        <TR.Navigation.AppHost app={${gen.Name(definition)}} />
      </TR.AppShell>
    }
    ${gen.scopeName(app)} = ${gen.Name(definition)}
  `
}

function compileStudioSubject(options: CodegenOptions, appDefinition?: { name: string }): Compiled {
  if (!options.studio) {
    return gen.noop()
  }
  const views = options.studioViews ?? []
  return gen`
    const _TaoStudioScenario = TR.Studio.Environment.useScenario()
    const _TaoStudioFixture = TR.Studio.Environment.useFixture(${
    options.studioDataCatalog ? gen.scopeName({ name: '_TaoDataCatalog' }) : 'undefined'
  })
    if (_TaoStudioScenario?.kind === 'view') {
      const _TaoStudioViews: Readonly<Record<string, React.ElementType>> = {
        ${gen.list(views, item => gen`${gen.jsLiteral(item.id)}: ${gen.scopeName(item.view)},`)}
      }
      const _TaoStudioView = _TaoStudioViews[_TaoStudioScenario.subjectId]
      if (_TaoStudioView === undefined) throw new Error('Tao Studio focused view is not available in the selected app scope.')
      if (!_TaoStudioFixture.ready) return null
      const _TaoStudioArgs = Object.fromEntries(
        Object.entries(_TaoStudioScenario.arguments ?? {}).map(([name, value]) => [
          name,
          TR.Studio.Environment.Argument(value, _TaoStudioFixture.handles),
        ]),
      )
      return <TR.AppShell>{React.createElement(_TaoStudioView, ${
    appDefinition === undefined
      ? '_TaoStudioArgs'
      : gen`{ ..._TaoStudioArgs, __tao: { app: ${gen.Name(appDefinition)} } }`
  })}</TR.AppShell>
    }
  `
}

type EffectiveRestorationPolicy = {
  exclusions: Array<'menus' | 'sheets' | 'toasts'>
  mode: 'automatic' | 'fresh'
}

function effectiveRestorationPolicy(
  app: AST.AppValueDeclaration,
  seen: Set<AST.AppValueDeclaration> = new Set(),
): EffectiveRestorationPolicy {
  Assert(!seen.has(app), 'validated app restoration derivation is acyclic')
  seen.add(app)
  if (AST.isAppDeclaration(app) && app.block) {
    return restorationPolicy(
      AST.blockStatements(app).find(AST.isRestorationPolicy),
      { exclusions: [], mode: 'automatic' },
    )
  }
  const expression = app.value
  if (!expression) {
    return { exclusions: [], mode: 'automatic' }
  }
  return effectiveRestorationExpression(expression, seen)
}

function effectiveRestorationExpression(
  expression: AST.Expression,
  seen: Set<AST.AppValueDeclaration>,
): EffectiveRestorationPolicy {
  if (AST.isRefinementExpression(expression)) {
    const target = resolveRef(expression.target)
    Assert.is(target, AST.isAppValueDeclaration, 'validated app restoration refinement resolves an app')
    return restorationPolicy(
      expression.patchBlock.entries.find(entry => entry.restoration)?.restoration,
      effectiveRestorationPolicy(target, seen),
    )
  }
  if (AST.isValueReference(expression)) {
    const target = resolveRef(expression.target)
    Assert.is(target, AST.isAppValueDeclaration, 'validated app restoration reference resolves an app')
    return effectiveRestorationPolicy(target, seen)
  }
  if (
    AST.isPrimitiveConfigurationConstructor(expression)
    || AST.isConfigurationConstructor(expression)
    || AST.isInferredConfigurationConstructor(expression)
  ) {
    return restorationPolicy(
      expression.block?.entries.find(entry => entry.restoration)?.restoration,
      { exclusions: [], mode: 'automatic' },
    )
  }
  return { exclusions: [], mode: 'automatic' }
}

function restorationPolicy(
  policy: AST.RestorationPolicy | undefined,
  fallback: EffectiveRestorationPolicy,
): EffectiveRestorationPolicy {
  if (!policy) {
    return fallback
  }
  return {
    exclusions: (policy.exclusions?.exclusions ?? []) as EffectiveRestorationPolicy['exclusions'],
    mode: policy.mode as EffectiveRestorationPolicy['mode'],
  }
}

function compileLegacyViewApp(app: AST.AppDeclaration, options: CodegenOptions = {}): Compiled {
  const roots = AST.blockStatements(app).filter(AST.isAppView)
  return gen`
    function ${gen.Name({ name: `TaoApp_${app.name}` })}() {
      ${compileStudioSubject(options)}
      ${gen.list(roots, Compile.AppView)}
    }
  `
}

function isLegacyViewApp(app: AST.AppDeclaration): boolean {
  return app.block !== undefined && AST.blockStatements(app).some(AST.isAppView)
}

function effectiveAppConfiguration(
  declaration: AST.AppValueDeclaration,
  seen: Set<AST.AppValueDeclaration> = new Set(),
): EffectiveAppConfiguration {
  Assert(!seen.has(declaration), 'validated app derivation is acyclic')
  seen.add(declaration)
  if (AST.isAppDeclaration(declaration) && declaration.block) {
    const configuration: EffectiveAppConfiguration = new Map()
    for (const property of AST.blockStatements(declaration).filter(AST.isAppProperty)) {
      if (property.patch) {
        applyAppPropertyPatch(configuration, property.name, property.patch.block)
      } else if (property.value) {
        configuration.set(property.name, { patches: [], value: property.value })
      }
    }
    return configuration
  }
  const expression = declaration.value
  Assert.defined(expression, 'validated app value has an initializer')
  return effectiveAppExpression(expression, seen)
}

function effectiveAppExpression(
  expression: AST.Expression,
  seen: Set<AST.AppValueDeclaration>,
): EffectiveAppConfiguration {
  if (AST.isPrimitiveConfigurationConstructor(expression)) {
    Assert(expression.primitive === 'app', 'validated app primitive constructor has the app family')
    const configuration: EffectiveAppConfiguration = new Map()
    applyConfigurationBlock(configuration, expression.block)
    return configuration
  }
  if (AST.isConfigurationConstructor(expression)) {
    const declaration = resolveRef(expression.type)
    Assert.is(declaration, isConfigurableDeclaration, 'validated app constructor resolves a configurable type')
    Assert(
      AST.configurationPrimitiveOf(declaration) === 'app',
      'validated app constructor resolves an app type',
    )
    const configuration = configurationDefaults(declaration)
    Assert.defined(expression.block, 'validated app type construction has a block')
    applyConfigurationBlock(configuration, expression.block)
    return configuration
  }
  if (AST.isInferredConfigurationConstructor(expression)) {
    const owner = expression.$container
    Assert.is(owner, AST.isAliasDeclaration, 'inferred app construction is owned by a let declaration')
    const declaration = typeDeclarationForInferredApp(owner)
    const configuration = configurationDefaults(declaration)
    applyConfigurationBlock(configuration, expression.block)
    return configuration
  }
  if (AST.isRefinementExpression(expression) || AST.isValueReference(expression)) {
    const target = resolveRef(expression.target)
    Assert.is(target, AST.isAppValueDeclaration, 'validated app reference resolves a complete app value')
    const configuration = effectiveAppConfiguration(target, seen)
    if (AST.isRefinementExpression(expression)) {
      applyConfigurationBlock(configuration, expression.patchBlock)
    }
    return configuration
  }
  return Assert.never(expression as never, 'validated app value uses a supported declaration initializer')
}

function typeDeclarationForInferredApp(owner: AST.AliasDeclaration): AST.ConfigurableDeclaration {
  const declaration = Type.visibleDeclaration(owner, owner.name)
  Assert.defined(declaration, 'validated inferred app block resolves its same-name type')
  Assert.is(declaration, isConfigurableDeclaration, 'validated inferred app block resolves a configurable type')
  Assert(
    AST.configurationPrimitiveOf(declaration) === 'app',
    'validated inferred app block resolves its same-name app type',
  )
  return declaration
}

function configurationDefaults(declaration: AST.ConfigurableDeclaration): EffectiveAppConfiguration {
  const configuration: EffectiveAppConfiguration = new Map()
  for (const property of AST.configurationPropertiesOf(declaration)) {
    if (property.value) {
      configuration.set(property.name, { patches: [], value: property.value })
    }
  }
  return configuration
}

function applyConfigurationBlock(
  configuration: EffectiveAppConfiguration,
  block: AST.ConfigurationBlock,
): void {
  for (const entry of block.entries) {
    if (!entry.name || !entry.value) {
      continue
    }
    if (AST.isPropertyConfigurationPatch(entry.value)) {
      applyAppPropertyPatch(configuration, entry.name, entry.value.block)
    } else {
      configuration.set(entry.name, { patches: [], value: entry.value })
    }
  }
}

function applyAppPropertyPatch(
  configuration: EffectiveAppConfiguration,
  name: string,
  patch: AST.ConfigurationBlock,
): void {
  const property = configuration.get(name)
  Assert.defined(property, 'validated app property patch has a base value')
  property.patches.push(patch)
}

function compileAppProperty(
  property: EffectiveAppProperty,
  name: 'Name' | 'Navigator' | 'Datasource' | 'Design',
): Compiled {
  let result = compileAppPropertySource(property.value)
  for (const patch of property.patches) {
    if (name === 'Navigator') {
      result = gen`TR.Navigation.Patch(${result}, ${Compile.ConfigurationPatchObject(patch)})`
    } else if (name === 'Datasource') {
      result = gen`TR.Data.Patch(${result}, ${Compile.ConfigurationPatchObject(patch)})`
    } else {
      Assert(false, `validated app ${name} cannot be patched`)
    }
  }
  return result
}

function compileAppPropertySource(value: AppPropertySource): Compiled {
  return AST.isExpression(value) ? Compile.Expression(value) : Compile.ConfigurationValue(value)
}

function rootAuxiliaryNavigators(root: AST.AppValueDeclaration): AST.AppAuxiliaryNavigator[] {
  return AST.isAppDeclaration(root)
    ? AST.blockStatements(root).filter(AST.isAppAuxiliaryNavigator)
    : []
}

/** appDefinitionReference preserves each app value's generated module identity. */
export function appDefinitionReference(app: AST.AppValueDeclaration): Compiled {
  return gen.scopeName(app)
}

function compilePrimitiveBlock(declaration: AST.NavDeclaration | AST.DatasourceDeclaration): Compiled {
  Assert.defined(declaration.block, 'parsed primitive value declaration has a value or block')
  const constructor = {
    $type: 'PrimitiveConfigurationConstructor',
    primitive: AST.isNavDeclaration(declaration) ? 'nav' : 'datasource',
    block: declaration.block,
    $container: declaration,
  } as unknown as AST.PrimitiveConfigurationConstructor
  return Compile.PrimitiveConfigurationConstructor(constructor)
}

function isConfigurableDeclaration(value: unknown): value is AST.ConfigurableDeclaration {
  return AST.isNode(value) && AST.isConfigurableDeclaration(value)
}

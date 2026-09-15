import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type CodegenOptions, type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import { configureActionInstrumentation } from './action-control-flow'
import { activeDataStorePlan } from './data-store-context'
import { canonicalDeclaration, compileDeclarationIdentity } from './declaration-identity'
import { configuredDeclarationOfValue } from './ExpressionsCompiler'

export const AppCompiler = {
  /** App compiles complete primitive-headed app values, including the root-view Navigator sugar. */
  App(app: AST.AppDeclaration, options: CodegenOptions = {}): Compiled {
    configureActionInstrumentation(options.debug === true)
    return compileAppValue(app, options)
  },

  /** AppValue compiles an inferred `let` whose value family is app. */
  AppValue(app: AST.AppValueDeclaration): Compiled {
    configureActionInstrumentation(false)
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
} as const

function compileAppValue(app: AST.AppValueDeclaration, options: CodegenOptions = {}): Compiled {
  const configuration = ASTUtils.effectiveAppConfiguration(app)
  const navigator = configuration.get('Navigator')
  Assert.defined(navigator, 'validated app value has a Navigator')
  const name = configuration.get('Name')
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
  const selectedDatasourceConfiguration = app.name === options.selectedAppName
    ? options.selectedAppDatasourceConfiguration
    : undefined
  const datasources = compileAppDatasourceBindings(app, selectedDatasourceConfiguration)
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
    // Restoration keys saved navigation state by the providers it was written against. An app with one
    // store keeps the identity it always had; an app with several lists them all, so changing any one
    // member's configuration starts restoration afresh rather than restoring handles it cannot resolve.
    datasources.length === 1
      ? gen`providerIdentity: () => ${datasources[0]!.compiled}.bindingIdentity(),`
      : datasources.length > 1
      // A member whose identity cannot be represented leaves the whole app unkeyed, exactly as a
      // single unrepresentable store does: restoring against a provider that cannot be recognised
      // again would restore handles into the wrong data.
      ? gen`providerIdentity: () => TR.Data.CombinedIdentity([${
        gen.join(datasources, binding => gen`${binding.compiled}.bindingIdentity()`, { separator: ', ' })
      }]),`
      : gen.noop()}
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
    gen.list(
      datasources,
      binding =>
        gen`TR.Data.UseConfigured(
          ${gen.scopeName({ name: binding.catalog })},
          ${binding.compiled},
          ${binding.storageName === undefined ? gen.noop() : gen`${gen.jsLiteral(binding.storageName)},`}
        )`,
    )
  }
      ${
    options.localDataCatalog
      ? gen`TR.Data.UseConfigured(
          ${gen.scopeName({ name: '_TaoLocalDataCatalog' })},
          ${gen.scopeName({ name: '_TaoLocalDatasource' })},
        )`
      : gen.noop()
  }
      ${compileStudioSubject(options, app)}
      return <TR.AppShell>
        <TR.Navigation.AppHost app={${gen.Name(definition)}} />
      </TR.AppShell>
    }
    ${compileStudioSubjects(options, app, definition)}
    ${gen.scopeName(app)} = ${gen.Name(definition)}
  `
}

/**
 * The emitted subject lookup fails through `TR.Errors.failInvariant`: this is generated app code,
 * not compiler code, so the only Tao module in scope is `TR` from `@runtime/TR`, and `TR.Errors` is
 * where the runtime publishes its error taxonomy to a compiled program. A call through that property
 * chain returns `never` without narrowing afterwards, so the guard reads as `??` rather than an
 * `if`, which keeps the entry a defined factory for `TR.Studio.SubjectHost` below.
 */
function compileStudioSubject(options: CodegenOptions, app: { name: string }): Compiled {
  if (!options.studio) {
    return gen.noop()
  }
  return gen`
    const _TaoStudioScenario = TR.Studio.Environment.useScenario()
    const _TaoStudioFixture = TR.Studio.Environment.useFixture(${
    options.studioDataCatalog ? compileStudioStores() : 'undefined'
  })
    if (_TaoStudioScenario?.kind === 'view') {
      const _TaoStudioSubject = ${gen.Name(studioSubjectsName(app))}[_TaoStudioScenario.subjectId]
        ?? TR.Errors.failInvariant('Tao Studio focused view is not available in the selected app scope.')
      if (!_TaoStudioFixture.ready) return null
      const _TaoStudioArgs = Object.fromEntries(
        Object.entries(_TaoStudioScenario.arguments ?? {}).map(([name, value]) => [
          name,
          TR.Studio.Environment.Argument(value, _TaoStudioFixture.handles),
        ]),
      )
      return <TR.AppShell><TR.Studio.SubjectHost arguments={_TaoStudioArgs} definition={_TaoStudioSubject} /></TR.AppShell>
    }
  `
}

/**
 * compileStudioStores lists every store a fixture may seed. An app with one datasource has one store,
 * and passing the default catalog by name missed every collection a `Data` slot moved elsewhere.
 */
function compileStudioStores(): Compiled {
  const plan = activeDataStorePlan()
  Assert.defined(plan, 'a Studio compile with a data catalog has a store plan')
  const stores = plan.stores.filter(store => store.kind !== 'device')
  return gen`[${gen.join(stores, store => gen`${gen.scopeName({ name: store.binding })}`, { separator: ', ' })}]`
}

/**
 * One app definition per focusable view, so a `render ViewName(...)` scenario mounts its view under
 * a navigator instead of bare.
 *
 * A focused view is allowed to `present`, and in the app there is always a navigator above it to
 * present into; without one the cell died on the first tap. The shape here is the one
 * `app Name { View Something }` already compiles to — a slot navigator holding the view — so the
 * behavior is the app's own rather than a preview imitation of it.
 *
 * The entries are factories, and they sit at module scope. Factories because each one resolves a
 * registered view, which a value built beside the app definition would try to do before the view
 * registrations exist; module scope because the app component would otherwise rebuild every app
 * definition in the project on every render of a cell that uses one of them.
 */
function compileStudioSubjects(
  options: CodegenOptions,
  app: AST.AppValueDeclaration,
  appDefinition: { name: string },
): Compiled {
  if (!options.studio) {
    return gen.noop()
  }
  const views = options.studioViews ?? []
  return gen`
    const ${gen.Name(studioSubjectsName(app))}: Readonly<
      Record<string, (subjectArguments: TR.NavigationArguments) => TR.AppDefinition>
    > = {
      ${
    gen.list(views, item =>
      gen`${gen.jsLiteral(item.id)}: subjectArguments => ({
        auxiliaries: () => ({}),
        declaration: TR.Navigation.AppDeclaration(
          ${gen.Name(appDefinition)}.definition.name,
          ${compileDeclarationIdentity(app, { kind: 'studio-subject-app' })},
        ),
        design: () => ${gen.Name(appDefinition)}.design,
        name: ${gen.Name(appDefinition)}.definition.name,
        navigator: () =>
          TR.Navigation.Configure(
            TR.Navigation.Declaration(
              ${gen.jsLiteral(canonicalDeclaration(item.view).name)},
              TR.NavKind.Slot(),
              ${compileDeclarationIdentity(item.view, { kind: 'studio-subject-nav' })},
            ),
            {
              "Initial": TR.Navigation.BindView(
                TR.Navigation.ViewReference(${compileDeclarationIdentity(item.view)}),
                subjectArguments,
              ),
            },
          ),
        restoration: { exclusions: [], mode: 'fresh' as const, variant: ${gen.jsLiteral(app.name)} },
      }),`)
  }
    }
  `
}

/** The module-scope binding holding one app's focusable-view definitions. */
function studioSubjectsName(app: { name: string }): { name: string } {
  return { name: `_TaoStudioSubjects_${app.name}` }
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

function compileAppProperty(
  property: ASTUtils.EffectiveAppProperty,
  name: 'Name' | 'Navigator' | 'Design',
): Compiled {
  Assert.defined(property.value, `validated app ${name} supplies a value`)
  let result = compileAppPropertySource(property.value)
  for (const patch of property.patches) {
    Assert(name === 'Navigator', `validated app ${name} cannot be patched`)
    result = gen`TR.Navigation.Patch(${result}, ${Compile.ConfigurationPatchObject(patch)})`
  }
  return result
}

/** CompiledDatasourceBinding pairs one mounted store's catalog binding with the datasource filling it. */
type CompiledDatasourceBinding = {
  catalog: string
  compiled: Compiled
  /** storageName is the bound declaration's name, passed only for a store a `Data` slot declares. */
  storageName?: string
}

/**
 * compileAppDatasourceBindings mounts one datasource per store the app binds. A patch written on
 * the listed name (`Personal with { … }`), a slot patch, and the ship-time release override all layer
 * onto the same configured value, so the app holds its own copy and the declaration is never mutated.
 *
 * A datasource that declares membership fills the store its `Data` names, and passes its own name as
 * the storage key that store defaults to. One that declares none fills the default store and keeps the
 * `Data` key every single-datasource app has always used, so no existing store moves.
 */
function compileAppDatasourceBindings(
  app: AST.AppValueDeclaration,
  datasourceConfiguration: Readonly<Record<string, string>> | undefined,
): readonly CompiledDatasourceBinding[] {
  const plan = activeDataStorePlan()
  const bindings = ASTUtils.appBoundDatasources(app)
  if (bindings.length === 0) {
    return []
  }
  Assert.defined(plan, 'an app that binds a datasource has a store plan')
  return bindings.flatMap(binding => {
    const source = binding.value
      ? compileAppPropertySource(binding.value)
      : binding.declaration
      ? Compile.ValueDeclarationReference(binding.declaration)
      : undefined
    Assert.defined(source, 'validated datasource binding names a declaration or supplies a value')
    const claims = binding.declaration && ASTUtils.datasourceCollectionNames(binding.declaration) !== undefined
    const store = claims ? ASTUtils.storeOfDatasource(plan, binding.declaration!) : plan.defaultStore
    // A catch-all in a project whose datasources claim everything has nothing left to hold.
    if (!claims && store === undefined) {
      return []
    }
    Assert.defined(store, 'validated datasource with membership fills a planned store')
    let compiled = source
    for (const patch of binding.patches) {
      compiled = gen`TR.Data.Patch(${compiled}, ${Compile.ConfigurationPatchObject(patch)})`
    }
    const release = releaseConfigurationFor(binding, datasourceConfiguration)
    if (Object.keys(release).length > 0) {
      compiled = gen`TR.Data.Patch(${compiled}, {
        ${
        gen.list(
          Object.entries(release).toSorted(([left], [right]) => left.localeCompare(right)),
          ([key, value]) => gen`${gen.jsLiteral(key)}: TR.Value(${gen.jsLiteral(value)}),`,
        )
      }
      })`
    }
    return [{
      catalog: store.binding,
      compiled,
      ...claims ? { storageName: binding.declaration!.name } : {},
    }]
  })
}

/**
 * The ship pipeline's release override replaces a hosted datasource's development endpoints. It is
 * keyed by configuration slot, so it reaches only a bound datasource whose contract declares those
 * slots: InstantDB's keys land on the InstantDB store and never on a CloudKit store bound beside it.
 */
function releaseConfigurationFor(
  binding: ASTUtils.AppDatasourceBinding,
  configuration: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (!configuration) {
    return {}
  }
  const declaration = configurableDeclarationOf(binding)
  const slots = new Set(declaration ? AST.configurationPropertiesOf(declaration).map(property => property.name) : [])
  return Object.fromEntries(Object.entries(configuration).filter(([key]) => slots.has(key)))
}

function configurableDeclarationOf(binding: ASTUtils.AppDatasourceBinding): AST.ConfigurableDeclaration | undefined {
  const value = binding.value
  if (value && !AST.isAppView(value) && AST.isExpression(value)) {
    if (AST.isConfigurationConstructor(value)) {
      const target = value.type.ref
      return target && AST.isConfigurableDeclaration(target) ? target : undefined
    }
    if (AST.isValueReference(value) || AST.isRefinementExpression(value)) {
      const target = value.target.ref
      return target && AST.isValueDeclaration(target) ? configuredDeclarationOfValue(target) : undefined
    }
    return undefined
  }
  return binding.declaration ? configuredDeclarationOfValue(binding.declaration) : undefined
}

function compileAppPropertySource(value: ASTUtils.AppPropertySource): Compiled {
  if (AST.isAppView(value)) {
    return compileRootViewNavigator(value)
  }
  return AST.isExpression(value) ? Compile.Expression(value) : Compile.ConfigurationValue(value)
}

/**
 * `app X { view Y(args) }` is sugar for mounting Y, bound to its arguments, in a slot navigator. The
 * navigator is generated inline from the runtime's own slot implementation so it owns no Tao name a
 * declaration could collide with. A bound argument stays live, exactly as `Initial Y(args)` binds
 * one, which is how a shell receives the navigator it renders and a variant hands it another.
 *
 * It still carries a canonical identity, because a synthesized navigator is a real navigator on a
 * real device: without one the runtime emits no restorable descriptor and every launch silently
 * gives up on restoring where the person was.
 *
 * That identity is derived from the `app` declaration that writes the sugar — the app block, or the
 * variant whose patch rebinds the root — under the reserved kind `app-root-view-nav`:
 *
 * - It is stable. The app declaration is the sugar's authored owner — exactly one root view
 *   statement per app block — and its project, package, module path, and name are already the inputs
 *   to the app's own identity, which keys the restoration storage this descriptor is stored under.
 *   The navigator therefore depends on no file layout the stored state does not already depend on,
 *   and the two can never drift apart under a move or a rename.
 * - Deriving it from the mounted view instead would move the identity whenever the app switched
 *   which view it opens, or the view was renamed or moved — incidental changes that must not be
 *   allowed to orphan a person's saved position under a name the app never claimed.
 * - It cannot collide. `declarationKind` only ever yields a single lowercase word (`view`, `app`,
 *   `nav`, `datasource`, `configuration`) or a PascalCase grammar `$type`, so a hyphenated kind is
 *   unreachable from any authored declaration. It is distinct from the app's own `app` identity, from
 *   the view identity used for `ViewReference` on the next line, and from a `nav Name` declared
 *   beside the app in the same module.
 */
function compileRootViewNavigator(appView: AST.AppView): Compiled {
  const view = resolveRef(appView.view)
  const app = rootViewOwner(appView)
  const resolved = ASTUtils.resolveArgumentBindings(view, appView)
  Assert(resolved.diagnostics.length === 0, 'validated root view has no binding diagnostics')
  const reference = gen`TR.Navigation.ViewReference(${compileDeclarationIdentity(view)})`
  const initial = resolved.pairs.length === 0
    ? reference
    : gen`TR.Navigation.BindView(
        ${reference},
        { ${gen.list(resolved.pairs, Compile.BoundViewArgument)} },
      )`
  return gen`TR.Navigation.Configure(
    TR.Navigation.Declaration(
      ${gen.jsLiteral(view.name)},
      TR.NavKind.Slot(),
      ${compileDeclarationIdentity(app, { kind: 'app-root-view-nav' })},
    ),
    { "Initial": ${initial} },
  )`
}

/** rootViewOwner is the app value whose block or patch writes one root view statement. */
function rootViewOwner(appView: AST.AppView): AST.AppValueDeclaration {
  let current: AST.Node | undefined = appView.$container
  while (current && !AST.isAppValueDeclaration(current)) {
    current = current.$container
  }
  Assert.defined(current, 'validated root view statement is owned by an app value')
  return current
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

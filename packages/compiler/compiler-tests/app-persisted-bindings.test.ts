import { Workspace } from '@compiler/workspace'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { TestCompiler } from './test-compile'

const tsFence = '```ts'
const fence = '```'

Describe('app persisted binding compilation', () => {
  Test('initializes a forward-declared same-module base before its derived app', async () => {
    const compiled = await TestCompiler.compileCode(
      `
      app Variant = Base with { id "com.tao.variant", version "1.0.0" }
      app Final = Variant with { id "com.tao.final", version "1.0.0" }
      let Marker is number = 10
      app Base { id "com.tao.base" version "1.0.0" name "Base" view Empty }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `,
      { appName: 'Variant' },
    )
    Expect(compiled.validation.diagnostics).toEqual([])
    const marker = compiled.code.indexOf('_Scope.Marker =')
    const start = compiled.code.indexOf('const _TaoAppModuleScope_Base')
    const variantStart = compiled.code.indexOf('const _TaoAppModuleScope_Variant')
    const finalStart = compiled.code.indexOf('const _TaoAppModuleScope_Final')
    const end = compiled.code.indexOf('_Scope.Empty = function', start)
    Expect(marker).toBeGreaterThanOrEqual(0)
    Expect(start).toBeGreaterThan(marker)
    Expect(start).toBeGreaterThanOrEqual(0)
    Expect(variantStart).toBeGreaterThan(start)
    Expect(finalStart).toBeGreaterThan(variantStart)
    Expect(end).toBeGreaterThan(start)
    const generated = new Bun.Transpiler({ loader: 'tsx' }).transformSync(compiled.code.slice(marker, end))
    const scope: Record<string, unknown> = {}
    const runtime = {
      Value: (value: unknown) => ({ evaluate: () => ({ jsValue: value }) }),
      Alias: (read: () => unknown) => ({ evaluate: read }),
      Navigation: {
        Identity: (identity: unknown) => identity,
        AppDeclaration: (name: string, identity: unknown) => ({ name, identity }),
        App: (definition: { declaration: unknown }) => ({ definition, declaration: definition.declaration }),
      },
    }
    new Function('_Scope', 'TR', generated)(scope, runtime)
    const base = scope['Base'] as { declaration: unknown }
    const variant = scope['Variant'] as { declaration: unknown; definition: { id: string } }
    const final = scope['Final'] as { declaration: unknown; definition: { id: string } }
    Expect(scope['Marker']).toBeDefined()
    Expect(variant.declaration).toBe(base.declaration)
    Expect(variant.definition.id).toBe('com.tao.variant')
    Expect(final.declaration).toBe(base.declaration)
    Expect(final.definition.id).toBe('com.tao.final')
  })

  Test('keeps a sibling view module binding separate from colliding app state', async () => {
    const compiled = await TestCompiler.compileCode(`
      use StackNav from @tao/nav
      let Width is number = 10
      action ChangeWidth() { }
      project app Base { id "com.tao.base" version "1.0.0"
        name "Base"
        state Width is number = 320 (persist)
        action ChangeWidth() { set Width = 321 }
        Navigator StackNav { Initial Home }
      }
      scene Home() { Title "Home" render Probe() }
      view Probe() { render Pair(Width, ChangeWidth) }
      view Pair(Value number, Change action()) { render inject Value ${tsFence} return Value ${fence} }
    `)
    const start = compiled.code.indexOf('_Scope.Probe = function')
    const end = compiled.code.indexOf('_Scope.Pair = function', start)
    Expect(start).toBeGreaterThanOrEqual(0)
    Expect(end).toBeGreaterThan(start)
    const generatedView = new Bun.Transpiler({ loader: 'tsx' }).transformSync(compiled.code.slice(start, end))
    const jsxFactory = generatedView.match(/\bjsxDEV_[a-z0-9]+\b/)?.[0]
    Expect(jsxFactory).toBeDefined()
    const moduleAction = { evaluate: () => ({ jsValue: 'module action' }) }
    const appAction = { evaluate: () => ({ jsValue: 'app action' }) }
    const moduleScope = {
      Width: { evaluate: () => ({ jsValue: 10 }) },
      ChangeWidth: moduleAction,
      Pair: () => undefined,
    }
    const appScope = { Width: { evaluate: () => ({ jsValue: 320 }) }, ChangeWidth: appAction }
    const mountedProps = { app: { definition: { bindingScopes: new Map([[moduleScope, appScope]]) } } }
    const runtime = {
      AssertViewDepth: () => undefined,
      Interaction: { UseOccurrence: () => undefined },
      UseActionOwner: () => undefined,
      Auth: { UseOptionalContext: () => undefined },
      BlockScope: (scope: object, body: (child: object) => unknown) => body(Object.create(scope)),
      AppScope: (_props: unknown, _scope: object) => appScope,
      Readonly: (value: unknown) => value,
      Alias: (read: () => unknown) => ({ evaluate: read }),
      TaoContext: () => ({}),
      ViewTaoProps: () => ({}),
    }
    const createElement = (_view: unknown, props: {
      Value: { evaluate(): { jsValue: number } }
      Change: { evaluate(): { jsValue: string } }
    }) => props
    const probe = new Function('_Scope', 'TR', jsxFactory!, '_TaoOutline', `${generatedView}\nreturn _Scope.Probe`)(
      moduleScope,
      runtime,
      createElement,
      {},
    ) as (props: unknown) => {
      Value: { evaluate(): { jsValue: number } }
      Change: { evaluate(): { jsValue: string } }
    }
    const rendered = probe({ __tao: mountedProps })
    Expect(rendered.Value.evaluate().jsValue).toBe(10)
    Expect(rendered.Change.evaluate().jsValue).toBe('module action')
  })

  Test('binds a base and same-module variant to independent state and action scopes', async () => {
    const compiled = await TestCompiler.compileCode(
      `
      use StackNav from @tao/nav
      project app Base { id "com.tao.base" version "1.0.0"
        name "Base"
        state Width is number = 320 (persist)
        action ChangeWidth(Value number) { set Width = Value }
        Navigator StackNav { Initial Home(Width: Width, ChangeWidth: ChangeWidth) }
      }
      app Variant = Base with { id "com.tao.variant", version "2.0.0" }
      scene Home(Width number, ChangeWidth action(number)) { Title "Home" render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `,
      { appName: 'Variant' },
    )
    const code = compiled.code

    Expect(code).toContain('function _TaoBindApp_Base(_TaoAppId: string)')
    Expect(code).toContain('function _TaoBindApp_Variant(_TaoAppId: string)')
    Expect(code).toContain('const _TaoBaseBinding = _TaoBindApp_Base(_TaoAppId)')
    Expect(code).toContain('_TaoBindApp_Base("com.tao.base")')
    Expect(code).toContain('_TaoBindApp_Variant("com.tao.variant")')
    Expect(code).toContain('TR.PersistedState(')
    Expect(code).toContain('_TaoAppId,')
    Expect(code).toContain('TR.BlockScope(_Scope, _Scope => {')
  })

  Test('resolves a same-module variant override against its authored module bindings', async () => {
    const compiled = await TestCompiler.compileCode(
      `
      use StackNav from @tao/nav
      let Width is number = 10
      action ChangeWidth() { }
      project app Base { id "com.tao.base" version "1.0.0"
        name "Base"
        state Width is number = 320 (persist)
        action ChangeWidth() { set Width = 321 }
        Navigator StackNav { Initial Home(Width: Width, ChangeWidth: ChangeWidth) }
      }
      app Variant = Base with { id "com.tao.variant", version "2.0.0"
        Navigator StackNav { Initial Preview(Width: Width, ChangeWidth: ChangeWidth) }
      }
      scene Home(Width number, ChangeWidth action()) { Title "Home" render Empty() }
      scene Preview(Width number, ChangeWidth action()) { Title "Preview" render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `,
      { appName: 'Variant' },
    )
    const moduleWidth = { evaluate: () => ({ jsValue: 10 }) }
    const moduleAction = { evaluate: () => ({ jsValue: 'module action' }) }
    const baseWidth = { evaluate: () => ({ jsValue: 320 }) }
    const baseAction = { evaluate: () => ({ jsValue: 'base action' }) }
    const moduleScope = { Width: moduleWidth, ChangeWidth: moduleAction, __tao_type_StackNav: {} }
    const baseBinding = {
      scope: { Width: baseWidth, ChangeWidth: baseAction },
      navigator: () => ({ Initial: { Width: baseWidth, ChangeWidth: baseAction } }),
      auxiliaries: () => ({}),
      useSetup: () => undefined,
      name: () => 'Base',
      design: () => undefined,
      auth: () => undefined,
      agentCommands: () => [],
      datasources: () => [],
    }
    const start = compiled.code.indexOf('function _TaoBindApp_Variant')
    const end = compiled.code.indexOf('const _TaoBoundApp_Variant', start)
    Expect(start).toBeGreaterThanOrEqual(0)
    Expect(end).toBeGreaterThan(start)
    const generated = new Bun.Transpiler({ loader: 'ts' }).transformSync(compiled.code.slice(start, end))
    const runtime = {
      Navigation: {
        Configure: (_type: unknown, configuration: unknown) => configuration,
        BindView: (_view: unknown, arguments_: unknown) => arguments_,
        ViewReference: (identity: unknown) => identity,
        Identity: (identity: unknown) => identity,
      },
      Readonly: (value: unknown) => value,
      Alias: (read: () => unknown) => ({ evaluate: read }),
      Value: (value: unknown) => ({ evaluate: () => ({ jsValue: value }) }),
    }
    const appIds: string[] = []
    const bind = new Function(
      '_TaoAppModuleScope_Variant',
      '_TaoBindApp_Base',
      'TR',
      `${generated}\nreturn _TaoBindApp_Variant`,
    )(
      moduleScope,
      (appId: string) => {
        appIds.push(appId)
        return baseBinding
      },
      runtime,
    ) as (appId: string) => {
      navigator(): {
        Initial: { Width: { evaluate(): { jsValue: number } }; ChangeWidth: { evaluate(): { jsValue: string } } }
      }
    }
    const initial = bind('com.tao.variant').navigator().Initial
    Expect(initial.Width.evaluate().jsValue).toBe(10)
    Expect(initial.ChangeWidth.evaluate().jsValue).toBe('module action')
    Expect(appIds).toEqual(['com.tao.variant'])
  })

  Test('rebinds an imported app base using the variant ID in its owning module', async () => {
    await withTaoFiles('tao-app-persisted-binding-', {
      'Package.tao': 'package { version "1.0.0" license AGPL-3.0-only }',
      'Main.tao': `
        use Base from ./Base.tao
        use StackNav from @tao/nav
        app Variant = Base with {
          id "com.tao.variant", version "2.0.0"
          Navigator StackNav { Initial Preview }
        }
        view Preview() { render inject ${tsFence} return null ${fence} }
      `,
      'Base.tao': `
        use StackNav from @tao/nav
        project app Base { id "com.tao.base" version "1.0.0"
          name "Base"
          state Width is number = 320 (persist)
          action ChangeWidth(Value number) { set Width = Value }
          Navigator StackNav { Initial Home(Width: Width, ChangeWidth: ChangeWidth) }
        }
        scene Home(Width number, ChangeWidth action(number)) { Title "Home" render Empty() }
        view Empty() { render inject ${tsFence} return null ${fence} }
      `,
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao'], { appName: 'Variant' })
      const entry = result.files.find(file => file.sourcePath === paths['Main.tao'])
      const base = result.files.find(file => file.sourcePath === paths['Base.tao'])
      Expect(entry).toBeDefined()
      Expect(base).toBeDefined()
      Expect(entry!.code).toContain('_TaoAppModuleScope_Variant.Base.definition.bindApp!(_TaoAppId)')
      Expect(entry!.code).toContain('const _Scope = Object.create(_TaoAppModuleScope_Variant)')
      Expect(entry!.code).toContain('_TaoBindApp_Variant("com.tao.variant")')
      Expect(entry!.code).toContain('TR.Navigation.Configure(_Scope.__tao_type_StackNav')
      Expect(base!.code).toContain('TR.BlockScope(_Scope, _Scope => {')
    })
  })

  Test('keeps variant module bindings distinct from inherited base app bindings', async () => {
    await withTaoFiles('tao-app-variant-module-collision-', {
      'Package.tao': 'package { version "1.0.0" license AGPL-3.0-only }',
      'Main.tao': `
        use Base from ./Base.tao
        use StackNav from @tao/nav
        let Width is number = 10
        action ChangeWidth() { }
        app Variant = Base with {
          id "com.tao.variant", version "2.0.0"
          Navigator StackNav { Initial Preview(Width: Width, ChangeWidth: ChangeWidth) }
        }
        app Inherited = Base with { id "com.tao.inherited", version "2.0.0" }
        scene Preview(Width number, ChangeWidth action()) { Title "Preview" render Empty() }
        view Empty() { render inject ${tsFence} return null ${fence} }
      `,
      'Base.tao': `
        use StackNav from @tao/nav
        project app Base { id "com.tao.base" version "1.0.0"
          name "Base"
          state Width is number = 320 (persist)
          action ChangeWidth() { set Width = 321 }
          Navigator StackNav { Initial Home(Width: Width, ChangeWidth: ChangeWidth) }
        }
        scene Home(Width number, ChangeWidth action()) { Title "Home" render Empty() }
        view Empty() { render inject ${tsFence} return null ${fence} }
      `,
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao'], { appName: 'Variant' })
      const entry = result.files.find(file => file.sourcePath === paths['Main.tao'])
      Expect(entry).toBeDefined()
      const moduleWidth = { evaluate: () => ({ jsValue: 10 }) }
      const moduleAction = { evaluate: () => ({ jsValue: 'module action' }) }
      const baseWidth = { evaluate: () => ({ jsValue: 320 }) }
      const baseAction = { evaluate: () => ({ jsValue: 'base action' }) }
      const baseNavigator = { Width: baseWidth, ChangeWidth: baseAction }
      const appIds: string[] = []
      const baseBinding = {
        scope: { Width: baseWidth, ChangeWidth: baseAction },
        navigator: () => baseNavigator,
        auxiliaries: () => ({}),
        useSetup: () => undefined,
      }
      const moduleScope = {
        Base: {
          definition: {
            bindApp: (appId: string) => {
              appIds.push(appId)
              return baseBinding
            },
          },
        },
        __tao_type_StackNav: {},
        Width: moduleWidth,
        ChangeWidth: moduleAction,
      }
      const runtime = {
        Navigation: {
          Configure: (_type: unknown, configuration: unknown) => configuration,
          BindView: (_view: unknown, arguments_: unknown) => arguments_,
          ViewReference: (identity: unknown) => identity,
          Identity: (identity: unknown) => identity,
        },
        Readonly: (value: unknown) => value,
        Alias: (read: () => unknown) => ({ evaluate: read }),
      }
      const binding = (name: string) => {
        const start = entry!.code.indexOf(`function _TaoBindApp_${name}`)
        const end = entry!.code.indexOf(`const _TaoBoundApp_${name}`, start)
        Expect(start).toBeGreaterThanOrEqual(0)
        Expect(end).toBeGreaterThan(start)
        const generated = new Bun.Transpiler({ loader: 'ts' }).transformSync(entry!.code.slice(start, end))
        return new Function(`_TaoAppModuleScope_${name}`, 'TR', `${generated}\nreturn _TaoBindApp_${name}`)(
          moduleScope,
          runtime,
        ) as (appId: string) => {
          scope: typeof moduleScope
          navigator(): {
            Initial: { Width: { evaluate(): { jsValue: number } }; ChangeWidth: { evaluate(): { jsValue: string } } }
          }
        }
      }
      const variant = binding('Variant')('com.tao.variant')
      Expect(variant.scope.Width).toBe(moduleWidth)
      Expect(variant.scope.ChangeWidth).toBe(moduleAction)
      const initial = variant.navigator().Initial
      Expect(initial.Width.evaluate().jsValue).toBe(10)
      Expect(initial.ChangeWidth.evaluate().jsValue).toBe('module action')
      const inherited = binding('Inherited')('com.tao.inherited')
      Expect(inherited.navigator()).toBe(baseNavigator)
      Expect(appIds).toEqual(['com.tao.variant', 'com.tao.inherited'])
    })
  })
})

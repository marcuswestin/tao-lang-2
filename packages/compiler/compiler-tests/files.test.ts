import { Workspace } from '@compiler/workspace'
import { Assert, Errors } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import Compiler, { type CompiledFile } from '../compiler-src/compiler'
import { TestCompiler } from './test-compile'

const tsFence = '```ts'
const fence = '```'

/** navSidecar writes the TypeScript half of one `nav <Export> from ./<Export>.ts` implementation. */
function navSidecar(exportName: string): string {
  return [
    "import TR from '@runtime/TR'",
    '',
    `export function ${exportName}() {`,
    '  return TR.NavKind.Stack()',
    '}',
  ].join('\n')
}

/** providerSidecar writes the TypeScript half of one `provider <Export> from ./<Export>.ts`. */
function providerSidecar(exportName: string): string {
  return [
    "import type TR from '@runtime/TR'",
    '',
    `export function ${exportName}(): TR.DataProvider {`,
    '  return {',
    '    connect: () => ({ load: () => undefined, save: () => {} }),',
    '  }',
    '}',
  ].join('\n')
}

Describe('compiler: files and packages', () => {
  Test('compiles source strings into a generated app file', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { id "com.tao.test.myapp" version "1.0.0" name "MyApp"  view MainView }
      view MainView() {
        render Text("Hello")
      }
      view Text(Value text) {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(compiled.files.filter(file => !file.relativePath.startsWith('modules/'))).toHaveLength(2)
    Expect(compiled.files[0]?.relativePath).toBe('App.tsx')
    Expect(compiled.files[1]?.relativePath).toBe('App.injection-1.tsx')
    Expect(compiled.files[0]?.code).toContain("import __tao_injection_1__ from './App.injection-1'")
    Expect(compiled.files[1]?.code).toContain('export default function(Value: string)')
  })

  Test('compiles copied nav and datasource declarations through exported identity bindings', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
          use CustomStack, SnapshotStore from @custom
          project type LocalStack is CustomStack with { Initial is Home }
          let LocalNav = LocalStack { }
          let MainNav = CustomStack { Initial Home }
          app Demo { id "com.tao.test.demo" version "1.0.0"
            name "Demo"
            Navigator CustomStack
            Datasource SnapshotStore { StorageKey "demo" }
          }
          view Home() { render inject ${tsFence} return null ${fence} }
        `,
        '@custom/Constructs.tao': `
          public type CustomStack is nav with {
            Initial view
            nav TestNavImpl from ./TestNavImpl.ts
          }
          public nav CustomStack = CustomStack { Initial PackageHome }
          public type SnapshotStore is datasource with {
            StorageKey text
            supports { }
            provider TestProviderImpl from ./TestProviderImpl.ts
          }
          view PackageHome() { render inject ${tsFence} return null ${fence} }
        `,
        '@custom/TestNavImpl.ts': navSidecar('TestNavImpl'),
        '@custom/TestProviderImpl.ts': providerSidecar('TestProviderImpl'),
      },
      async (compiled, files) => {
        const packageCode = compiled['@custom/Constructs.tao'].code
        const appCode = compiled['Main.tao'].code
        const appInjections = files.filter(file =>
          file.sourcePath === compiled['Main.tao'].sourcePath
          && file.relativePath.includes('.injection-')
        )
        const packageInjections = files.filter(file =>
          file.sourcePath === compiled['@custom/Constructs.tao'].sourcePath
          && file.relativePath.includes('.injection-')
        )

        Expect(packageCode).toContain('_Scope.__tao_type_CustomStack = TR.Navigation.Declaration(')
        Expect(packageCode).toContain('_Scope.CustomStack = TR.Alias(TR.Navigation.Configure(')
        // `LocalStack` inherits the same implementation file, so the app plans its copy first and
        // the package imports that one copy rather than emitting a second of its own.
        Expect(packageCode).toContain(
          "import { TestNavImpl as __tao_configuration_implementation_CustomStack__ } from '../../TestNavImpl'",
        )
        Expect(files.filter(file => file.relativePath.endsWith('TestNavImpl.ts'))).toHaveLength(1)
        Expect(packageCode).toContain('_Scope.__tao_type_SnapshotStore = TR.Data.Declaration(')
        Expect(packageCode).toContain(
          'import { TestProviderImpl as __tao_configuration_implementation_SnapshotStore__ } '
            + "from './TestProviderImpl'",
        )
        Expect(packageCode).toContain(
          'export const __tao_type_CustomStack = _Scope.__tao_type_CustomStack',
        )
        Expect(packageCode).toContain('export const CustomStack = _Scope.CustomStack')
        Expect(packageCode).toContain(
          'export const __tao_type_SnapshotStore = _Scope.__tao_type_SnapshotStore',
        )
        Expect(appCode).toContain(
          'import { __tao_type_CustomStack, __tao_type_SnapshotStore, CustomStack }',
        )
        Expect(appCode).toContain("TR.Use(_Scope, '__tao_type_CustomStack', () => __tao_type_CustomStack)")
        Expect(appCode).toContain("TR.Use(_Scope, 'CustomStack', () => CustomStack)")
        Expect(appCode).toContain("import __tao_injection_1__ from './App.injection-1'")
        // Only the `ui Home` fence is an injection now: a derived declaration reuses its base's
        // sidecar, which the app imports by name rather than re-emitting as a boundary file.
        Expect(appInjections).toHaveLength(1)
        Expect(packageInjections).toHaveLength(1)
        Expect(appCode).toContain(
          "import { TestNavImpl as __tao_configuration_implementation_LocalStack__ } from './TestNavImpl'",
        )
        Expect(sidecarCopy(files, 'TestNavImpl.ts').code).toContain('return TR.NavKind.Stack()')
        Expect(sidecarCopy(files, 'TestProviderImpl.ts').code).toContain('connect: () =>')
        Expect(appCode).toContain('TR.Navigation.Configure(_Scope.__tao_type_CustomStack, {')
        Expect(appCode).toContain('TR.Data.Configure(_Scope.__tao_type_SnapshotStore, {')
      },
    )
  })

  Test('preserves declaration and config identity through transparent configurable alias chains', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
          use ChainStack from @chain
          app Demo { id "com.tao.test.demo" version "1.0.0"  name "Demo" Navigator ChainStack { Initial Home } }
          scene Home() { Title "Home" render Empty() }
          view Empty() { render inject ${tsFence} return null ${fence} }
        `,
        '@chain/Navigation.tao': `
          use package @tao/nav as navs
          public type AlternateStack = navs.StackNav
          public type ChainStack = navs.StackNav
        `,
      },
      async (compiled, files) => {
        const chain = compiled['@chain/Navigation.tao'].code
        const chainTypes = files.find(file =>
          file.sourcePath === compiled['@chain/Navigation.tao'].sourcePath
          && file.relativePath.endsWith('.d.ts')
        )?.code ?? ''
        const root = files.find(file =>
          file.sourcePath.endsWith('/@tao/nav/Navigation.tao') && file.relativePath.endsWith('.tsx')
        )
          ?.code ?? ''

        Expect(chain).toContain('__tao_type_StackNav as __tao_package_navs_StackNav')
        Expect(chain).toContain('export type ChainStackConfig = __tao_package_navs_StackNavConfig')
        Expect(chain).not.toContain('TR.Navigation.Declaration(')
        Expect(chainTypes).toContain('import type { StackNavConfig as __tao_package_navs_StackNavConfig }')
        Expect(chainTypes).toContain('export type ChainStackConfig = __tao_package_navs_StackNavConfig')
        Expect(chain.match(/import type \{ StackNavConfig as __tao_package_navs_StackNavConfig \}/g)).toHaveLength(1)
        Expect(chainTypes.match(/import type \{ StackNavConfig as __tao_package_navs_StackNavConfig \}/g))
          .toHaveLength(1)
        Expect(root).toContain('export type StackNavConfig = __tao_package_native_StackNavConfig')
        Expect(root).not.toContain('TR.Navigation.Declaration(')
      },
    )
  })

  Test('copies configuration sidecars, wires their factories, and emits configuration declarations', async () => {
    const sidecarCode = [
      "import TR from '@runtime/TR'",
      "import type { SidecarStackConfig } from './Constructs.tao'",
      '',
      "export function SidecarStack(): TR.NavKind<'stack', SidecarStackConfig> {",
      '  return TR.NavKind.Stack()',
      '}',
    ].join('\n')
    const navKindsCode = [
      "import TR from '@runtime/TR'",
      '',
      'export function SlotNav() {',
      '  return TR.NavKind.Slot()',
      '}',
      '',
      'export function SelectionNav() {',
      '  return TR.NavKind.Selection()',
      '}',
      '',
      'export function CustomNav() {',
      '  return TR.NavKind.Stack()',
      '}',
    ].join('\n')
    const providersCode = [
      "import type TR from '@runtime/TR'",
      '',
      'export function MemoryProvider(): TR.DataProvider {',
      '  return { connect: () => ({ load: () => undefined, save: () => {} }) }',
      '}',
    ].join('\n')
    await withTaoFiles(
      'tao-compiler-configuration-sidecar-',
      {
        'Package.tao': `package { version "1.0.0" license AGPL-3.0-only }`,
        'Main.tao': `
          use SidecarStack, SidecarStore from ./Constructs.tao
          app Demo { id "com.tao.test.demo" version "1.0.0"
            name "Demo"
            Navigator SidecarStack { Initial Home }
            Datasource SidecarStore { StorageKey "demo" }
          }
          view Home() { render inject ${tsFence} return null ${fence} }
        `,
        'Constructs.tao': `
          public type SidecarStack is nav with {
            Initial view
            nav SidecarStack from ./SidecarStack.ts
          }
          public type SidecarSlot is nav with {
            Initial view
            nav SlotNav from ./NavKinds.ts
          }
          public type SidecarSelection is nav with {
            Initial key
            Display text
            @key { Label text Content view }
            nav SelectionNav from ./NavKinds.ts
          }
          public type SidecarCustom is nav with {
            Query text
            nav CustomNav from ./NavKinds.ts
          }
          public type SidecarStore is datasource with {
            StorageKey text
            supports { }
            provider MemoryProvider from ./Providers.ts
          }
        `,
        'SidecarStack.ts': sidecarCode,
        'NavKinds.ts': navKindsCode,
        'Providers.ts': providersCode,
      },
      async paths => {
        const compiled = await Workspace.compile(paths['Main.tao'])
        const module = requireRelativeCompiledFile(compiled.files, 'modules/Constructs.tao.tsx')
        const declarations = requireRelativeCompiledFile(compiled.files, 'modules/Constructs.tao.d.ts')
        const sidecar = requireRelativeCompiledFile(compiled.files, 'modules/SidecarStack.ts')
        const providers = requireRelativeCompiledFile(compiled.files, 'modules/Providers.ts')
        const sharedNavKinds = compiled.files.filter(file => file.relativePath === 'modules/NavKinds.ts')

        Expect(module.code).toContain(
          "import { SidecarStack as __tao_configuration_implementation_SidecarStack__ } from './SidecarStack'",
        )
        Expect(module.code.replace(/\s+/g, ' ')).toContain(
          'TR.Navigation.Declaration( "SidecarStack", Reflect.apply( '
            + '__tao_configuration_implementation_SidecarStack__, undefined, [], ), TR.Navigation.Identity(',
        )
        // Three declarations name three exports of one file, so the file is copied once and
        // imported three times under distinct local aliases.
        Expect(sharedNavKinds).toHaveLength(1)
        for (
          const [declaration, exportName] of [['SidecarSlot', 'SlotNav'], ['SidecarSelection', 'SelectionNav'], [
            'SidecarCustom',
            'CustomNav',
          ]]
        ) {
          Expect(module.code).toContain(
            `import { ${exportName} as __tao_configuration_implementation_${declaration}__ } from './NavKinds'`,
          )
        }
        Expect(providers.code).toContain('connect: () =>')
        Expect(sidecar.sourcePath).toBe(paths['SidecarStack.ts'])
        Expect(sidecar.code).toBe(sidecarCode)
        Expect(declarations.code).toContain("import type TR from '@runtime/TR'")
        const declarationText = declarations.code.replace(/\s+/g, ' ')
        Expect(declarationText).toContain(
          'export type SidecarStackConfig = Readonly<{ '
            + 'readonly hostSlots?: TR.NavHostSlotConfiguration '
            + 'readonly initial: TR.Presentable | TR.NavigationValue }>',
        )
        Expect(declarationText).toContain(
          'export type SidecarStoreConfig = Readonly<{ readonly "StorageKey": TR.Value<string> }>',
        )
        Expect(declarationText).toContain('export type MemoryProvider = () => TR.DataProvider')
        Expect(module.code).toContain('export type MemoryProvider = () => TR.DataProvider')
        Expect(declarationText).toContain(
          'export type SidecarSlotConfig = Readonly<{ '
            + 'readonly hostSlots?: TR.NavHostSlotConfiguration '
            + 'readonly initial: TR.Presentable | TR.NavigationValue }>',
        )
        Expect(declarationText).toContain(
          'export type SidecarSelectionConfig = Readonly<{ '
            + 'readonly hostSlots?: TR.NavHostSlotConfiguration '
            + 'readonly display: TR.Evaluable readonly initial: string '
            + 'readonly items: Readonly<Record<string, Readonly<{ '
            + 'readonly label: TR.Evaluable readonly icon?: TR.Evaluable '
            + 'readonly content: TR.Presentable | TR.NavigationValue }>>> }>',
        )
        Expect(declarationText).toContain(
          'export type SidecarCustomConfig = Readonly<Record<string, unknown>>',
        )
        Expect(module.code.replace(/\s+/g, ' ')).toContain(
          'export type SidecarStackConfig = Readonly<{ '
            + 'readonly hostSlots?: TR.NavHostSlotConfiguration '
            + 'readonly initial: TR.Presentable | TR.NavigationValue }>',
        )
      },
    )
  })

  Test('compiles imported pure functions as module-owned runtime values', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        use DocumentLabel from ./Labels.tao
        app MultiFile { id "com.tao.test.multifile" version "1.0.0" name "MultiFile"  view MainView }
        view MainView() {
          render Text(DocumentLabel("Draft"))
        }
        view Text(Value text) {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Labels.tao': `
        project function DocumentLabel(Title text) returns text {
          return "Document: { Title }"
        }
      `,
      },
      compiled => {
        Expect(compiled['Main.tao'].code).toContain("import { DocumentLabel } from './modules/Labels.tao'")
        Expect(compiled['Main.tao'].code).toContain("TR.Use(_Scope, 'DocumentLabel', () => DocumentLabel)")
        Expect(compiled['Main.tao'].code).toContain('TR.Call(_Scope.DocumentLabel, TR.Value("Draft"))')
        Expect(compiled['Labels.tao'].code).toContain('_Scope.DocumentLabel = TR.Function(')
        Expect(compiled['Labels.tao'].code).toContain('export const DocumentLabel = _Scope.DocumentLabel')
      },
    )
  })

  Test('compiles a supporting file that imports an entry app for a strict target', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
          use ResetNav from ./Support.tao
          app Root { id "com.tao.test.root" version "1.0.0"
            name "Root"
            Navigator ResetNav
          }
        `,
        'Support.tao': `
          use StackNav from @tao/nav
          use Root from ./
          project nav ResetNav = StackNav { Initial Home }
          scene Home() {
            Title "Home"
            action Reset() { replace ResetNav in Root }
            render Empty()
          }
          view Empty() { render inject ${tsFence} return null ${fence} }
        `,
      },
      compiled => {
        const entryCode = compiled['Main.tao'].code
        const supportCode = compiled['Support.tao'].code

        Expect(entryCode).toContain('_Scope.Root = _TaoAppDefinition_Root')
        Expect(entryCode).toContain('export const Root = _Scope.Root')
        Expect(supportCode).toContain('import { Root }')
        Expect(supportCode).toContain("TR.Use(_Scope, 'Root', () => Root)")
        Expect(supportCode).toContain('TR.Navigation.Replace(')
        Expect(supportCode).toContain('_Scope.Root')
      },
    )
  })

  Test('does not compile sidecar test files from app directory imports', async () => {
    await withTaoFiles(
      'tao-compiler-sidecar-',
      {
        'Package.tao': `package { version "1.0.0" license AGPL-3.0-only }`,
        'Main.tao': `
        app MyApp { id "com.tao.test.myapp" version "1.0.0" name "MyApp"  view MainView }
        use Text from ./
        view MainView() {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        project view Text(Value text) {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Main.test.tao': `
        test "Sidecar" {
          test "intentionally incomplete" {
            expect text "This file should not compile"
          }
        }
      `,
      },
      async paths => {
        const compiled = await Workspace.compile(paths['Main.tao']!)
        const sourcePaths = compiled.files.map(file => file.sourcePath)

        Expect(sourcePaths).toContain(paths['Main.tao'])
        Expect(sourcePaths).toContain(paths['Views.tao'])
        Expect(sourcePaths).not.toContain(paths['Main.test.tao'])
      },
    )
  })

  Test('reports an unresolved nested sidecar import as a located compiler diagnostic', async () => {
    await withTaoFiles('tao-compiler-sidecar-diagnostic-', {
      'Package.tao': 'package { version "1.0.0" license AGPL-3.0-only }',
      'Main.tao': `
        app SidecarDiagnostic { id "com.tao.test.sidecardiagnostic" version "1.0.0" name "SidecarDiagnostic"  view Main }
        view Main() {
          action Publish() from ./Api.ts
          render Empty()
        }
        view Empty() { render inject \`\`\`ts return null \`\`\` }
      `,
      'Api.ts': [
        "import { helper } from './Missing'",
        'export function Publish() { helper() }',
        "export { helper as missingHelper } from './Missing'",
      ].join('\n'),
    }, async paths => {
      // Captured outside a try/catch on purpose: a `try` block that throws its own "should have
      // failed" error hands that error to its own `catch`, which would then assert against it.
      const failure: unknown = await Workspace.compile(paths['Main.tao']!).then(
        () => undefined,
        (error: unknown) => error,
      )
      Assert.defined(failure, 'the unresolved sidecar import fails compilation')
      Expect(Errors.isTaoError(failure)).toBe(true)
      const diagnostics = (failure as { details?: { diagnostics?: Array<Record<string, unknown>> } })
        .details?.diagnostics ?? []
      Expect(diagnostics).toEqual([Expect['objectContaining']({
        filePath: paths['Api.ts'],
        message: "Sidecar relative import './Missing' could not be resolved.",
        severity: 'error',
        source: 'compiler',
        range: Expect['objectContaining']({
          start: { line: 0, character: 23 },
        }),
      })])
    })
  })

  Test('compiles indexed local package modules', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app IndexedPackage { id "com.tao.test.indexedpackage" version "1.0.0" name "IndexedPackage"  view MainView }
        use MainView from @bar/views
      `,
        '@bar/views/Main.tao': `
        project view MainView() {
          render Text("Package import")
        }
        view Text(Value text) {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      compiled => {
        Expect(compiled['Main.tao'].relativePath).toBe('App.tsx')
        Expect(compiled['@bar/views/Main.tao'].relativePath).toBe(
          'modules/@bar/views/Main.tao.tsx',
        )
      },
    )
  })

  Test('compiles bare package dependencies', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app BarePackageUse { id "com.tao.test.barepackageuse" version "1.0.0" name "BarePackageUse"  view MainView }
        use MainView from @foo/forms
      `,
        '@foo/Title.tao': `
        package let PackageTitle = "Package alias"
      `,
        '@foo/forms/Main.tao': `
        use PackageTitle
        project view MainView() {
          render Text(PackageTitle)
        }
        view Text(Value text) {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      compiled => {
        Expect(compiled['Main.tao'].relativePath).toBe('App.tsx')
        Expect(compiled['@foo/forms/Main.tao'].relativePath).toBe(
          'modules/@foo/forms/Main.tao.tsx',
        )
        Expect(compiled['@foo/Title.tao'].relativePath).toBe('modules/@foo/Title.tao.tsx')
      },
    )
  })

  // REMOVAL CANDIDATE: Only output paths are asserted; imported persisted-type compilation covers the stronger boundary, but this fixture also shadows its imported type name.
  Test('compiles type-only imports without requiring runtime type bindings', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app TypeImportApp { id "com.tao.test.typeimportapp" version "1.0.0" name "TypeImportApp"  view MainView }
        use Name from ./Types.tao
        let Name = Name "Ada"
        view MainView() {
          render TextValue(Name)
        }
        view TextValue(Value text) {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        project type Name is text
      `,
      },
      compiled => {
        Expect(compiled['Types.tao'].relativePath).toBe('modules/Types.tao.tsx')
      },
    )
  })

  Test('compiles cross-file derived primitive persisted state through its underlying codec', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
          use PaneWidth from ./Types.tao
          use StackNav from @tao/nav
          app Workspace { id "com.tao.test.workspace" version "1.0.0"
            name "Workspace"
            state Width is PaneWidth = PaneWidth 320 (persist)
            Navigator StackNav { Initial Pane }
          }
          scene Pane() { Title "Pane" render Empty() }
          view Empty() { render inject \`\`\`ts return null \`\`\` }
        `,
        'Types.tao': 'project type PaneWidth is number',
      },
      compiled => {
        Expect(compiled['Main.tao'].code).toContain('{ kind: "primitive", name: "number" }')
      },
    )
  })

  Test('compiles circular use imports between sibling Tao files', async () => {
    await withCompiledFiles(
      'Main.tao',
      {
        'Main.tao': `
        app CircularApp { id "com.tao.test.circularapp" version "1.0.0" name "CircularApp"  view MainView }
        use AView from ./
        view MainView() {
          render AView()
        }
      `,
        'A.tao': `
        use BView from ./
        project let SharedTitle = "Cycle"
        project view AView() {
          render BView()
        }
      `,
        'B.tao': `
        use SharedTitle from ./
        project view BView() {
          render Leaf(SharedTitle)
        }
        view Leaf(Value text) {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      compiled => {
        Expect(compiled['A.tao'].relativePath).toBe('modules/A.tao.tsx')
        Expect(compiled['B.tao'].relativePath).toBe('modules/B.tao.tsx')
      },
    )
  })

  Test('keeps generated module output paths unique for same-named external files', async () => {
    const sharedViewSource = (name: string) => `
      project view ${name}(Value text) {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
    `
    await withCompiledFiles(
      'app/Main.tao',
      {
        'app/Main.tao': `
        app CollisionApp { id "com.tao.test.collisionapp" version "1.0.0" name "CollisionApp"  view MainView }
        use AText from ../liba
        use BText from ../libb
        view MainView() {
          render AText("Hello")
        }
      `,
        'liba/Views.tao': sharedViewSource('AText'),
        'libb/Views.tao': sharedViewSource('BText'),
      },
      (compiled, allFiles) => {
        const sourceModules = Object.values(compiled)
        const relativePaths = allFiles.map(file => file.relativePath)

        Expect(sourceModules).toHaveLength(3)
        Expect(new Set(relativePaths).size).toBe(relativePaths.length)
        Expect(relativePaths).toContain('modules/external/ReadContext.tao.tsx')
        Expect(relativePaths).toContain('modules/external/Views.tao.tsx')
        Expect(relativePaths).toContain('modules/external/Views.tao-2.tsx')
        Expect(relativePaths).toContain('modules/external/Views.tao.injection-1.tsx')
        Expect(relativePaths).toContain('modules/external/Views.tao-2.injection-1.tsx')
      },
    )
  })

  Test('keeps same-named external sidecar companion groups collision-safe', async () => {
    await withTaoFiles(
      'tao-compiler-sidecar-collisions-',
      {
        'Package.tao': `package { version "1.0.0" license AGPL-3.0-only }`,
        'app/Main.tao': `
          use AStack from ../liba
          use BStack from ../libb
          app CollisionApp { id "com.tao.test.collisionapp" version "1.0.0"
            name "Collision"
            Navigator AStack { Initial Home }
          }
          view Home() { render inject ${tsFence} return null ${fence} }
        `,
        'liba/Views.tao': `
          public type AStack is nav with {
            Initial view
            nav Implementation from ./Implementation.ts
          }
        `,
        'liba/Implementation.ts': `
          import TR from '@runtime/TR'
          import type { AStackConfig } from './Views.tao'
          export function Implementation(): TR.NavKind<'stack', AStackConfig> {
            return TR.NavKind.Stack()
          }
        `,
        'libb/Views.tao': `
          public type BStack is nav with {
            Initial view
            nav Implementation from ./Implementation.ts
          }
        `,
        'libb/Implementation.ts': `
          import TR from '@runtime/TR'
          import type { BStackConfig } from './Views.tao'
          import type { AStackConfig } from '../liba/Views.tao'
          const ordinaryPath = '../liba/Views.tao'
          type OtherStack = AStackConfig
          export function Implementation(): TR.NavKind<'stack', BStackConfig> {
            void ordinaryPath
            void (null as unknown as OtherStack)
            return TR.NavKind.Stack()
          }
        `,
      },
      async paths => {
        const compiled = await Workspace.compile(paths['app/Main.tao'])
        const relativePaths = compiled.files.map(file => file.relativePath)

        Expect(new Set(relativePaths).size).toBe(relativePaths.length)
        Expect(relativePaths).toContain('modules/external/Views.tao.tsx')
        Expect(relativePaths).toContain('modules/external/Views.tao.d.ts')
        Expect(relativePaths).toContain('modules/external/Implementation.ts')
        Expect(relativePaths).toContain('modules/external/Views.tao-2.files/Views.tao.tsx')
        Expect(relativePaths).toContain('modules/external/Views.tao-2.files/Views.tao.d.ts')
        Expect(relativePaths).toContain('modules/external/Views.tao-2.files/Implementation.ts')
        const movedSidecar = compiled.files.find(file =>
          file.relativePath === 'modules/external/Views.tao-2.files/Implementation.ts'
        )
        Expect(movedSidecar?.code).toContain("const ordinaryPath = '../liba/Views.tao'")
        Expect(movedSidecar?.code).toContain("import type { AStackConfig } from '../Views.tao'")
      },
    )
  })

  Test('copies a sidecar named by two Tao files once', async () => {
    await withTaoFiles(
      'tao-compiler-shared-sidecar-',
      {
        'Package.tao': `package { version "1.0.0" license AGPL-3.0-only }`,
        'Main.tao': `
          use PanelSurface from @panel
          app SharedApp { id "com.tao.test.sharedapp" version "1.0.0"  name "Shared" view Home }
          view Home() { render HostSurface() }
          view HostSurface() from ./host/Host.tsx
        `,
        '@panel/Panel.tao': `
          public view PanelSurface() from ../host/Host.tsx
        `,
        'host/Host.tsx': `
          import React from 'react'
          import { hostState } from './HostState'
          export function HostSurface(): React.ReactElement {
            return React.createElement('div', null, hostState())
          }
          export function PanelSurface(): React.ReactElement {
            return React.createElement('div', null, hostState())
          }
        `,
        'host/HostState.ts': `
          let revision = 0
          export function hostState(): number {
            return ++revision
          }
        `,
      },
      async paths => {
        const compiled = await Workspace.compile(paths['Main.tao'], { appName: 'SharedApp' })
        const relativePaths = compiled.files.map(file => file.relativePath)
        // Module-level state in the sidecar's graph is one instance at runtime only while the two
        // Tao files that name it import one copy of it.
        const copies = compiled.files.filter(file => file.sourcePath === paths['host/Host.tsx'])
        const stateCopies = compiled.files.filter(file => file.sourcePath === paths['host/HostState.ts'])

        Expect(new Set(relativePaths).size).toBe(relativePaths.length)
        Expect(copies).toHaveLength(1)
        Expect(stateCopies).toHaveLength(1)
      },
    )
  })

  Test('rejects graphs without an app declaration', async () => {
    await Expect(TestCompiler.compileCode(`
      view MainView() {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)).rejects.toThrow('no app declaration is reachable from the entry file')
  })

  Test('requires explicit multi-app selection and emits a named registry', async () => {
    const source = `
      app First { id "com.tao.test.first" version "1.0.0" name "First"  view MainView }
      app Second { id "com.tao.test.second" version "1.0.0" name "Second"  view MainView }
      view MainView() { render inject ${tsFence} return null ${fence} }
    `
    await Expect(TestCompiler.compileCode(source)).rejects.toThrow('multiple apps without a selection')

    const compiled = await TestCompiler.compileCode(source, { appName: 'Second' })
    Expect(compiled.appNames).toEqual(['First', 'Second'])
    Expect(compiled.code).toContain('export const TaoApps = {')
    Expect(compiled.code).toContain('"First": TaoApp_First')
    Expect(compiled.code).toContain('"Second": TaoApp_Second')
    Expect(compiled.code).toContain('export default TaoApps["Second"]')
  })

  Test('selects and compiles an app declared in an imported file', async () => {
    await withTaoFiles(
      'tao-compiler-imported-app-',
      {
        'Package.tao': 'package { version "1.0.0" license AGPL-3.0-only }',
        'Main.tao': `
          use NestedApp from ./nested/App.tao
        `,
        'nested/App.tao': `
          project app NestedApp { id "com.tao.test.nestedapp" version "1.0.0" name "NestedApp"  view MainView }
          view MainView() { render inject ${tsFence} return null ${fence} }
        `,
      },
      async paths => {
        const compiled = await Workspace.compile(paths['Main.tao'], { appName: 'NestedApp' })
        const selected = compiled.files.find(file => file.sourcePath === paths['nested/App.tao'])
        const caller = compiled.files.find(file => file.sourcePath === paths['Main.tao'])

        Expect(compiled.appNames).toEqual(['NestedApp'])
        Expect(selected?.relativePath).toBe('App.tsx')
        Expect(selected?.code).toContain('export default TaoApps["NestedApp"]')
        Expect(caller?.relativePath).not.toBe('App.tsx')
      },
    )
  })

  Test('compiles a package app and a cross-module variant through imported runtime values', async () => {
    await withTaoFiles(
      'tao-compiler-package-app-',
      {
        'Package.tao': 'package { version "1.0.0" license AGPL-3.0-only }',
        'Main.tao': `
          use PackageApp from @feature
          app Preview = PackageApp with { id "com.tao.test.preview",  name "Preview" }
        `,
        '@feature/App.tao': `
          use StackNav from @tao/nav
          public app PackageApp { id "com.tao.test.packageapp" version "1.0.0"  name "Package" Navigator StackNav { Initial Home } }
          view Home() { render inject ${tsFence} return null ${fence} }
        `,
      },
      async paths => {
        const compiled = await Workspace.compile(paths['Main.tao'], { appName: 'Preview' })
        const entry = compiled.files.find(file => file.relativePath === 'App.tsx')

        Expect(compiled.appNames).toEqual(['Preview', 'PackageApp'])
        Expect(entry?.code).toContain('declaration: _Scope.PackageApp.declaration')
        Expect(entry?.code).toContain(
          'const _TaoBaseBinding = _TaoAppModuleScope_Preview.PackageApp.definition.bindApp!(_TaoAppId)',
        )
        Expect(entry?.code).toContain('navigator: () => _TaoBaseBinding.navigator()')
        Expect(entry?.code).not.toContain('_Scope.StackNav')
        Expect(entry?.code).not.toContain('_Scope.Home')
      },
    )
  })

  Test('keeps alternating-module app inheritance on each immediate runtime base', async () => {
    await withTaoFiles(
      'tao-compiler-alternating-app-inheritance-',
      {
        'Package.tao': 'package { version "1.0.0" license AGPL-3.0-only }',
        'Main.tao': `
          use MiddleApp from ./Middle.tao
          project app RootApp { id "com.tao.test.rootapp" version "1.0.0" name "RootApp"  view RootHome }
          app FinalApp = MiddleApp with { id "com.tao.test.finalapp" }
          view RootHome() { render inject ${tsFence} return null ${fence} }
        `,
        'Middle.tao': `
          use RootApp from ./Main.tao
          use StackNav from @tao/nav
          project app MiddleApp = RootApp with { id "com.tao.test.middleapp"
            Navigator StackNav { Initial MiddleHome }
          }
          app SameModuleFinal = MiddleApp with { id "com.tao.test.samemodulefinal" }
          view MiddleHome() { render inject ${tsFence} return null ${fence} }
        `,
      },
      async paths => {
        const compiled = await Workspace.compile(paths['Main.tao'], { appName: 'FinalApp' })
        const entry = compiled.files.find(file => file.relativePath === 'App.tsx')
        const sameModule = await Workspace.compile(paths['Middle.tao'], { appName: 'SameModuleFinal' })
        const sameModuleEntry = sameModule.files.find(file => file.relativePath === 'App.tsx')

        Expect(entry?.code).toContain('declaration: _Scope.MiddleApp.declaration')
        Expect(entry?.code).toContain('navigator: () => _TaoBaseBinding.navigator()')
        Expect(entry?.code).not.toContain('_Scope.StackNav')
        Expect(entry?.code).not.toContain('_Scope.MiddleHome')
        Expect(sameModuleEntry?.code).toContain('declaration: _Scope.MiddleApp.declaration')
        Expect(sameModuleEntry?.code).toContain('navigator: () => _TaoBaseBinding.navigator()')
        Expect(sameModuleEntry?.code).not.toContain('_Scope.RootHome')
      },
    )
  })

  Test('strips test declarations from generated app code', async () => {
    const compiled = await TestCompiler.compileCode(`
      app MyApp { id "com.tao.test.myapp" version "1.0.0" name "MyApp"  view MainView }
      view MainView() {
        render Text("Hello")
      }
      view Text(Value text) {
        render inject Value ${tsFence}
          return null
        ${fence}
      }

      test "Smoke" {
        test "renders" {
          run MyApp
          expect text "Should not compile"
        }
      }
    `)

    Expect(compiled.code).not.toContain('Smoke')
    Expect(compiled.code).not.toContain('Should not compile')
  })
})

type CompiledFiles<Files extends Record<string, string>> = { [Path in keyof Files]: CompiledFile }

async function withCompiledFiles<
  const Files extends Record<string, string>,
  EntryFile extends keyof Files & string,
>(
  entryFile: EntryFile,
  files: Files,
  testFunction: (compiled: CompiledFiles<Files>, files: readonly CompiledFile[]) => Promise<void> | void,
): Promise<void> {
  await withTaoFiles('tao-compiler-', {
    'Package.tao': `package { version "1.0.0" license AGPL-3.0-only }`,
    ...files,
  }, async paths => {
    const result = await Workspace.compile(paths[entryFile])
    const compiled = {} as CompiledFiles<Files>
    for (const relativePath of Object.keys(files) as Array<keyof Files & string>) {
      compiled[relativePath] = requireCompiledFile(result.files, paths[relativePath])
    }

    await testFunction(compiled, result.files)
  })
}

function requireCompiledFile(files: readonly CompiledFile[], sourcePath: string): CompiledFile {
  const file = files.find(compiledFile => compiledFile.sourcePath === sourcePath)
  Expect(file).toBeDefined()
  return file!
}

/** sidecarCopy finds the one copy of a named TypeScript sidecar in a compiled output set,
 * wherever it landed: a sidecar the entry file plans sits beside `App.tsx` at the generated root. */
function sidecarCopy(files: readonly CompiledFile[], fileName: string): CompiledFile {
  const file = files.find(compiledFile =>
    compiledFile.relativePath === fileName || compiledFile.relativePath.endsWith(`/${fileName}`)
  )
  Expect(file).toBeDefined()
  return file!
}

function requireRelativeCompiledFile(files: readonly CompiledFile[], relativePath: string): CompiledFile {
  const file = files.find(compiledFile => compiledFile.relativePath === relativePath)
  Expect(file).toBeDefined()
  return file!
}

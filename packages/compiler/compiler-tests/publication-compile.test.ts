import { FS, ProjectIdentity } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { BridgeMetadata } from '../compiler-src/bridge-metadata'
import { Workspace } from '../compiler-src/workspace'

Describe('compiler: selected package publications', () => {
  Test('compiles an explicitly selected test-sidecar app with inherited requirements', async () => {
    await withTaoFiles('tao-explicit-test-app-', {
      'Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only }
        app Base {
          id "com.tao.testsidecar" version "1.0.0" name "Test sidecar" view Home
          requires "Widgets" from ./Library version ^1.0.0 { @ui as @widgets }
          requires ts npm:date-fns version 4.1.0 as util
        }
        view Home() { render Widget() }
        use Widget from @widgets
      `,
      'Main.test.tao': `
        use Base from ./Main
        app Selected = Base with { id "com.tao.testsidecar.selected" }
        test "Selected app" { test "runs" { run Selected expect text "Ready" } }
      `,
      'Other.test.tao': 'app Unrelated { id "com.tao.unrelated" version "1.0.0" name "Unrelated" view Other }',
      'Library/.tao/.gitkeep': '',
      'Library/Publication.tao': 'package { name "Widgets" version 1.0.0 license AGPL-3.0-only includes @ui }',
      'Library/@ui/Widget.tao': 'public view Widget() { render inject ```ts return null ``` }',
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.test.tao']!, { appName: 'Selected' })
      Expect(compiled.files.find(file => file.relativePath === 'App.tsx')?.sourcePath)
        .toBe(paths['Main.test.tao'])
      Expect(compiled.files.map(file => file.sourcePath)).not.toContain(paths['Other.test.tao'])
      Expect(compiled.files.map(file => file.sourcePath)).toContain(paths['Library/@ui/Widget.tao'])
      Expect(compiled.dependencyEnvironments.find(item => item.projectRoot === root)?.npm)
        .toEqual([{ alias: 'util', packageName: 'date-fns', versionRange: '4.1.0' }])
    })
  })

  Test('copies an own-project sidecar and helper from an unmarked host tree', async () => {
    await withTaoFiles('tao-local-host-sidecar-', {
      'App/.tao/.gitkeep': '',
      'App/Main.tao': `
        app Demo { id "com.tao.localhost" version "1.0.0" name "Local host" view Home }
        view Home() from ../Host/Widget.tsx
      `,
      'Host/Widget.tsx': `
        import { label } from './Helper'
        export function Home(_props: unknown) { void label; return null }
      `,
      'Host/Helper.ts': 'export const label = "host helper"',
    }, async (paths, root) => {
      const appRoot = FS.resolvePath('App', root)
      await ProjectIdentity.ensure(appRoot)
      const result = await (await Workspace.open(appRoot)).compile(paths['App/Main.tao']!)
      Expect(result.files.some(file => file.sourcePath === paths['Host/Widget.tsx'])).toBe(true)
      Expect(result.files.some(file => file.sourcePath === paths['Host/Helper.ts'])).toBe(true)
    }, { verbatim: true })
  })

  Test('checks publication ownership when an own-project binding already uses the same sidecar', async () => {
    await withTaoFiles('tao-publication-shared-host-sidecar-', {
      'App/.tao/.gitkeep': '',
      'App/Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only }
        use Widget from @widgets
        app Demo {
          id "com.tao.sharedhost" version "1.0.0" name "Shared host" view Home
          requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets }
        }
        view Home() from ../Host/Widget.tsx
      `,
      'Library/.tao/.gitkeep': '',
      'Library/Publication.tao': 'package { name "Widgets" version 1.0.0 license AGPL-3.0-only includes @ui }',
      'Library/@ui/Widget.tao': 'public view Widget() from ../../Host/Widget.tsx',
      'Host/Widget.tsx': `
        export function Home(_props: unknown) { return null }
        export function Widget(_props: unknown) { return null }
      `,
    }, async (paths, root) => {
      await ProjectIdentity.ensure(FS.resolvePath('App', root))
      await ProjectIdentity.ensure(FS.resolvePath('Library', root))
      const workspace = await Workspace.open(FS.resolvePath('App', root))
      await Expect(workspace.compile(paths['App/Main.tao']!))
        .rejects.toThrow('crosses a Tao project boundary')
    }, { verbatim: true })
  })

  Test('compiles private helpers reached by a published module without collecting unrelated data', async () => {
    await withTaoFiles('tao-compiler-publication-', {
      'Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only }
        use Widget from @widgets
        app Demo {
          id "com.tao.demo" version "1.0.0" name "Demo" view Home
          requires "Widgets" from ./Library version ^2.0.0 { @ui as @widgets }
        }
        view Home() { render Widget() }
      `,
      'Library/.tao/.gitkeep': '',
      'Library/Publications.tao': 'package { name "Widgets" version 2.0.0 license AGPL-3.0-only includes @ui }',
      'Library/@ui/Widget.tao': `
        let Caption = "private helper"
        public view Widget() { render Label(Caption) }
        view Label(Value text) { render inject \`\`\`ts return null \`\`\` }
        data Secrets / Secret { Label text }
        view Unused() from ./Unused.tsx
      `,
      'Library/@ui/Unused.tsx': 'export function Unused() { return null }',
      'Library/@icons/Icon.tao': 'public let Icon = "not included"',
    }, async (paths, root) => {
      const result = await (await Workspace.open(root)).compile(paths['Main.tao']!)
      const sourcePaths = result.files.map(file => file.sourcePath)
      Expect(sourcePaths).toContain(paths['Library/@ui/Widget.tao'])
      Expect(sourcePaths).not.toContain(paths['Library/@icons/Icon.tao'])
      const widget = result.files.find(file =>
        file.sourcePath === paths['Library/@ui/Widget.tao']
        && file.relativePath.endsWith('.tsx')
      )
      Expect(widget?.code).toContain('private helper')
      Expect(widget?.code).not.toContain('Secrets')
      Expect(widget?.code).not.toContain('Unused')
      Expect(sourcePaths).not.toContain(paths['Library/@ui/Unused.tsx'])
      Expect(result.files.find(file => file.relativePath === 'TaoDataSchema.json')).toBeUndefined()
      Expect(await FS.isFile(FS.resolvePath('.tao-ts/Library/@ui/Widget.tao.ts', root))).toBe(false)
    })
  })

  Test('does not collect a requirement declared only by an unselected app', async () => {
    await withTaoFiles('tao-compiler-app-requirements-', {
      'Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only requires "Other Views" from ./OtherLibrary version ^1.0.0 { @ui as @root-other } }
        app Selected {
          id "com.tao.selected" version "1.0.0" name "Selected" view Home
        }
        app Other {
          id "com.tao.other" version "1.0.0" name "Other" view OtherHome
          requires "Other Views" from ./OtherLibrary version ^1.0.0 { @ui as @other }
        }
        view Home() { render Label("Selected") }
        view OtherHome() { render Label("Other") }
        view Label(Value text) { render inject \`\`\`ts return null \`\`\` }
      `,
      'OtherLibrary/.tao/.gitkeep': '',
      'OtherLibrary/Publication.tao': 'package { name "Other Views" version 1.0.0 license AGPL-3.0-only includes @ui }',
      'OtherLibrary/@ui/Other.tao': 'public view OtherView() { render inject ```ts return null ``` }',
      'OtherLibrary/@ui/Data.tao': 'data Secrets / Secret { Label text }',
    }, async (paths, root) => {
      const result = await (await Workspace.open(root)).compile(paths['Main.tao']!, { appName: 'Selected' })
      Expect(result.files.map(file => file.sourcePath)).not.toContain(paths['OtherLibrary/@ui/Other.tao'])
      Expect(result.files.map(file => file.sourcePath)).not.toContain(paths['OtherLibrary/@ui/Data.tao'])
      Expect(result.files.find(file => file.relativePath === 'TaoDataSchema.json')).toBeUndefined()
    })
  })

  Test(
    'keeps private same-file types imported by a selected sidecar without loading their implementations',
    async () => {
      await withTaoFiles('tao-publication-sidecar-type-', {
        'Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only }
        use Widget from @widgets
        app Demo {
          id "com.tao.sidecartype" version "1.0.0" name "Sidecar type" view Home
          requires "Widgets" from ./Library version ^1.0.0 { @ui as @widgets }
        }
        view Home() { render Widget() }
      `,
        'Library/.tao/.gitkeep': '',
        'Library/Publication.tao': 'package { name "Widgets" version 1.0.0 license AGPL-3.0-only includes @ui }',
        'Library/@ui/Widget.tao': `
        public view Widget() from ./Widget.tsx
        type SidecarStore is datasource with {
          StorageKey text
          supports { }
          provider MemoryProvider from ./Providers.ts
        }
      `,
        'Library/@ui/Widget.tsx': `
        import type { SidecarStoreConfig } from './Widget.tao'
        export function Widget(_props: unknown) {
          void (null as unknown as SidecarStoreConfig)
          return null
        }
      `,
        'Library/@ui/Providers.ts': 'export function MemoryProvider() { return {} }',
      }, async (paths, root) => {
        const result = await (await Workspace.open(root)).compile(paths['Main.tao']!)
        const sourcePaths = result.files.map(file => file.sourcePath)
        Expect(sourcePaths).toContain(paths['Library/@ui/Widget.tsx'])
        Expect(sourcePaths).not.toContain(paths['Library/@ui/Providers.ts'])
        const companion = result.files.find(file =>
          file.sourcePath === paths['Library/@ui/Widget.tao'] && file.relativePath.endsWith('.d.ts')
        )
        Expect(companion?.code).toContain('export type SidecarStoreConfig')
        const generated = result.files.find(file =>
          file.sourcePath === paths['Library/@ui/Widget.tao'] && file.relativePath.endsWith('.tsx')
        )
        Expect(generated?.code).not.toContain('__tao_type_SidecarStore')
      })
    },
  )

  Test('emits a private type companion imported from another Tao file by a selected sidecar', async () => {
    await withTaoFiles('tao-publication-sidecar-external-type-', {
      'Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only }
        use Widget from @widgets
        app Demo {
          id "com.tao.externaltype" version "1.0.0" name "External type" view Home
          requires "Widgets" from ./Library version ^1.0.0 { @ui as @widgets }
        }
        view Home() { render Widget() }
      `,
      'Library/.tao/.gitkeep': '',
      'Library/Publication.tao': 'package { name "Widgets" version 1.0.0 license AGPL-3.0-only includes @ui }',
      'Library/@ui/Widget.tao': 'public view Widget() from ./Widget.tsx',
      'Library/@ui/Widget.tsx': `
        import type { SidecarStoreConfig } from './PrivateTypes.tao'
        type CaseIdentity = typeof import('./CaseOnly.tao').HapticKind
        export function Widget(_props: unknown) {
          void (null as unknown as SidecarStoreConfig)
          void (null as unknown as CaseIdentity)
          return null
        }
      `,
      'Library/@ui/PrivateTypes.tao': `
        type SidecarStore is datasource with {
          StorageKey text
          supports { }
          provider MemoryProvider from ./Providers.ts
        }
        data Secrets / Secret { Name text }
      `,
      'Library/@ui/Providers.ts': 'export function MemoryProvider() { return {} }',
      'Library/@ui/CaseOnly.tao': 'type HapticKind is one of Light, Heavy',
    }, async (paths, root) => {
      const result = await (await Workspace.open(root)).compile(paths['Main.tao']!)
      const sourcePaths = result.files.map(file => file.sourcePath)
      Expect(sourcePaths).toContain(paths['Library/@ui/PrivateTypes.tao'])
      Expect(sourcePaths).not.toContain(paths['Library/@ui/Providers.ts'])
      const companion = result.files.find(file =>
        file.sourcePath === paths['Library/@ui/PrivateTypes.tao'] && file.relativePath.endsWith('.d.ts')
      )
      Expect(companion?.code).toContain('export type SidecarStoreConfig')
      const generated = result.files.find(file =>
        file.sourcePath === paths['Library/@ui/PrivateTypes.tao'] && file.relativePath.endsWith('.tsx')
      )
      Expect(generated?.code).not.toContain('TR.Enum(')
      Expect(generated?.code).not.toContain('__tao_type_SidecarStore')
      Expect(generated?.code).not.toContain('Secrets')
      const caseCompanion = result.files.find(file =>
        file.sourcePath === paths['Library/@ui/CaseOnly.tao'] && file.relativePath.endsWith('.d.ts')
      )
      Expect(caseCompanion?.code).toContain('export declare const HapticKind')
      const caseModule = result.files.find(file =>
        file.sourcePath === paths['Library/@ui/CaseOnly.tao'] && file.relativePath.endsWith('.tsx')
      )
      Expect(caseModule?.code).not.toContain('TR.Enum(')
      Expect(result.files.find(file => file.relativePath === 'TaoDataSchema.json')).toBeUndefined()
    })
  })

  Test('retains a private case value imported by a sidecar without collecting unrelated declarations', async () => {
    await withTaoFiles('tao-publication-sidecar-case-', {
      'Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only }
        use Widget from @widgets
        app Demo {
          id "com.tao.sidecarcase" version "1.0.0" name "Sidecar case" view Home
          requires "Widgets" from ./Library version ^1.0.0 { @ui as @widgets }
        }
        view Home() { render Widget() }
      `,
      'Library/.tao/.gitkeep': '',
      'Library/Publication.tao': 'package { name "Widgets" version 1.0.0 license AGPL-3.0-only includes @ui }',
      'Library/@ui/Widget.tao': 'public view Widget() from ./Widget.tsx',
      'Library/@ui/Widget.tsx': `
        import { HapticKind } from './PrivateTypes.tao'
        import type { SidecarStoreConfig } from './PrivateTypes.tao'
        export function Widget(_props: unknown) {
          void HapticKind.Light
          void (null as unknown as SidecarStoreConfig)
          return null
        }
      `,
      'Library/@ui/PrivateTypes.tao': `
        type HapticKind is one of Light, Heavy
        type SidecarStore is datasource with {
          StorageKey text
          supports { }
          provider MemoryProvider from ./Providers.ts
        }
        data Secrets / Secret { Name text }
      `,
      'Library/@ui/Providers.ts': 'export function MemoryProvider() { return {} }',
    }, async (paths, root) => {
      const result = await (await Workspace.open(root)).compile(paths['Main.tao']!)
      const sourcePaths = result.files.map(file => file.sourcePath)
      Expect(sourcePaths).not.toContain(paths['Library/@ui/Providers.ts'])
      const companion = result.files.find(file =>
        file.sourcePath === paths['Library/@ui/PrivateTypes.tao'] && file.relativePath.endsWith('.d.ts')
      )
      Expect(companion?.code).toContain('export type SidecarStoreConfig')
      const generated = result.files.find(file =>
        file.sourcePath === paths['Library/@ui/PrivateTypes.tao'] && file.relativePath.endsWith('.tsx')
      )
      Expect(generated?.code).toContain('export const HapticKind = _Scope.HapticKind')
      Expect(generated?.code).toContain('TR.Enum(')
      Expect(generated?.code).toContain('["Light", "Heavy"]')
      Expect(generated?.code).not.toContain('__tao_type_SidecarStore')
      Expect(generated?.code).not.toContain('Secrets')
      const sidecar = result.files.find(file => file.sourcePath === paths['Library/@ui/Widget.tsx'])
      const runtimeModule = FS.relativePath(
        FS.dirname(sidecar!.relativePath),
        generated!.relativePath,
      ).replace(/\.tsx$/, '')
      Expect(sidecar?.code).toContain(
        `import { HapticKind } from '${runtimeModule.startsWith('.') ? runtimeModule : `./${runtimeModule}`}'`,
      )
      Expect(sidecar?.code).toContain("import type { SidecarStoreConfig } from './PrivateTypes.tao'")
      Expect(result.files.find(file => file.relativePath === 'TaoDataSchema.json')).toBeUndefined()
    })
  })

  Test('emits a case-only private source as a runtime value when a sidecar imports it', async () => {
    await withTaoFiles('tao-publication-sidecar-case-only-', {
      'Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only }
        use Widget from @widgets
        app Demo {
          id "com.tao.sidecarcaseonly" version "1.0.0" name "Sidecar case only" view Home
          requires "Widgets" from ./Library version ^1.0.0 { @ui as @widgets }
        }
        view Home() { render Widget() }
      `,
      'Library/.tao/.gitkeep': '',
      'Library/Publication.tao': 'package { name "Widgets" version 1.0.0 license AGPL-3.0-only includes @ui }',
      'Library/@ui/Widget.tao': 'public view Widget() from ./Widget.tsx',
      'Library/@ui/Widget.tsx': `
        import { HapticKind } from './CaseOnly.tao'
        export function Widget(_props: unknown) { void HapticKind.Light; return null }
      `,
      'Library/@ui/CaseOnly.tao': 'type HapticKind is one of Light, Heavy',
    }, async (paths, root) => {
      const result = await (await Workspace.open(root)).compile(paths['Main.tao']!)
      const generated = result.files.find(file =>
        file.sourcePath === paths['Library/@ui/CaseOnly.tao'] && file.relativePath.endsWith('.tsx')
      )
      Expect(generated?.code).toContain('TR.Enum(')
      Expect(generated?.code).toContain('export const HapticKind = _Scope.HapticKind')
      Expect(
        result.files.some(file =>
          file.sourcePath === paths['Library/@ui/CaseOnly.tao'] && file.relativePath.endsWith('.d.ts')
        ),
      ).toBe(false)
    })
  })

  Test('rejects sidecars outside their owning Tao project', async () => {
    for (const route of ['direct', 'transitive', 'outside'] as const) {
      await withTaoFiles(`tao-publication-nested-sidecar-${route}-`, {
        'Main.tao': `
          package { version 1.0.0 license AGPL-3.0-only }
          use Widget from @widgets
          app Demo {
            id "com.tao.nestedsidecar" version "1.0.0" name "Nested sidecar" view Home
            requires "Widgets" from ./Library version ^1.0.0 { @ui as @widgets }
          }
          view Home() { render Widget() }
        `,
        'Library/.tao/.gitkeep': '',
        'Library/Publication.tao': 'package { name "Widgets" version 1.0.0 license AGPL-3.0-only includes @ui }',
        'Library/@ui/Widget.tao': `public view Widget() from ${
          route === 'direct'
            ? '../Nested/Widget.tsx'
            : route === 'outside'
            ? '../../Other/Widget.tsx'
            : './Widget.tsx'
        }`,
        'Library/@ui/Widget.tsx': `
          import { helper } from '../Nested/Helper'
          export function Widget(_props: unknown) { void helper; return null }
        `,
        'Library/Nested/.tao/.gitkeep': '',
        'Library/Nested/Widget.tsx': 'export function Widget(_props: unknown) { return null }',
        'Library/Nested/Helper.ts': 'export const helper = true',
        'Other/.tao/.gitkeep': '',
        'Other/Widget.tsx': 'export function Widget(_props: unknown) { return null }',
      }, async (paths, root) => {
        await Expect((await Workspace.open(root)).compile(paths['Main.tao']!))
          .rejects.toThrow('crosses a Tao project boundary')
      })
    }
  })

  Test('follows a publication requirement through a second public module and its private helper', async () => {
    await withTaoFiles('tao-compiler-transitive-publications-', {
      'Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only }
        use Widget from @widgets
        app Demo {
          id "com.tao.transitive" version "1.0.0" name "Transitive" view Home
          requires "A" from ./A version ^1.0.0 { @ui as @widgets }
        }
        view Home() { render Widget() }
      `,
      'A/.tao/.gitkeep': '',
      'A/Publication.tao': `
        package {
          name "A" version 1.0.0 license AGPL-3.0-only includes @ui
          requires "B" from ../B version ^1.0.0 { @core as @b }
          requires ts npm:date-fns version 4.1.0 as util
        }
      `,
      'A/Helper.tao': 'project let Prefix = "A"',
      'A/@ui/Widget.tao': `
        use Prefix from ../Helper
        use package @b as child
        view ChildAlias = child.BWidget
        public view Widget() { render ChildAlias(Prefix) }
      `,
      'B/.tao/.gitkeep': '',
      'B/Publication.tao':
        'package { name "B" version 1.0.0 license AGPL-3.0-only includes @core requires ts npm:date-fns version 3.6.0 as util }',
      'B/Helper.tao': 'project let Suffix = "B"',
      'B/OtherData.tao': 'data Secrets / Secret { Label text }',
      'B/@core/Label.tao': `
        use Suffix from ../Helper
        public view BWidget(Prefix text) { render Label(Prefix + Suffix) }
        view Label(Value text) from ./Native.tsx
      `,
      'B/@core/Native.tsx': 'export function Label(_props: unknown) { return null }',
      'Direct/.tao/.gitkeep': '',
      'Direct/Main.tao': `
        package { version 1.0.0 license AGPL-3.0-only requires "A" from ../A version ^1.0.0 { @ui as @widgets } }
        use BWidget from @b
        app Direct { id "com.tao.direct" version "1.0.0" name "Direct" view Home }
        view Home() { render BWidget("Direct") }
      `,
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao']!)
      const sources = compiled.files.map(file => file.sourcePath)
      Expect(sources).toContain(paths['A/@ui/Widget.tao'])
      Expect(sources).toContain(paths['A/Helper.tao'])
      Expect(sources).toContain(paths['B/@core/Label.tao'])
      Expect(sources).toContain(paths['B/Helper.tao'])
      Expect(sources).not.toContain(paths['B/OtherData.tao'])
      const bNamespace = BridgeMetadata.dependencyNamespace(FS.resolvePath('B', root))
      const aEnvironment = compiled.dependencyEnvironments.find(item => item.projectRoot === FS.resolvePath('A', root))
      const bEnvironment = compiled.dependencyEnvironments.find(item => item.projectRoot === FS.resolvePath('B', root))
      Expect(compiled.dependencyEnvironments.map(item => item.projectRoot)).toContain(root)
      Expect(aEnvironment?.npm).toEqual([{ alias: 'util', packageName: 'date-fns', versionRange: '4.1.0' }])
      Expect(aEnvironment?.publications).toEqual([{ name: 'A', version: '1.0.0' }])
      Expect(bEnvironment?.namespace).toBe(bNamespace)
      Expect(bEnvironment?.npm).toEqual([{ alias: 'util', packageName: 'date-fns', versionRange: '3.6.0' }])
      Expect(bEnvironment?.publications).toEqual([{ name: 'B', version: '1.0.0' }])
      Expect(compiled.files.find(file => file.sourcePath === paths['B/@core/Label.tao'])?.relativePath)
        .toBe(`modules/dependencies/${bNamespace}/@core/Label.tao.tsx`)
      Expect(compiled.files.find(file => file.sourcePath === paths['B/@core/Native.tsx'])?.relativePath)
        .toBe(`modules/dependencies/${bNamespace}/@core/Native.tsx`)
      const bIdentity = JSON.stringify([
        'tao.declaration',
        1,
        ProjectIdentity.read(FS.resolvePath('B', root)),
        '@core',
        'Label',
        'view',
        'BWidget',
      ])
      Expect(compiled.files.map(file => file.code).join('\n').split(bIdentity).length - 1).toBeGreaterThan(1)
      const direct = await (await Workspace.open(FS.resolvePath('Direct', root))).validate(paths['Direct/Main.tao']!)
      Expect(direct.diagnostics.map(diagnostic => diagnostic.message).join('\n')).toContain('@b')
    })
  })
})

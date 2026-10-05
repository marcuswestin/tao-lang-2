import { Workspace } from '@compiler/workspace'
import { Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { type CompileOptions, type CompileResult, EmittedModuleCache } from '../compiler-src/compiler'

function assertSameOutput(cached: CompileResult, fresh: CompileResult): void {
  Expect(cached.files).toEqual(fresh.files)
  Expect(cached.code).toBe(fresh.code)
  Expect(cached.studioManifest).toEqual(fresh.studioManifest)
  Expect(cached.validation.diagnostics).toEqual(fresh.validation.diagnostics)
}

Describe('emitted Tao module cache', () => {
  for (const configurationName of ['appFirebaseConfiguration', 'appAuthConfiguration'] as const) {
    for (const change of ['changed', 'removed'] as const) {
      Test(`invalidates ${change} ${configurationName} without source edits`, async () => {
        await withTaoFiles('tao-emitted-firebase-configuration-', {
          'Main.tao': `
          use FirebaseAuth from @tao/auth/firebase
          use Firebase from @tao/data/providers/firebase
          data Notes / Note { Title text }
          app Preview {
            id "com.tao.cache.firebase" version "1.0.0" name "Preview"
            Auth FirebaseAuth { ApiKey "source-auth-key", ProjectId "source-project" }
            Datasource Firebase { ApiKey "source-data-key", ProjectId "source-project" }
            view Main
          }
          view Main() { render inject \`\`\`ts return null \`\`\` }
        `,
        }, async (paths, root) => {
          const cache = new EmittedModuleCache()
          const entries = [paths['Main.tao']!]
          const compile = async (options: CompileOptions, cached: boolean) =>
            await (await Workspace.open(root)).compileFiles(entries, {
              appName: 'Preview',
              studio: true,
              ...options,
              ...(cached ? { emittedModuleCache: cache } : {}),
            })
          const initialOptions = { [configurationName]: { ApiKey: 'override-first' } }
          const initial = await compile(initialOptions, true)
          Expect(initial.code).toContain('"ApiKey": TR.Value("override-first")')
          const unchanged = await compile(initialOptions, true)
          Expect(unchanged.emittedModuleCache?.files.find(file => file.sourcePath === paths['Main.tao'])?.hit)
            .toBe(true)
          assertSameOutput(unchanged, await compile(initialOptions, false))

          const currentOptions = change === 'changed' ? { [configurationName]: { ApiKey: 'override-second' } } : {}
          const current = await compile(currentOptions, true)
          assertSameOutput(current, await compile(currentOptions, false))
          Expect(current.code).not.toContain('override-first')
          if (change === 'changed') {
            Expect(current.code).toContain('"ApiKey": TR.Value("override-second")')
          } else {
            Expect(current.code).toContain('"ApiKey": TR.Value("source-auth-key")')
            Expect(current.code).toContain('"ApiKey": TR.Value("source-data-key")')
          }
          Expect(current.emittedModuleCache?.files.find(file => file.sourcePath === paths['Main.tao'])?.hit)
            .toBe(false)
        })
      })
    }
  }

  Test('retains an unchanged Studio consumer design cohort until its own source changes', async () => {
    await withTaoFiles('tao-emitted-design-epochs-', {
      'Main.tao': `
        use StackNav from @tao/nav
        use Text from @tao/ui
        use Theme from ./Theme
        app Demo { id "com.tao.cache.design" version "1.0.0" name "Demo" Navigator StackNav { Initial Main } Design Theme }
        scene Main() { Title "Main" render Text("first") }
      `,
      'Theme.tao': 'public design Theme { paper #fff panel [bg paper] }',
    }, async (paths, root) => {
      const cache = new EmittedModuleCache()
      const entries = [paths['Main.tao']!, paths['Theme.tao']!]
      const originalMain = await FS.readText(paths['Main.tao']!)
      const originalTheme = await FS.readText(paths['Theme.tao']!)
      const editedTheme = 'public design Theme { paper #000 panel [bg paper] }'
      const editedMain = originalMain.replace('"first"', '"second"')
      const compile = async (main: string, theme: string, mainEpoch: number, themeEpoch: number, cached: boolean) =>
        await (await Workspace.open(root, {
          sourceOverrides: { [paths['Main.tao']!]: main, [paths['Theme.tao']!]: theme },
        })).compileFiles(entries, {
          studio: true,
          studioSourceEpochs: { 'Main.tao': mainEpoch, 'Theme.tao': themeEpoch },
          ...(cached ? { emittedModuleCache: cache } : {}),
        })
      const moduleCode = (result: CompileResult, path: string) =>
        result.files.find(file => file.sourcePath === path && file.relativePath.endsWith('.tsx'))?.code

      const cold = await compile(originalMain, originalTheme, 1, 1, true)
      const warm = await compile(originalMain, originalTheme, 1, 1, true)
      assertSameOutput(warm, await compile(originalMain, originalTheme, 1, 1, false))
      Expect(warm.emittedModuleCache?.files.find(file => file.sourcePath === paths['Main.tao'])?.hit).toBe(true)
      Expect(moduleCode(cold, paths['Main.tao']!)).toContain('element-default')
      Expect(moduleCode(cold, paths['Main.tao']!)).toContain('designEpochs')
      Expect(moduleCode(cold, paths['Main.tao']!)?.split('const __tao_design_cohort__ = TR.Design.Cohort({'))
        .toHaveLength(2)
      Expect(moduleCode(cold, paths['Main.tao']!)).toContain('cohort: __tao_design_cohort__')
      Expect(moduleCode(cold, paths['Theme.tao']!)).toContain('sourceEpochs')
      Expect(moduleCode(cold, paths['Theme.tao']!)?.split('const __tao_design_cohort__ = TR.Design.Cohort({'))
        .toHaveLength(2)
      Expect(moduleCode(cold, paths['Theme.tao']!)).toContain('cohort: __tao_design_cohort__')

      const designOnly = await compile(originalMain, editedTheme, 1, 2, true)
      Expect(designOnly.emittedModuleCache?.files.find(file => file.sourcePath === paths['Main.tao'])?.hit).toBe(true)
      Expect(designOnly.emittedModuleCache?.files.find(file => file.sourcePath === paths['Theme.tao'])?.hit).toBe(false)
      Expect(moduleCode(designOnly, paths['Main.tao']!)).toBe(moduleCode(cold, paths['Main.tao']!))
      Expect(moduleCode(designOnly, paths['Theme.tao']!)).not.toBe(moduleCode(cold, paths['Theme.tao']!))

      const consumerEdited = await compile(editedMain, editedTheme, 3, 2, true)
      Expect(consumerEdited.emittedModuleCache?.files.find(file => file.sourcePath === paths['Main.tao'])?.hit).toBe(
        false,
      )
      Expect(moduleCode(consumerEdited, paths['Main.tao']!)).not.toBe(moduleCode(designOnly, paths['Main.tao']!))
      const freshlyEmittedConsumer = await compile(editedMain, editedTheme, 3, 2, false)
      Expect(moduleCode(consumerEdited, paths['Main.tao']!))
        .toBe(moduleCode(freshlyEmittedConsumer, paths['Main.tao']!))

      const designShape = await compile(editedMain, `${editedTheme}\npublic design Other {}`, 3, 4, true)
      Expect(designShape.emittedModuleCache?.files.find(file => file.sourcePath === paths['Main.tao'])?.hit).toBe(false)
      const mixedSource = await compile(editedMain, `${editedTheme}\npublic let Marker = "value"`, 3, 5, true)
      Expect(mixedSource.emittedModuleCache?.files.find(file => file.sourcePath === paths['Main.tao'])?.hit).toBe(false)
      const reverted = await compile(originalMain, originalTheme, 6, 6, true)
      Expect(reverted.emittedModuleCache?.files.find(file => file.sourcePath === paths['Main.tao'])?.hit).toBe(false)
      Expect(reverted.emittedModuleCache?.files.find(file => file.sourcePath === paths['Theme.tao'])?.hit).toBe(false)
    })
  })

  Test('reuses unchanged HNReader modules across Studio source overlays', async () => {
    const root = Repo.resolvePath('Apps/HNReader')
    const entry = FS.resolvePath('HNReader.tao', root)
    const probe = FS.resolvePath('@/studio/LatencyProbe.tao', root)
    const source = (label: string) =>
      `use Col, Text from @tao/ui
public view LatencyProbe() { render Col() { Text("${label}") } }
scenarios LatencyProbe "latency" { device phone scenario "probe" { render () } }`
    const cache = new EmittedModuleCache()
    const compile = async (label: string, useCache: boolean) =>
      await (await Workspace.open(root, { sourceOverrides: { [probe]: source(label) } })).compileFiles(
        [entry, probe],
        { appName: 'HNReaderStub', studio: true, ...(useCache ? { emittedModuleCache: cache } : {}) },
      )
    const cold = await compile('first', true)
    const warm = await compile('first', true)
    const edited = await compile('second', true)
    Expect(cold.emittedModuleCache?.misses).toBeGreaterThan(10)
    Expect(warm.emittedModuleCache?.hits).toBeGreaterThan(10)
    Expect(edited.emittedModuleCache?.hits).toBeGreaterThan(10)
    Expect(edited.emittedModuleCache?.misses).toBeLessThan(cold.emittedModuleCache!.misses)
    assertSameOutput(edited, await compile('second', false))
  })

  Test('reuses a validated source snapshot and misses only the changed view and its Studio root', async () => {
    await withTaoFiles('tao-emitted-module-cache-', {
      'Main.tao':
        'use First from ./First\napp Preview { id "com.tao.cache.preview" version "1.0.0" name "Preview" view Main } view Main() { render First() }',
      'First.tao': 'public view First() { render inject ```ts return null ``` }',
      'Second.tao': 'public view Second() { render inject ```ts return null ``` }',
    }, async (paths, root) => {
      const cache = new EmittedModuleCache()
      const entries = [paths['Main.tao']!, paths['First.tao']!, paths['Second.tao']!]
      const compile = async (overrides: Readonly<Record<string, string>> = {}, debug = false) =>
        await (await Workspace.open(root, { sourceOverrides: overrides })).compileFiles(entries, {
          studio: true,
          debug,
          emittedModuleCache: cache,
        })
      const cold = await compile()
      const warm = await compile()
      Expect(cold.emittedModuleCache?.hits).toBe(0)
      Expect(warm.emittedModuleCache?.misses).toBe(0)
      Expect(warm.emittedModuleCache?.hits).toBeGreaterThan(2)
      assertSameOutput(warm, await (await Workspace.open(root)).compileFiles(entries, { studio: true }))

      const override = { [paths['First.tao']!]: 'public view First() { render inject ```ts return "edited" ``` }' }
      const edited = await compile(override)
      const changed = edited.emittedModuleCache?.files.filter(file => !file.hit).map(file => file.sourcePath)
      Expect(changed).toContain(paths['First.tao'])
      Expect(changed).toContain(paths['Main.tao'])
      Expect(edited.emittedModuleCache?.files.find(file => file.sourcePath === paths['Second.tao'])?.hit).toBe(true)
      assertSameOutput(
        edited,
        await (await Workspace.open(root, { sourceOverrides: override })).compileFiles(entries, {
          studio: true,
        }),
      )

      const debug = await compile(override, true)
      Expect(debug.emittedModuleCache?.misses).toBeGreaterThan(0)
      assertSameOutput(
        debug,
        await (await Workspace.open(root, { sourceOverrides: override })).compileFiles(entries, {
          studio: true,
          debug: true,
        }),
      )

      const extraPath = FS.resolvePath('Third.tao', root)
      const withExtra = {
        ...override,
        [paths['Main.tao']!]:
          'use Third from ./Third\napp Preview { id "com.tao.cache.preview" version "1.0.0" name "Preview" view Main } view Main() { render Third() }',
        [extraPath]: 'public view Third() { render inject ```ts return null ``` }',
      }
      const extraEntries = [...entries, extraPath]
      const extra = await (await Workspace.open(root, { sourceOverrides: withExtra })).compileFiles(extraEntries, {
        studio: true,
        emittedModuleCache: cache,
      })
      Expect(extra.emittedModuleCache?.misses).toBeGreaterThan(0)
      Expect(extra.emittedModuleCache?.files.find(file => file.sourcePath === extraPath)?.hit).toBe(false)
      assertSameOutput(
        extra,
        await (await Workspace.open(root, { sourceOverrides: withExtra })).compileFiles(
          extraEntries,
          { studio: true },
        ),
      )
    })
  })

  Test('invalidates imported, folder-visible, package, and data dependencies', async () => {
    await withTaoFiles('tao-emitted-module-dependencies-', {
      'Main.tao':
        'use PackageValue from @feature\napp Preview { id "com.tao.cache.dependencies" version "1.0.0" name "Preview" view Main } view Main() { render Text(PackageValue + Shared) } view Text(Value text) { render inject Value ```ts return null ``` }',
      'Sibling.tao': 'folder let Shared = "sibling"',
      '@feature/Value.tao': 'public let PackageValue = "package"',
      'Data.tao': 'public data Notes / Note { Title text }',
    }, async (paths, root) => {
      const entries = [
        paths['Main.tao']!,
        paths['Sibling.tao']!,
        paths['@feature/Value.tao']!,
        paths['Data.tao']!,
      ]
      const cache = new EmittedModuleCache()
      const compile = async (sourceOverrides: Readonly<Record<string, string>>) =>
        await (await Workspace.open(root, { sourceOverrides })).compileFiles(entries, { emittedModuleCache: cache })
      await compile({})
      const changedSources = [
        [paths['Sibling.tao']!, 'folder let Shared = "new sibling"'],
        [paths['@feature/Value.tao']!, 'public let PackageValue = "new package"'],
        [paths['Data.tao']!, 'public data Notes / Note { Title text, Body text }'],
      ] as const
      for (const [path, source] of changedSources) {
        const sourceOverrides = { [path]: source }
        const edited = await compile(sourceOverrides)
        Expect(edited.emittedModuleCache?.files.find(file => file.sourcePath === path)?.hit).toBe(false)
        assertSameOutput(edited, await (await Workspace.open(root, { sourceOverrides })).compileFiles(entries))
      }
    })
  })

  Test('re-copies changed TypeScript sidecars and validates before cache lookup', async () => {
    await withTaoFiles('tao-emitted-module-sidecar-', {
      'Main.tao':
        'use Foreign from ./Foreign\napp Preview { id "com.tao.cache.sidecar" version "1.0.0" name "Preview" view Main } view Main() { render Foreign() }',
      'Foreign.tao': 'public view Foreign() from ./Foreign.ts',
      'Foreign.ts': 'export function Foreign() { return "first" }',
    }, async (paths, root) => {
      const cache = new EmittedModuleCache()
      const entries = [paths['Main.tao']!, paths['Foreign.tao']!]
      const compile = async (sourceOverrides: Readonly<Record<string, string>> = {}) =>
        await (await Workspace.open(root, { sourceOverrides })).compileFiles(entries, { emittedModuleCache: cache })
      await compile()
      await FS.writeText(paths['Foreign.ts']!, 'export function Foreign() { return "second" }')
      const copied = await compile()
      Expect(copied.emittedModuleCache?.hits).toBeGreaterThan(0)
      Expect(copied.files.find(file => file.relativePath.endsWith('Foreign.ts'))?.code).toContain('"second"')
      assertSameOutput(copied, await (await Workspace.open(root)).compileFiles(entries))

      const invalid = { [paths['Foreign.tao']!]: 'public view Foreign() { render Missing() }' }
      const validation = await (await Workspace.open(root, { sourceOverrides: invalid })).validateFiles(entries)
      Expect(Diagnostics.errorMessages(validation.diagnostics).length).toBeGreaterThan(0)
      await Expect(compile(invalid)).rejects.toThrow('validation errors')
    })
  })
})

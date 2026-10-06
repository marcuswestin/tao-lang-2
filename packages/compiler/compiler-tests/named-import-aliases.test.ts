import { Workspace } from '@compiler/workspace'
import { Assert, CLI, Diagnostics, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import type { CompileResult } from '../compiler-src/compiler'

async function executeModules(compiled: CompileResult, root: string, sourcePath: string, expression: string) {
  Expect(Diagnostics.errorMessages(compiled.validation.diagnostics)).toEqual([])
  const entry = compiled.files.find(file => file.sourcePath === sourcePath && file.relativePath.endsWith('.tsx'))
  Assert.defined(entry, 'the alias consumer has an emitted runtime module')
  const output = FS.resolvePath('output', root)
  const runtime = Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts')
  await FS.mkdir(output)
  await FS.symlink(Repo.resolvePath('packages/apps/runtime/node_modules'), FS.resolvePath('node_modules', output))
  for (const file of compiled.files) {
    // Keep generated module links intact; only connect the runtime package to its real source.
    await FS.writeText(
      FS.resolvePath(file.relativePath, output),
      file.code.replaceAll("'@runtime/TR'", JSON.stringify(runtime)),
    )
  }
  await FS.writeText(
    FS.resolvePath('Consumer.ts', root),
    `
    import * as Consumer from ${JSON.stringify(FS.resolvePath(entry.relativePath, output))};
    import TR from ${JSON.stringify(runtime)};
    import * as Platform from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/Platform.ts'))};
    Platform.runtimeConsole.info(JSON.stringify(${expression}));
  `,
  )
  const launcher = FS.resolvePath('Launcher.ts', root)
  await FS.writeText(
    launcher,
    `
    import { MockModule } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts'))};
    import { reactNativeStubs } from ${
      JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/TestReactNative.ts'))
    };
    MockModule('react-native', () => reactNativeStubs({ Platform: { OS: 'ios' } }));
    await import('./Consumer.ts');
  `,
  )
  const run = await CLI.run(Platform.runtimeProcess.execPath, {
    cwd: root,
    args: [launcher],
    processPolicy: 'test',
  })
  Expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: '' })
  return JSON.parse(run.stdout)
}

Describe('compiler: named import aliases', () => {
  Test('executes distinct same-name exports beside a local source-name shadow', async () => {
    await withTaoFiles('tao-import-alias-execution-', {
      'Main.tao': `
        use Value as LeftValue, Value as Again, Read as LeftRead from ./left/Values
        use Value as RightValue, Read as RightRead from ./right/Values
        let Value = "local"
        let __tao_imported_1__ = "reserved"
        public func Read() -> text { return "{LeftValue}|{RightValue}|{Value}|{LeftRead()}|{RightRead()}|{Again}|{__tao_imported_1__}" }
        app Demo { id "com.tao.import.alias" version "1.0.0" name "Alias" view Home }
        view Home { render inject \`\`\`ts return null \`\`\` }
      `,
      'left/Values.tao': 'public let Value = "left" public func Read() -> text { return Value }',
      'right/Values.tao': 'public let Value = "right" public func Read() -> text { return Value }',
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
      Expect(await executeModules(compiled, root, paths['Main.tao'], 'TR.Call(Consumer.Read).getJSValue()'))
        .toBe('left|right|local|left|right|left|reserved')
    })
  })

  Test('binds an aliased imported app base from its captured module scope', async () => {
    await withTaoFiles('tao-import-alias-app-', {
      'Main.tao': `
        use Base as ImportedBase from ./base/App.tao
        app Variant = ImportedBase with { id "com.tao.alias.variant", version "2.0.0" }
        let Base = "local"
        public func Read() -> text { return Base }
      `,
      'base/App.tao': `
        public app Base { id "com.tao.alias.base" version "1.0.0" name "Inherited" view Home }
        view Home { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'], { appName: 'Variant' })
      Expect(
        await executeModules(
          compiled,
          root,
          paths['Main.tao'],
          `({
        name: Consumer.Variant.definition.name,
        id: Consumer.Variant.definition.id,
        reboundName: Consumer.Variant.definition.bindApp('com.tao.alias.rebound').name(),
        local: TR.Call(Consumer.Read).getJSValue(),
      })`,
        ),
      ).toEqual({ name: 'Inherited', id: 'com.tao.alias.variant', reboundName: 'Inherited', local: 'local' })
    })
  })

  Test('keeps an imported configurable type and its same-name value bound to their real owner', async () => {
    await withTaoFiles('tao-import-alias-configured-', {
      'Main.tao': `
        use CustomStack as ImportedStack from ./nav/Constructs
        let CustomStack = "local"
        public let FromType = ImportedStack { Initial Home }
        public let FromValue = ImportedStack
        app Demo { id "com.tao.alias.configured" version "1.0.0" name "Alias" view Home }
        view Home { render inject \`\`\`ts return null \`\`\` }
      `,
      'nav/Constructs.tao': `
        public type CustomStack is nav with { Initial view nav Impl from ./Impl.ts }
        public nav CustomStack = CustomStack { Initial PackageHome }
        view PackageHome { render inject \`\`\`ts return null \`\`\` }
      `,
      'nav/Impl.ts': "import TR from '@runtime/TR'; export function Impl() { return TR.NavKind.Stack() }",
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
      Expect(
        await executeModules(
          compiled,
          root,
          paths['Main.tao'],
          `(() => {
        const made = Consumer.FromType.evaluate();
        const imported = Consumer.FromValue.evaluate();
        return {
          owner: made.declaration.name,
          sameOwner: made.declaration === imported.declaration,
          sameInitial: made.config.Initial === imported.config.Initial,
        };
      })()`,
        ),
      ).toEqual({ owner: 'CustomStack', sameOwner: true, sameInitial: false })
    })
  })

  for (const mode of ['wildcard', 'folder'] as const) {
    Test(`reserves a ${mode} import before allocating private alias bindings`, async () => {
      await withTaoFiles('tao-import-alias-prefix-', {
        'Main.tao': `
          use Value as Other from ./other/Values
          ${mode === 'wildcard' ? 'use all from ./prefix/Values' : ''}
          public func Read() -> text { return "{__tao_imported_1__}|{Other}" }
          app Demo { id "com.tao.alias.prefix" version "1.0.0" name "Alias" view Home }
          view Home { render inject \`\`\`ts return null \`\`\` }
        `,
        'other/Values.tao': 'public let Value = "aliased"',
        [mode === 'wildcard' ? 'prefix/Values.tao' : 'Folder.tao']: `${
          mode === 'wildcard' ? 'public' : 'folder'
        } let __tao_imported_1__ = "ordinary"`,
      }, async (paths, root) => {
        const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
        Expect(await executeModules(compiled, root, paths['Main.tao'], 'TR.Call(Consumer.Read).getJSValue()'))
          .toBe('ordinary|aliased')
      })
    })
  }
})

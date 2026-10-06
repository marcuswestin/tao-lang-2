import { Assert, CLI, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '../compiler-src/workspace'

const { default: TR } = await import(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))

Describe('compiler: pick expressions', () => {
  Test('executes first-match picks lazily, observes one subject, and returns total boolean values', async () => {
    await withCompiledFixture(async ({ actions, code, native }) => {
      Expect(code).toContain('TR.Errors.failInvariant("A validated exhaustive pick did not match.")')

      Expect(TR.Call(actions['PredicatePick']).evaluate().jsValue).toBe('first')
      Expect(native.Events()).toEqual(['condition:first', 'value:first'])

      native.Reset()
      Expect(TR.Call(actions['SubjectPick']).evaluate().jsValue).toBe('yes')
      Expect(native.Events()).toEqual(['subject', 'value:yes'])

      native.Reset()
      Expect(TR.Call(actions['FallbackPick']).evaluate().jsValue).toBe('fallback')
      Expect(native.Events()).toEqual(['value:fallback'])

      Expect(TR.Call(actions['BooleanPick'], TR.Value(true)).evaluate().jsValue).toBe('yes')
      Expect(TR.Call(actions['BooleanPick'], TR.Value(false)).evaluate().jsValue).toBe('no')
    })
  })
})

async function withCompiledFixture(
  test: (fixture: {
    actions: Record<string, any>
    code: string
    native: { Events(): string[]; Reset(): void }
  }) => Promise<void>,
): Promise<void> {
  await withTaoFiles('tao-pick-expressions-', {
    'Main.tao': `
      use PredicatePick from ./Actions
      use SubjectPick from ./Actions
      use FallbackPick from ./Actions
      use BooleanPick from ./Actions
      app PickExpressions { id "com.tao.pickexpressions" version "1.0.0" name "Pick expressions" view Main }
      view Main() { render Empty() }
      view Empty() { render inject \`\`\`ts return null \`\`\` }
    `,
    'Actions.tao': `
      public func ProbeCondition(Key text) -> boolean { return ProbeCondition(Key) from ./Native.ts }
      public func ProbeValue(Key text) -> text { return ProbeValue(Key) from ./Native.ts }
      public func ReadSubject() -> boolean { return ReadSubject() from ./Native.ts }
      public func PredicatePick() -> text {
        return pick {
          ProbeCondition("first") -> ProbeValue("first")
          ProbeCondition("second") -> ProbeValue("second")
          true -> ProbeValue("terminal")
        }
      }
      public func SubjectPick() -> text {
        return pick ReadSubject() {
          yes -> ProbeValue("yes")
          no -> ProbeValue("no")
        }
      }
      public func FallbackPick() -> text {
        return pick {
          false -> ProbeValue("never")
          otherwise -> ProbeValue("fallback")
        }
      }
      public func BooleanPick(Value yes/no) -> text {
        return pick Value {
          yes -> "yes"
          no -> "no"
        }
      }
    `,
    'Native.ts': `
      const events: string[] = []
      export function ProbeCondition(key: string): boolean { events.push("condition:" + key); return true }
      export function ProbeValue(key: string): string { events.push("value:" + key); return key }
      export function ReadSubject(): boolean { events.push("subject"); return true }
      export function Events(): string[] { return events }
      export function Reset(): void { events.length = 0 }
    `,
  }, async (paths, root) => {
    const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
    const output = FS.resolvePath('output', root)
    for (const file of compiled.files) {
      await FS.writeText(FS.resolvePath(file.relativePath, output), file.code)
    }
    await FS.symlink(
      Repo.resolvePath('packages/apps/expo-host/node_modules'),
      FS.resolvePath('node_modules', root),
    )
    const config = FS.resolvePath('tsconfig.json', root)
    await FS.writeJson(config, {
      extends: Repo.resolvePath('packages/tsconfig.base.json'),
      compilerOptions: {
        allowImportingTsExtensions: true,
        composite: false,
        declaration: false,
        incremental: false,
        jsx: 'react-jsx',
        lib: ['ES2023', 'DOM'],
        noEmit: true,
        rootDir: '/',
        typeRoots: [Repo.resolvePath('node_modules/@types')],
        types: ['bun', 'node'],
      },
      include: [`${output}/**/*.ts`, `${output}/**/*.tsx`],
    })
    const checked = await CLI.run('bun', {
      args: [Repo.resolvePath('node_modules/typescript-native/bin/tsc'), '--project', config],
    })
    Assert(checked.exitCode === 0, 'compiled pick expression graph typechecks', {
      stdout: checked.stdout,
      stderr: checked.stderr,
    })

    const appModule = compiled.files.find(file =>
      file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
    )
    const actionModule = compiled.files.find(file =>
      file.sourcePath === paths['Actions.tao'] && file.relativePath.endsWith('.tsx')
    )
    const nativeModule = compiled.files.find(file => file.sourcePath === paths['Native.ts'])
    Assert.defined(appModule, 'the authored app is emitted as a TSX module')
    Assert.defined(actionModule, 'the source pick functions are emitted as a TSX module')
    Assert.defined(nativeModule, 'the pick observation sidecar is copied')
    const actions = await import(FS.resolvePath(actionModule.relativePath, output))
    const native = await import(FS.resolvePath(nativeModule.relativePath, output))
    await test({ actions, code: actionModule.code, native })
  })
}

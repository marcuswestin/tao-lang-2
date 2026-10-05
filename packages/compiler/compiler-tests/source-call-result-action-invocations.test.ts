import { Assert, CLI, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import Validator from '@validator'
import { Workspace } from '../compiler-src/workspace'

const { default: TR } = await import(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))
const { settleActionRoots } = await import(
  Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-transactions.ts')
)

Describe('compiler: actions on function results', () => {
  Test('evaluates the receiver once and binds typed many-action arguments and results', async () => {
    await withCompiledFixture(async ({ actions, configure, events, reads }) => {
      const first = { Title: 'first' }
      const second = { Title: 'second' }
      configure([first, second])

      await TR.Do(actions['Run'], TR.Value('feed'), TR.Value('entry'), TR.Value(7))
      await TR.Do(actions['Run'], TR.Value('feed'), TR.Value('rejected'), TR.Value(0))

      Expect(reads()).toBe(2)
      Expect(events()).toEqual([
        'first',
        'second',
        'entry:7',
        'result:result:entry',
        'result:failure:Limit rejected.',
      ])
    })
  })

  Test('does not treat a function result member as an action unless the receiver owns that action', async () => {
    const validation = await Validator.validateCode(`
      type Token is text with { func Again() -> Token { return Token } }
      func Load() -> Token { return "token" }
      action Invalid() { do Load().Again() }
    `)

    Expect(Diagnostics.hasError(validation.diagnostics)).toBe(true)
    Expect(Diagnostics.errorMessages(validation.diagnostics).some(message => message.includes('Again'))).toBe(true)
  })
})

async function withCompiledFixture(
  test: (fixture: {
    actions: Record<string, any>
    configure(value: Array<{ Title: string }>): void
    events(): string[]
    reads(): number
  }) => Promise<void>,
): Promise<void> {
  await settleActionRoots()
  TR.Debug.Reset()
  try {
    await withTaoFiles('tao-call-result-action-', {
      'Main.tao': `
        use Run from ./Actions
        app CallResultAction { id "com.tao.callresult" version "1.0.0" name "Call result action" view Main }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
      'Actions.tao': `
        type ReturnFailure is one of Rejected
        public data Books / Book {
          Title text,
          action Books.Return(Label text, Limit number) -> text {
            if Limit == 0 { fail Rejected "Limit rejected." }
            do Observe(Books, Label, Limit)
            return Label
          }
        }
        action Observe(Items list of Book, Label text, Limit number) from ./Native.ts
        action ObserveResult(Result text) from ./Native.ts
        public function LoadedItems(Feed text) returns Books {
          return LoadedItems(Feed) from ./Native.ts
        }
        public action Run(Feed text, Label text, Limit number) {
          do LoadedItems(Feed).Return(Limit: Limit, Label: Label) then {
            done Result -> { do ObserveResult("result:{Result}") }
            error Problem -> { do ObserveResult("failure:{Problem.Message}") }
          }
        }
      `,
      'Native.ts': `
        type Book = { Title: string }
        let books: Book[] = []
        let reads = 0
        const events: string[] = []
        export function LoadedItems(feed: string): Book[] {
          void feed
          reads++
          return books
        }
        export function Observe(items: Book[], label: string, limit: number): void {
          events.push(...items.map(item => item.Title))
          events.push(label + ":" + limit)
          if (items.length !== books.length || items.some((item, index) => item !== books[index])) {
            throw new Error("associated receiver changed the returned entity identities")
          }
        }
        export function ObserveResult(result: string): void { events.push("result:" + result) }
        export function Configure(value: Book[]): void { books = value }
        export function Events(): string[] { return events }
        export function Reads(): number { return reads }
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
      Assert(checked.exitCode === 0, 'compiled function-result action graph typechecks', {
        stdout: checked.stdout,
        stderr: checked.stderr,
      })

      const actionModule = compiled.files.find(file =>
        file.sourcePath === paths['Actions.tao'] && file.relativePath.endsWith('.tsx')
      )
      const nativeModule = compiled.files.find(file => file.sourcePath === paths['Native.ts'])
      Assert.defined(actionModule, 'the actions module is emitted')
      Assert.defined(nativeModule, 'the native probe sidecar is copied')
      const actions = await import(FS.resolvePath(actionModule.relativePath, output))
      const native = await import(FS.resolvePath(nativeModule.relativePath, output))
      await test({
        actions,
        configure: native.Configure,
        events: native.Events,
        reads: native.Reads,
      })
    })
  } finally {
    TR.Debug.Reset()
    await settleActionRoots()
  }
}

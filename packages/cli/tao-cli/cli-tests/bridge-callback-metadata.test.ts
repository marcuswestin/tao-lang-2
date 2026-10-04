import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, withTaoFixture } from './test-cli-files'

Describe('TypeScript bridge callback metadata', () => {
  Test('checks foreign action callback values as invokable runtime actions', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': 'action Register(Callback action(text)) from ./Register.ts\n',
      'Register.ts': `import type TR from '@tao/runtime'
export function Register(callback: TR.ActionValue<[TR.Value<string>]>): void { void callback.invoke }
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      Expect(await FS.readText(FS.resolvePath('.tao-ts/Main.tao.ts', root)))
        .toContain('arg0: TR.ActionValue<[TR.Value<string>]>')
    })
  })

  Test('passes invokable callbacks through function and bare-action bridges', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': `function Register(Callback action(text)) returns number {
   return Register(Callback) from ./Register.ts
}
let Open is action(action(text)) = Open from ./Open.ts
`,
      'Register.ts': `import type TR from '@tao/runtime'
export function Register(callback: TR.ActionValue<[TR.Value<string>]>): number {
   return typeof callback.invoke === 'function' ? 1 : 0
}
`,
      'Open.ts': `import type TR from '@tao/runtime'
export function Open(callback: TR.ActionValue<[TR.Value<string>]>): void { void callback.invoke }
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      const metadata = await FS.readText(FS.resolvePath('.tao-ts/Main.tao.ts', root))
      Expect(metadata).toContain('Register = (arg0: TR.ActionValue<[TR.Value<string>]>) => number')
      Expect(metadata).toContain('Open = (arg0: TR.ActionValue<[TR.Value<string>]>) => void | Promise<void>')
    })
  })

  Test('groups lists of actions without turning the function into the array', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': `function Echo(Callbacks list of action(text)) returns list of action(text) {
   return Echo(Callbacks) from ./Echo.ts
}
`,
      'Echo.ts': `import type TR from '@tao/runtime'
export const Echo = (callbacks: Array<TR.ActionValue<[TR.Value<string>]>>) => callbacks
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      Expect(await FS.readText(FS.resolvePath('.tao-ts/Main.tao.ts', root)))
        .toContain('Array<TR.ActionValue<[TR.Value<string>]>>')
    })
  })
})

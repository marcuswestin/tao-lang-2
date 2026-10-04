import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, withTaoFixture } from './test-cli-files'

const functionSource = `function CountWords(Value text) returns number {
   return CountWords(Value) from ./Words.ts
}
`

Describe('TypeScript bridge metadata', () => {
  Test('generates a typed named export check in the project output directory', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': functionSource,
      'Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      const metadata = await FS.readText(FS.resolvePath('.tao-ts/Main.tao.ts', root))
      Expect(metadata).toContain('export type CountWords = (arg0: string) => number')
      Expect(metadata).toContain('__TaoBridgeCheck<CountWords, typeof Sidecar.CountWords>')
      await FS.remove(FS.resolvePath('.tao-ts/Main.tao.ts', root))
      await runCheck(root)
      Expect(await FS.isFile(FS.resolvePath('.tao-ts/Main.tao.ts', root))).toBe(true)
      await FS.writeText(
        FS.resolvePath('Main.tao', root),
        'function CountWords(Value text) returns number {\n   return 1\n}\n',
      )
      await runCheck(root)
      Expect(await FS.isFile(FS.resolvePath('.tao-ts/Main.tao.ts', root))).toBe(false)
    })
  })

  Test('reports missing export, wrong parameter, and wrong result types', async () => {
    for (
      const source of [
        'export const Other = (value: string) => value.length\n',
        'export const CountWords = () => 0\n',
        'export const CountWords = (value: number) => value\n',
        'export const CountWords = (value: string) => value\n',
      ]
    ) {
      await withTaoFixture({ ...checkedProjectFile, 'Main.tao': functionSource, 'Words.ts': source }, async root => {
        const results = await runCheck(root)
        const errors = results.flatMap(result => result.diagnostics ?? [])
          .filter(diagnostic => diagnostic.severity === 'error')
        Expect(errors.length).toBeGreaterThan(0)
        Expect(errors.every(diagnostic => diagnostic.message.startsWith('TypeScript:'))).toBe(true)
      })
    }
  })

  Test('groups union list elements in the sidecar contract', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': `type Mixed is text | number
function Echo(Values list of Mixed) returns list of Mixed {
   return Echo(Values) from ./Echo.ts
}
`,
      'Echo.ts': 'export const Echo = (values: (string | number)[]): (string | number)[] => values\n',
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      Expect(await FS.readText(FS.resolvePath('.tao-ts/Main.tao.ts', root))).toContain('Array<string | number>')
    })
  })
})

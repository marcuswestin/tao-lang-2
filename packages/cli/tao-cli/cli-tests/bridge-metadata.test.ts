import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, withTaoFixture } from './test-cli-files'

const functionSource = `function CountWords(Value text) returns number {
   return CountWords(Value) from ./Words.ts
}
`

Describe('TypeScript bridge metadata', () => {
  Test('generates a typed named export check beside the Tao source', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': functionSource,
      'Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      const metadata = await FS.readText(FS.resolvePath('Main.tao.ts', root))
      Expect(metadata).toContain('export type CountWords = (arg0: string) => number')
      Expect(metadata).toContain('Sidecar.CountWords satisfies CountWords')
      await FS.remove(FS.resolvePath('Main.tao.ts', root))
      await runCheck(root)
      Expect(await FS.isFile(FS.resolvePath('Main.tao.ts', root))).toBe(true)
      await FS.writeText(
        FS.resolvePath('Main.tao', root),
        'function CountWords(Value text) returns number {\n   return 1\n}\n',
      )
      await runCheck(root)
      Expect(await FS.isFile(FS.resolvePath('Main.tao.ts', root))).toBe(false)
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
        Expect(errors.some(diagnostic => diagnostic.message.includes('TypeScript bridge:'))).toBe(true)
      })
    }
  })

  Test('checks a foreign action taking a Tao entity handle', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': `data Documents / Document {
   Title text
   Body text
}

action ExportDocument(Document) from ./Export.ts
`,
      'Export.ts':
        'export function ExportDocument(document: { Title: string; Body: string }): void { void document }\n',
    }, async root => {
      const results = await runCheck(root)
      const errors = results.flatMap(result => result.diagnostics ?? [])
        .filter(diagnostic => diagnostic.severity === 'error')
      Expect(errors).toEqual([])
      Expect(await FS.readText(FS.resolvePath('Main.tao.ts', root))).toContain('"Title": string')
      await FS.writeText(FS.resolvePath('Export.ts', root), 'export const ExportDocument = () => 1\n')
      const wrong = await runCheck(root)
      Expect(
        wrong.flatMap(result => result.diagnostics ?? []).some(diagnostic =>
          diagnostic.message.includes('TypeScript bridge:')
        ),
      ).toBe(true)
    })
  })
})

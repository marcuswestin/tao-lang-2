import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, withTaoFixture } from './test-cli-files'

Describe('TypeScript bridge view and action metadata', () => {
  Test('checks a foreign action taking a Tao entity handle', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': `data Documents / Document {
   Title text,
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

  Test('checks the complete sidecar signature after Tao fills action defaults', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': 'action Save(Body text, Title text default "Untitled") from ./Save.ts\n',
      'Save.ts': 'export function Save(body: string, title: string): void { void body; void title }\n',
    }, async root => {
      const results = await runCheck(root)
      const errors = results.flatMap(result => result.diagnostics ?? [])
        .filter(diagnostic => diagnostic.severity === 'error')
      Expect(errors).toEqual([])
      const metadata = await FS.readText(FS.resolvePath('Main.tao.ts', root))
      Expect(metadata).toContain('export type Save = (arg0: string, arg1: string) => void | Promise<void>')
      Expect(metadata).toContain('unknown as 2 satisfies Parameters<typeof Sidecar.Save>')
    })
  })

  Test('checks mutable view props, filled defaults, and rendered output', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': 'view Editor(mutable Value text, Label text default "Draft") from ./Editor.tsx\n',
      'Editor.tsx': `export function Editor(props: {
        Value: { value: string; change(next: string): void }
        Label: string
      }) { return props.Label }
`,
    }, async root => {
      const good = await runCheck(root)
      Expect(good.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      const metadata = await FS.readText(FS.resolvePath('Main.tao.ts', root))
      Expect(metadata).toContain('"Value": { value: string; change: (next: string) => void | Promise<void> }')
      Expect(metadata).toContain('"Label": string')
      Expect(metadata).toContain('=> ReturnType<typeof TR.VisualNativeRoot>')
      await FS.writeText(FS.resolvePath('Editor.tsx', root), 'export function Editor() { return { invalid: true } }\n')
      const wrong = await runCheck(root)
      Expect(
        wrong.flatMap(result => result.diagnostics ?? []).some(diagnostic =>
          diagnostic.message.includes('TypeScript bridge:')
        ),
      ).toBe(true)
    })
  })
})

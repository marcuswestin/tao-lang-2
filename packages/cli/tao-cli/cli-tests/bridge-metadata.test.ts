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
      Expect(await FS.readText(FS.resolvePath('Main.tao.ts', root))).toContain('Array<string | number>')
    })
  })

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
      Expect(await FS.readText(FS.resolvePath('Main.tao.ts', root)))
        .toContain('arg0: TR.ActionValue<[TR.Value<string>]>')
    })
  })

  Test('checks configuration implementation and bare action exports', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': `type Memory is datasource with {
   provider MemoryProvider from ./Memory.ts
}
type CustomMemory is Memory with { }
let OpenUrl is action(text) = OpenUrl from ./OpenUrl.ts
`,
      'Memory.ts': `import type TR from '@tao/runtime'
import type { MemoryConfig } from './Main.tao'
export function MemoryProvider(): TR.DataProvider {
   const configuration: MemoryConfig = {}
   void configuration
   throw Error('test')
}
`,
      'OpenUrl.ts': 'export function OpenUrl(url: string): void { void url }\n',
    }, async root => {
      const good = await runCheck(root)
      Expect(good.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      const metadata = await FS.readText(FS.resolvePath('Main.tao.ts', root))
      Expect(metadata).toContain('Sidecar2.MemoryProvider satisfies MemoryProvider')
      Expect(metadata).toContain('export type MemoryConfig =')
      Expect(metadata.split('MemoryProvider satisfies MemoryProvider').length).toBe(2)
      Expect(metadata).toContain('unknown as 1 satisfies Parameters<typeof Sidecar1.OpenUrl>')
      await FS.writeText(FS.resolvePath('OpenUrl.ts', root), 'export function OpenUrl(): number { return 1 }\n')
      const wrong = await runCheck(root)
      Expect(
        wrong.flatMap(result => result.diagnostics ?? []).some(diagnostic =>
          diagnostic.message.includes('TypeScript bridge:')
        ),
      ).toBe(true)
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
      const metadata = await FS.readText(FS.resolvePath('Main.tao.ts', root))
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
      Expect(await FS.readText(FS.resolvePath('Main.tao.ts', root)))
        .toContain('Array<TR.ActionValue<[TR.Value<string>]>>')
    })
  })

  Test('resolves an installed host dependency used by a sidecar', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': functionSource,
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@local/*': ['./Local/*'] } } }),
      'Local/Suffix.ts': 'export const suffix = "!"\n',
      'Words.ts': `import type { TextProps } from 'react-native'
import { suffix } from '@local/Suffix'
export function CountWords(value: string): number {
   const props: TextProps = { children: value }
   return String(props.children).length + suffix.length
}
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      Expect(await FS.isSymbolicLink(FS.resolvePath('node_modules/react-native', root))).toBe(true)
    })
  })
})

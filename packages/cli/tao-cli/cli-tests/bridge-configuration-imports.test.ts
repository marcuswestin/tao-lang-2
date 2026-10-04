import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { PROJECT_TSCONFIG } from '../cli-src/app-modules'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, withTaoFixture } from './test-cli-files'

const functionSource = `function CountWords(Value text) returns number {
   return CountWords(Value) from ./Words.ts
}
`

Describe('TypeScript bridge configuration imports', () => {
  Test('exports inherited configuration types from a source without its own sidecar', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': `public type Memory is datasource with {
   supports { }
   provider MemoryProvider from ./Memory.ts
}
`,
      'Derived.tao': `use Memory from ./Main.tao
type Extended is Memory with { }
`,
      'Memory.ts': `import type TR from '@tao/runtime'
import type { ExtendedConfig } from './Derived.tao'
export function MemoryProvider(): TR.DataProvider {
   const configuration: ExtendedConfig = {}
   void configuration
   throw Error('test')
}
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      Expect(await FS.readText(FS.resolvePath('.tao-ts/Derived.tao.ts', root)))
        .toContain('export type ExtendedConfig =')
      await FS.remove(FS.resolvePath('.tao-ts/Derived.tao.ts', root))
      await runCheck(root)
      Expect(await FS.isFile(FS.resolvePath('.tao-ts/Derived.tao.ts', root))).toBe(true)
    })
  })

  Test('resolves an installed host dependency used by a sidecar', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': functionSource,
      'tsconfig.json': JSON.stringify({
        extends: './.tao/typescript/tsconfig.json',
        compilerOptions: {
          typeRoots: ['./node_modules/@types'],
          types: ['project'],
        },
      }),
      'node_modules/@types/project/index.d.ts': 'declare const BUILD_LABEL: string\n',
      'Local/Suffix.ts': 'export const suffix = "!"\n',
      'Words.ts': `import type { TextProps } from 'react-native'
import { suffix } from './Local/Suffix'
export function CountWords(value: string): number {
   const props: TextProps = { children: value }
   return String(props.children).length + suffix.length + BUILD_LABEL.length
}
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      const base = await FS.readJson<{ compilerOptions: { paths: Record<string, string[]> } }>(
        FS.resolvePath('.tao/typescript/tsconfig.json', root),
      )
      Expect(base.compilerOptions.paths['react-native']?.[0]).toContain('react-native')
    })
  })

  Test('keeps auto-discovered project types alongside host types in the generated tsconfig', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'tsconfig.json': PROJECT_TSCONFIG,
      'Main.tao': functionSource,
      'node_modules/@types/project/index.d.ts': 'declare const BUILD_LABEL: string\n',
      'Words.ts': `export function CountWords(value: string): number {
   return value.length + BUILD_LABEL.length + (${'process'}.env.BUILD_LABEL?.length ?? 0)
}
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
    })
  })
})

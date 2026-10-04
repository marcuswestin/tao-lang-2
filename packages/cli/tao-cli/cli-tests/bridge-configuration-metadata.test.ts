import { Assert, FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, withTaoFixture } from './test-cli-files'

Describe('TypeScript bridge configuration metadata', () => {
  Test('checks configuration implementation and bare action exports', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'Main.tao': `public type Memory is datasource with {
   supports { }
   provider MemoryProvider from ./Memory.ts
}
type CustomMemory is Memory with { }
let OpenUrl is action(text) = OpenUrl from ./OpenUrl.ts
`,
      'Memory.ts': `import type TR from '@tao/runtime'
import type { MemoryConfig, CustomMemoryConfig } from './Main.tao'
export function MemoryProvider(): TR.DataProvider {
   const configuration: MemoryConfig = {}
   const extended: CustomMemoryConfig = {}
   void configuration
   void extended
   throw Error('test')
}
`,
      'OpenUrl.ts': 'export function OpenUrl(url: string): void { void url }\n',
    }, async root => {
      const good = await runCheck(root)
      Expect(good.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      const metadataPath = FS.resolvePath('.tao-ts/Main.tao.ts', root)
      const metadata = await FS.readText(metadataPath)
      const runtimeImport = metadata.split('\n').find(line => line.startsWith('import type TR from '))
      Expect(runtimeImport).toMatch(/^import type TR from "\.\.?\/.*"$/)
      const specifier = runtimeImport?.match(/from "(.*)"/)?.[1]
      Assert.defined(specifier, 'generated runtime import names a specifier')
      Expect(await FS.realPath(FS.resolvePath(`${specifier}.ts`, FS.dirname(metadataPath)))).toBe(
        await FS.realPath(FS.resolvePath('../../../apps/runtime/TaoRuntime-src/TR.ts', import.meta.dir)),
      )
      Expect(metadata).toContain('Sidecar2.MemoryProvider satisfies MemoryProvider')
      Expect(metadata).toContain('export type MemoryConfig =')
      Expect(metadata).toContain('export type CustomMemoryConfig =')
      Expect(metadata.split('MemoryProvider satisfies MemoryProvider').length).toBe(2)
      Expect(metadata).toContain('unknown as 1 satisfies Parameters<typeof Sidecar1.OpenUrl>')
      await FS.writeText(FS.resolvePath('OpenUrl.ts', root), 'export function OpenUrl(): number { return 1 }\n')
      const wrong = await runCheck(root)
      Expect(
        wrong.flatMap(result => result.diagnostics ?? []).some(diagnostic =>
          diagnostic.message.startsWith('TypeScript:')
        ),
      ).toBe(true)
    })
  })
})

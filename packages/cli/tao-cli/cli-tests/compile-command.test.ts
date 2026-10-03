import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { PassThrough } from 'node:stream'
import { runCompile } from '../cli-src/compile-command'

const source = `
  app First { view MainView }
  app Second { view MainView }
  view MainView() { render inject \`\`\`ts return null \`\`\` }
`

Describe('tao compile app selection', () => {
  Test('refreshes source-adjacent bridge metadata during compilation', async () => {
    await withTaoFiles('tao-compile-bridge-', {
      'Main.tao': `app Demo { view Main }
view Main() { render inject \`\`\`ts return null \`\`\` }
function CountWords(Value text) returns number {
   return CountWords(Value) from ./Words.ts
}
`,
      'Words.ts': `import type { CountWords as CountWordsContract } from './Main.tao'
export const CountWords: CountWordsContract = (value) => value.length
`,
    }, async paths => {
      const sourcePath = paths['Main.tao']!
      const runtimePackageRoot = FS.resolvePath('runtime', FS.dirname(sourcePath))
      const compiled = await runCompile(sourcePath, { runtimePackageRoot })
      const metadataPath = `${sourcePath}.ts`
      Expect(await FS.readText(metadataPath)).toContain('Sidecar.CountWords satisfies CountWords')
      Expect(await FS.readText(compiled.outputPath)).toContain('export type CountWords = (arg0: string) => number')
      const copiedSidecar = FS.resolvePath('Words.ts', FS.dirname(compiled.outputPath))
      Expect(await FS.readText(copiedSidecar)).toContain("from './App'")
      await FS.remove(metadataPath)
      await runCompile(sourcePath, { runtimePackageRoot })
      Expect(await FS.isFile(metadataPath)).toBe(true)
    })
  })

  Test('fails actionably without a selection in a noninteractive process', async () => {
    await withTaoFiles('tao-compile-selection-', { 'Apps.tao': source }, async paths => {
      const result = runCompile(paths['Apps.tao']!, { interactive: false })
      await Expect(result).rejects.toThrow(
        'Multiple apps are declared',
      )
      await Expect(result).rejects.toThrow('--app First')
    })
  })

  Test('prompts interactively and generates the chosen default app', async () => {
    await withTaoFiles('tao-compile-selection-', { 'Apps.tao': source }, async paths => {
      const input = new PassThrough() as PassThrough & { isTTY: boolean }
      const output = new PassThrough() as PassThrough & { isTTY: boolean }
      input.isTTY = true
      output.isTTY = true
      input.end('2\n')
      const runtimePackageRoot = FS.resolvePath('runtime', FS.dirname(paths['Apps.tao']!))
      const compiled = await runCompile(paths['Apps.tao']!, {
        input,
        output,
        runtimePackageRoot,
      })
      Expect(await FS.readText(compiled.outputPath)).toContain('export default TaoApps["Second"]')
    })
  })
})

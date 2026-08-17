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
  Test('fails actionably without a selection in a noninteractive process', async () => {
    await withTaoFiles('tao-compile-selection-', { 'Apps.tao': source }, async paths => {
      await Expect(runCompile(paths['Apps.tao']!, { interactive: false })).rejects.toThrow(
        'Multiple apps are declared',
      )
      await Expect(runCompile(paths['Apps.tao']!, { interactive: false })).rejects.toThrow('--app First')
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

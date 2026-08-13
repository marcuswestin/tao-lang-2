import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { PassThrough } from 'node:stream'
import { resolveDevAppName } from '../dev-src/dev-loop/dev-loop'

const source = `
  app First { view MainView }
  app Second { view MainView }
  view MainView { render inject \`\`\`ts return null \`\`\` }
`

Describe('dev app selection', () => {
  Test('fails actionably before startup without a selection in a noninteractive process', async () => {
    await withTaoFiles('tao-dev-selection-', { 'Apps.tao': source }, async paths => {
      await Expect(resolveDevAppName(paths['Apps.tao']!, undefined, { interactive: false })).rejects.toThrow(
        'Multiple apps are declared',
      )
      await Expect(resolveDevAppName(paths['Apps.tao']!, undefined, { interactive: false })).rejects.toThrow(
        '--app First',
      )
    })
  })

  Test('prompts interactively and returns the chosen app', async () => {
    await withTaoFiles('tao-dev-selection-', { 'Apps.tao': source }, async paths => {
      const input = new PassThrough() as PassThrough & { isTTY: boolean }
      const output = new PassThrough() as PassThrough & { isTTY: boolean }
      input.isTTY = true
      output.isTTY = true
      input.end('2\n')

      Expect(await resolveDevAppName(paths['Apps.tao']!, undefined, { input, output })).toBe('Second')
    })
  })
})

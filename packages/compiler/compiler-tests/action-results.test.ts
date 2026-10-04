import { Describe, Expect, Test } from '@shared/test'
import { BridgeMetadata } from '../compiler-src/bridge-metadata'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: action results', () => {
  Test('awaits foreign results and exposes a plain TypeScript result contract', async () => {
    const compiled = await Compiler.compileCode(`
      app Results { id "com.tao.test.results" version "1.0.0" name "Results"  view Main }
      public action Read() returns text from ./Bindings.ts
      view Main() {
        state Value = ""
        action Paste() { let Pasted = do Read() set Value = Pasted }
        render Label(Value)
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('_Scope.Pasted = await TR.DoResult<string>(_Scope.Read.evaluate())')
    Expect(code).toContain('export type Read = () => string | Promise<string>')
    Expect(code).toContain('_Scope.Paste = TR.Action(async')
    Expect(code).toContain('const _TaoActionOwner = TR.UseActionOwner()')
    Expect(code).toContain('name: "Paste", owner: _TaoActionOwner,')
    const contract = BridgeMetadata.collect(compiled.validation.files, '/').map(file => file.code).join('\n')
    Expect(contract).toContain('__TaoBridgeCheck<string | Promise<string>, ReturnType<typeof Sidecar.Read>>')
  })
  Test('preserves failure contracts through result bindings and when do', async () => {
    const compiled = await Compiler.compileCode(`
      app Results { id "com.tao.test.results" version "1.0.0" name "Results"  view Main }
      type Failure is one of Offline
      action Read() returns text fails Offline "Unavailable." from ./Bindings.ts
      action ReadAndDiscard() { let Value = do Read() }
      view Main() {
        action Run() { when do ReadAndDiscard() { saved -> { } Offline -> { } } }
        render Empty()
      }
      view Empty() { render inject \`\`\`ts return null \`\`\` }
    `)
    Expect(compiled.code.replace(/\s+/g, ' ')).toContain(
      'TR.WhenDo(() => TR.Do(_Scope.ReadAndDiscard.evaluate()), { name: "ReadAndDiscard", declared: ["Offline"], }',
    )
  })

  Test('preserves nullable nested record results across the bridge', async () => {
    const compiled = await Compiler.compileCode(`
      app Results { id "com.tao.test.results" version "1.0.0" name "Results"  view Main }
      type Size is { Width number, Height number }
      type Image is { Data text, Size Size, Caption text? }
      public action ReadImage() returns Image? from ./Bindings.ts
      action Accept(Image Image?) { }
      view Main() {
        action Paste() { let Image = do ReadImage() do Accept(Image) }
        render Empty()
      }
      view Empty() { render inject \`\`\`ts return null \`\`\` }
    `)
    const contract = BridgeMetadata.collect(compiled.validation.files, '/').map(file => file.code).join('\n')
    Expect(contract).toContain('"Size": { "Width": number; "Height": number }')
    Expect(contract).toContain('"Caption"?: string | null')
    Expect(contract).toContain('} | null | Promise<{')
    Expect(compiled.code.replace(/\s+/g, ' ')).toContain('_Scope.Image = await TR.DoResult<')
  })

  Test('captures the mounted owner for inline actions and foreign actions only within views', async () => {
    const compiled = await Compiler.compileCode(`
      app Results { id "com.tao.test.results" version "1.0.0" name "Results"  view Main }
      action Global() from ./Bindings.ts
      view Main() {
        action Local() from ./Bindings.ts
        render Button(action { do Global() })
      }
      view Button(Press action()) { render inject Press \`\`\`ts return null \`\`\` }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toMatch(/_Scope.Local = TR.ForeignAction\([^]*?owner: _TaoActionOwner/)
    Expect(code).toMatch(/TR.Action\(async \(\) => \{[^]*?\}, \{ owner: _TaoActionOwner,/)
    Expect(code.match(/owner: _TaoActionOwner/g)).toHaveLength(2)
    Expect(code.match(/const _TaoActionOwner = TR.UseActionOwner\(\)/g)).toHaveLength(2)
  })
})

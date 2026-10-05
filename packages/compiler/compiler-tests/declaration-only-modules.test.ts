import { Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { RuntimeGen } from '../compiler-src/codegen/react-native/app/RuntimeGen'

Describe('compiler: declaration-only modules', () => {
  Test('retains dependency imports without inventing a runtime scope', async () => {
    const parsed = await Parser.parseCode('public type Context is { Message text }', { validation: false })
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const code = RuntimeGen.TaoFile(parsed.entry.ast, {
      importLines: ["import './quantity-factories'"],
    })
    Expect(code).toContain("import './quantity-factories'")
    Expect(code).not.toContain('@runtime/TR')
    Expect(code).not.toContain('_Scope')
    Expect(code).not.toContain('React')
  })

  Test('imports the runtime only as a type for declaration contracts', async () => {
    const parsed = await Parser.parseCode('public type Context is { Message text }', { validation: false })
    const code = RuntimeGen.TaoFile(parsed.entry.ast, {
      bridgeTypes: 'export type ContextValue = TR.Value<string>',
    })
    Expect(code).toContain("import type TR from '@runtime/TR'")
    Expect(code).toContain('export type ContextValue = TR.Value<string>')
    Expect(code).not.toContain('_Scope')
  })
})

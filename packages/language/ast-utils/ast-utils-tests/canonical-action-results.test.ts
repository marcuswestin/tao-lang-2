import { Packages, Type } from '@ast-utils'
import { AST, Parser, URI } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

async function parse(code: string) {
  const result = await Parser.parseCode(code, { validation: false })
  Expect(result.diagnostics).toEqual([])
  return result.entry.ast
}

function payloads(file: AST.TaoFile): AST.CasePayload[] {
  return AST.streamAllContents(file).filter(AST.isCasePayload)
}

Describe('canonical action result types', () => {
  Test('uses a declared foreign result for done and preserves nullable nominal results', async () => {
    const file = await parse(`
      type Duration is number
      action Read() returns Duration? from ./Read.ts
      action Use(Value Duration?) { }
      action Run() { do Read() then { done Result -> { do Use(Result) } } }
    `)
    const duration = file.statements.find(AST.isTypeDeclaration)
    Expect.Is(duration, AST.isTypeDeclaration)
    const result = Type.ofValueDeclaration(payloads(file)[0])
    Expect.Is(
      result,
      (value: unknown): value is Extract<ReturnType<typeof Type.ofActionResult>, { kind: 'union' }> =>
        !!value && typeof value === 'object' && 'kind' in value && value.kind === 'union',
    )
    Expect(result.members.some(type => type.kind === 'primitive' && type.nominal === duration)).toBe(true)
    Expect(result.members.some(type => type.kind === 'primitive' && type.primitive === 'none')).toBe(true)
  })

  Test('infers actual source method results for both let and canonical done bindings', async () => {
    const file = await parse(`
      type Duration is number
      type Timer is text with { func Duration() -> Duration { return Duration 2 } }
      action Export() { let Clock = Timer "clock" return Clock.Duration() }
      action Use(Value Duration) { }
      action Run() {
        let Answer = do Export() then { done Result -> { do Use(Result) } }
      }
    `)
    const duration = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Duration')
    Expect.Is(duration, AST.isTypeDeclaration)
    const action = file.statements.find(node => AST.isActionDeclaration(node) && node.name === 'Export')
    Expect.Is(action, AST.isActionDeclaration)
    const answer = AST.streamAllContents(file).find(AST.isActionResultStatement)
    Expect.Is(answer, AST.isActionResultStatement)
    for (
      const type of [
        Type.ofActionResult(action),
        Type.ofValueDeclaration(answer),
        Type.ofValueDeclaration(payloads(file)[0]),
      ]
    ) {
      Expect(type.kind === 'primitive' && type.nominal === duration).toBe(true)
    }
  })

  Test('keeps legacy when-do payloads as text', async () => {
    const file = await parse(`
      action Read() returns number from ./Read.ts
      action Run() { when do Read() { error -> Problem { } } }
    `)
    Expect(Type.ofValueDeclaration(payloads(file)[0])).toEqual({ kind: 'primitive', primitive: 'text' })
  })

  Test('does not expose a let binding inside its own canonical done handler', async () => {
    const parsed = await Parser.parseCode(
      `
      action Read() returns number from ./Read.ts
      action Use(Value number) { }
      action Run() { let Answer = do Read() then { done Result -> { do Use(Answer) } } }
    `,
      { validation: false },
    )
    Expect(parsed.diagnostics.some(diagnostic => diagnostic.message.includes("No value named 'Answer' is in scope.")))
      .toBe(true)
    const result = payloads(parsed.entry.ast)[0]
    Expect.Is(result, AST.isCasePayload)
    Expect(Type.ofValueDeclaration(result)).toEqual({ kind: 'primitive', primitive: 'number' })
  })

  Test('canonical error and named failures expose only the real Message text field', async () => {
    await withTaoFiles('tao-canonical-action-failure-', {
      'Main.tao': `
      type Problems is one of InvalidInput
      action Read() returns number fails InvalidInput "Invalid input" from ./Read.ts
      action Run() { do Read() then { error Problem -> { } InvalidInput Named -> { } } }
    `,
    }, async (paths, root) => {
      const context = Parser.createContext({ packages: Packages.createResolver(await Packages.createContext(root)) })
      const parsed = await Parser.parse(context, URI.file(paths['Main.tao']), { validation: false })
      Expect(parsed.diagnostics).toEqual([])
      Expect(payloads(parsed.entry.ast)).toHaveLength(2)
      for (const payload of payloads(parsed.entry.ast)) {
        const type = Type.ofValueDeclaration(payload)
        const context = AST.actionFailureContextDeclaration(payload)
        Expect.Is(context, AST.isTypeDeclaration)
        Expect.Is(context.type, AST.isItemTypeExpression)
        const message = context.type.properties.find(property => property.name === 'Message')
        Expect.Is(message, AST.isTypeProperty)
        const field = Type.atMemberPath(type, ['Message'])
        Expect(field.kind === 'primitive' && field.primitive === 'text' && field.nominal === message).toBe(true)
        Expect(Type.atMemberPath(type, ['State']).kind).toBe('unresolved')
        Expect(type.kind === 'item' && type.nominal === AST.actionFailureContextDeclaration(payload)).toBe(true)
      }
    })
  })
})

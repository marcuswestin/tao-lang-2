import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { parameterRequiresWritable } from '../ast-utils-src/reactive-parameters'
import { Type } from '../ast-utils-src/Type'

const prelude = `
  data Authors / Author { Name text }
  view Text(Value text) { render inject \`\`\`ts return null \`\`\` }
  view Stack() { render inject \`\`\`ts return null \`\`\` }
`

Describe('optional view guard continuation', () => {
  Test(
    'keeps the prelude, handler and nested blocks optional while refining only the direct continuation',
    async () => {
      const file = await parse(`
      view OptionalAuthor(Person Author?) {
        render Stack() {
          Text(Person.Name)
          guard Person { none -> { Text(Person.Name) } }
          Stack() { Text(Person.Name) }
          Text(Person.Name)
        }
      }
    `)
      const guard = AST.streamAllContents(file).find(AST.isGuardRenderStatement)
      Expect.Is(guard, AST.isGuardRenderStatement)
      Expect(Type.ofExpression(guard.subject).kind).toBe('union')
      const fields = AST.streamAllContents(file).filter(AST.isMemberAccessExpression)
      Expect(fields.length).toBe(4)
      Expect(fields.slice(0, 3).map(field => Type.ofExpression(field).kind))
        .toEqual(['unresolved', 'unresolved', 'unresolved'])
      Expect(Type.ofExpression(fields[3]!).kind).toBe('primitive')
    },
  )

  Test('refines a bare guard continuation only with the real entity read-net route', async () => {
    const file = await parse(`
      view Bare(Person Author?) {
        render Stack() {
          guard Person
          Text(Person.Name)
        }
      }
    `)
    const guard = AST.streamAllContents(file).find(AST.isGuardRenderStatement)
    Expect.Is(guard, AST.isGuardRenderStatement)
    Expect(guard.single).toBeUndefined()
    Expect(guard.caseBlock).toBeUndefined()
    Expect(Type.ofExpression(guard.subject).kind).toBe('union')
    const field = AST.streamAllContents(file).find(AST.isMemberAccessExpression)
    Expect.Is(field, AST.isMemberAccessExpression)
    Expect(Type.ofExpression(field).kind).toBe('primitive')
  })

  Test('excludes mutable/copy parameters, other identities, live aliases, and action guards', async () => {
    const file = await parse(`
      view Mutable(mutable Person Author?) {
        render Stack() { guard Person { none -> {} } Text(Person.Name) }
      }
      view Copied(copy Person Author?) {
        render Stack() { guard Person { none -> {} } Text(Person.Name) }
      }
      view Other(Person Author?, Different Author?) {
        render Stack() { guard Different { none -> {} } Text(Person.Name) }
      }
      view Aliased(Person Author?) {
        let Live = Person
        render Stack() { guard Live { none -> {} } Text(Person.Name) }
      }
      action Observe(Value text) {}
      action Act(Person Author?) {
        guard Person { none -> {} }
        do Observe(Person.Name)
      }
    `)
    const fields = AST.streamAllContents(file).filter(AST.isMemberAccessExpression)
    Expect(fields.length).toBe(5)
    Expect(fields.map(field => Type.ofExpression(field).kind))
      .toEqual(['unresolved', 'unresolved', 'unresolved', 'unresolved', 'unresolved'])
  })

  Test('shows that a nonwritable callee parameter alone does not prove a sampled caller value', async () => {
    const file = await parse(`
      view OptionalAuthor(Person Author?) {
        render Stack() { guard Person { none -> {} } Text(Person.Name) }
      }
      view Host(mutable Current Author?) { render OptionalAuthor(Current) }
    `)
    const helper = file.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'OptionalAuthor'
    )
    const host = file.statements.find(statement => AST.isViewDeclaration(statement) && statement.name === 'Host')
    Expect.Is(helper, AST.isViewDeclaration)
    Expect.Is(host, AST.isViewDeclaration)
    const received = AST.parametersOf(helper)[0]!
    const supplied = AST.parametersOf(host)[0]!
    Expect(received.copy).toBe(false)
    Expect(received.mutable).toBe(false)
    Expect(parameterRequiresWritable(received)).toBe(false)
    Expect(parameterRequiresWritable(supplied)).toBe(true)
    const hostReference = AST.streamAllContents(host).find(AST.isValueReference)
    Expect.Is(hostReference, AST.isValueReference)
    Expect(hostReference.target.ref).toBe(supplied)
    Expect(Type.ofExpression(hostReference).kind).toBe('union')
  })
})

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(prelude + source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}

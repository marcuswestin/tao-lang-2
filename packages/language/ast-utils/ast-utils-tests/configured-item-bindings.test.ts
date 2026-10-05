import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { ASTUtils } from '../ast-utils-src/ast-utils'

Describe('Actual configured item correspondence', () => {
  Test('retains real reference entries, fields and payload domains in declaration order', async () => {
    const file = await parse(`
      type RowKey is text
      type Caption is text
      type Row is { Key RowKey, Caption Caption }
      func Build(Key RowKey, Caption Caption) -> Row { return Row { Caption, Key } }
    `)
    const site = constructor(file, 'Build')
    const plan = ASTUtils.resolveConfiguredItemConstruction(site)
    Expect(plan.kind).toBe('complete')
    Expect(plan.site).toBe(site)
    Expect(plan.pairs[0]?.entry).toBe(site.block?.entries[1])
    Expect(plan.pairs[1]?.entry).toBe(site.block?.entries[0])
    for (const [index, pair] of plan.pairs.entries()) {
      Expect(pair.field).toBe(plan.fields[index])
      Expect(plan.operands[index]?.node).toBe(pair.entry)
      Expect(pair.actual.kind).toBe('primitive')
      Expect(pair.expected.kind).toBe('primitive')
    }
  })

  Test('suppresses supplied defaults and retains actual omitted and filled expressions', async () => {
    const file = await parse(`
      let Foreign is text = Read from ./Native.ts
      type Row is { First text is Foreign, Second text is "default", Fixed is "filled" }
      func Build() -> Row { return Row { First: "safe" } }
    `)
    const site = constructor(file, 'Build')
    const plan = ASTUtils.resolveConfiguredItemConstruction(site)
    Expect(plan.kind).toBe('complete')
    Expect(plan.operands.map(operand => operand.origin)).toEqual(['supplied', 'default', 'filled'])
    Expect(plan.operands[0]?.node).toBe(site.block?.entries[0])
    for (const index of [1, 2]) {
      const field = plan.fields[index]
      Expect.Is(field, AST.isTypeProperty)
      Expect(plan.operands[index]?.node).toBe(field.value)
    }
    const first = plan.fields[0]
    Expect.Is(first, AST.isTypeProperty)
    Expect(plan.operands.some(operand => operand.node === first.value)).toBe(false)
  })

  Test('preserves concrete nested payload separately from expected capability', async () => {
    const file = await parse(`
      can Display { ToText() fails never -> text }
      type HeaderLabel is text
      type GroupHeader is { HeaderLabel HeaderLabel, func ToText() fails never -> text { return GroupHeader.HeaderLabel } }
      type GroupedRow is { Content Display }
      func Labeled(HeaderLabel HeaderLabel) -> GroupedRow { return GroupedRow { Content: GroupHeader { HeaderLabel } } }
      func Named(HeaderLabel HeaderLabel) -> GroupedRow { return GroupedRow { Content GroupHeader { HeaderLabel } } }
      func Bare(HeaderLabel HeaderLabel) -> GroupedRow { return GroupedRow { GroupHeader { HeaderLabel } } }
    `)
    const actual = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'GroupHeader')
    const expected = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Display')
    for (const name of ['Labeled', 'Named', 'Bare']) {
      const site = constructor(file, name)
      const plan = ASTUtils.resolveConfiguredItemConstruction(site)
      Expect(plan.kind).toBe('complete')
      const pair = plan.pairs[0]
      Expect(pair?.entry).toBe(site.block?.entries[0])
      Expect(pair?.actual.kind === 'item' && pair.actual.nominal).toBe(actual)
      Expect(pair?.expected.kind === 'capability' && pair.expected.declaration).toBe(expected)
    }
    const entry = constructor(file, 'Bare').block?.entries[0]
    Expect.Is(entry, AST.isConfigurationEntry)
    Expect(ASTUtils.resolveConfiguredItemConstruction(entry).operands[0]?.node).toBe(entry.block?.entries[0])
  })

  Test('returns invalid and unresolved evidence for genuine malformed sources', async () => {
    const file = await parse(
      `
      type Pair is { Left text, Right text }
      abstract type AbstractRow is { Caption text }
      type Provider is nav with { Caption text }
      func Missing() -> Pair { return Pair {} }
      func Ambiguous(Value text) -> Pair { return Pair { Value } }
      func Duplicate() -> Pair { return Pair { Left: "a", Left: "b", Right: "c" } }
      func Invalid() -> Pair { return Pair { Wrong: "a", Right: "b" } }
      func Abstract() -> AbstractRow { return AbstractRow { Caption: "x" } }
      func Configurable() -> Provider { return Provider { Caption: "x" } }
      func Unlinked() -> Pair { return Pair { Unknown } }
    `,
      ["No data entity or value named 'Unknown' is in scope."],
    )
    for (const name of ['Missing', 'Ambiguous', 'Duplicate', 'Invalid']) {
      const plan = ASTUtils.resolveConfiguredItemConstruction(constructor(file, name))
      Expect(plan.kind).toBe('invalid')
      Expect(plan.diagnostics.length > 0).toBe(true)
    }
    Expect(ASTUtils.resolveConfiguredItemConstruction(constructor(file, 'Ambiguous')).pairs.length).toBe(0)
    for (const name of ['Abstract', 'Configurable', 'Unlinked']) {
      Expect(ASTUtils.resolveConfiguredItemConstruction(constructor(file, name)).kind).toBe('unresolved')
    }
  })
})

async function parse(source: string, diagnostics: readonly string[] = []): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual(diagnostics)
  return parsed.entry.ast
}

function constructor(file: AST.TaoFile, name: string): AST.ConfigurationConstructor {
  const owner = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === name)
  Expect.Is(owner, AST.isFunctionDeclaration)
  const site = AST.streamAllContents(owner).find(AST.isConfigurationConstructor)
  Expect.Is(site, AST.isConfigurationConstructor)
  return site
}

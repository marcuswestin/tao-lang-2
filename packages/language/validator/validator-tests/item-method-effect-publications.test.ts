import { ASTUtils } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

const display = 'can Display { ToText() fails never -> text }'

Describe('validator: item member method effect publications', () => {
  Test('classifies a real item capability callee like the same ordinary field read', async () => {
    const file = await parse(`${display}
      type Row is { Content Display }
      func Read(Value Row) -> text { return Value.Content.ToText() }
      func Field(Value Row) -> Display { return Value.Content }
    `)
    const read = namedFunction(file, 'Read')
    const call = AST.streamAllContents(read).find(AST.isMethodCallExpression)
    Expect.Is(call, AST.isMethodCallExpression)
    Expect.Is(call.callee, AST.isMemberAccessExpression)
    const { snapshot, facts, analysis } = materialize(file, read)
    const publication = snapshot.calls.get(call)
    Assert.defined(publication, 'the real item method call is published')
    Expect(publication.kind).toBe('complete')
    Expect.Is(publication.target, AST.isCapabilityMethodDeclaration)
    Expect(publication.target.name).toBe('ToText')
    Assert(publication.receiver?.kind === 'member-path', 'the call retains its actual item receiver path')
    Expect(publication.receiver.site).toBe(call.callee)
    Expect(publication.receiver.members).toEqual(['Content'])
    const calleeRead = snapshot.reads.get(call.callee)
    Assert.defined(calleeRead, 'the actual named callee has read evidence')
    Expect(calleeRead.reference).toBe(call.callee)
    Expect(calleeRead.declaration).toBe(AST.parametersOf(read)[0])
    Expect(calleeRead.classification).toBe('immutable')
    Expect(calleeRead.proof?.kind).toBe('parameter')
    Expect(facts.find(fact => fact.node === call)?.executes.some(edge => edge.target === call.callee)).toBe(true)
    Expect(facts.find(fact => fact.node === call.callee)?.kind).toBe('complete')
    Expect(analysis.effects.purity).toEqual({ violations: [], open: false })
    Expect(materialize(file, namedFunction(file, 'Field')).analysis.effects.purity)
      .toEqual({ violations: [], open: false })
    Expect(ASTUtils.createAssociatedEffects([file]).analyses.get(read)?.effects.purity)
      .toEqual({ violations: [], open: false })
  })

  Test('retains the inherited ordinary source method and its body through a single item field', async () => {
    const file = await parse(`
      type Token is text with { func Format() fails never -> text { return "formatted" } }
      type Child is Token
      type Row is { Content Child }
      func Read(Value Row) -> text { return Value.Content.Format() }
    `)
    const read = namedFunction(file, 'Read')
    const method = AST.streamAllContents(file).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const call = AST.streamAllContents(read).find(AST.isMethodCallExpression)
    Expect.Is(call, AST.isMethodCallExpression)
    const { snapshot, facts, analysis } = materialize(file, read)
    Expect(snapshot.calls.get(call)?.target).toBe(method)
    Expect(snapshot.calls.get(call)?.descriptor?.body).toBe(method.block)
    Expect(snapshot.reads.get(call.callee)?.classification).toBe('immutable')
    Expect(facts.some(fact => fact.executes.some(edge => edge.target === method.block))).toBe(true)
    Expect(analysis.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('executes a live alias initializer, selected default and effectful expression receiver', async () => {
    const file = await parse(`${display}
      let Imported is text = Export from ./Native.ts
      type Token is text with {
        func Format(Suffix text default Imported) -> text { return Suffix }
      }
      type Row is { Content Display }
      type TextRow is { Content Token }
      let ImportedRow is Row = Export from ./Native.ts
      func Alias() -> text { return ImportedRow.Content.ToText() }
      func Default(Value TextRow) -> text { return Value.Content.Format() }
      func Source(mutable Value Row) -> Row { return Value }
      view Example {
        state Current is Row = none
        func Expression() -> text { return Source(Current).Content.ToText() }
      }
    `)
    const alias = file.statements.find(node => AST.isAliasDeclaration(node) && node.name === 'ImportedRow')
    const imported = file.statements.find(node => AST.isAliasDeclaration(node) && node.name === 'Imported')
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(imported, AST.isAliasDeclaration)
    const aliasResult = materialize(file, namedFunction(file, 'Alias'))
    Expect(aliasResult.facts.some(fact => fact.executes.some(edge => edge.target === alias.value))).toBe(true)
    Expect(aliasResult.analysis.effects.purity.open).toBe(true)
    const defaultResult = materialize(file, namedFunction(file, 'Default'))
    const method = AST.streamAllContents(file).find(AST.isAssociatedFunctionDeclaration)
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const defaultValue = AST.parametersOf(method)[0]?.defaultValue
    Assert.defined(defaultValue, 'the selected method has a real default expression')
    Expect(defaultResult.facts.some(fact => fact.executes.some(edge => edge.target === defaultValue))).toBe(true)
    Expect(defaultResult.facts.some(fact => fact.executes.some(edge => edge.target === imported.value))).toBe(true)
    Expect(defaultResult.analysis.effects.purity.open).toBe(true)
    const expression = materialize(file, namedFunction(file, 'Expression'))
    const source = namedFunction(file, 'Source')
    Expect(expression.facts.some(fact => fact.executes.some(edge => edge.target === source))).toBe(true)
    Expect(expression.analysis.effects.purity.violations).toContain('reactive-state')
  })

  Test('preserves state, mutable, copy, entity and longer item receiver ownership', async () => {
    const file = await parse(`${display}
      type Row is { Content Display }
      type Holder is { Inner Row }
      data Records / Record { Content Display }
      func Mutable(mutable Value Row) -> text { return Value.Content.ToText() }
      func Copy(copy Value Row) -> text { return Value.Content.ToText() }
      func Entity(Value Record) -> text { return Value.Content.ToText() }
      func Nested(Value Holder) -> text { return Value.Inner.Content.ToText() }
      view Example {
        state Current is Row = none
        func State() -> text { return Current.Content.ToText() }
      }
    `)
    for (const name of ['Mutable', 'Copy', 'State']) {
      const owner = namedFunction(file, name)
      const call = AST.streamAllContents(owner).find(AST.isMethodCallExpression)
      Expect.Is(call, AST.isMethodCallExpression)
      const { snapshot, analysis } = materialize(file, owner)
      Expect(snapshot.calls.get(call)?.kind).toBe('complete')
      Expect(snapshot.reads.get(call.callee)?.classification).toBe('reactive')
      Expect(analysis.effects.purity.violations).toContain('reactive-state')
    }
    for (const name of ['Entity', 'Nested']) {
      const owner = namedFunction(file, name)
      const call = AST.streamAllContents(owner).find(AST.isMethodCallExpression)
      Expect.Is(call, AST.isMethodCallExpression)
      const { snapshot, analysis } = materialize(file, owner)
      Expect(snapshot.calls.get(call)?.kind).toBe('complete')
      Expect(snapshot.reads.get(call.callee)?.classification).toBe('unknown')
      Expect(analysis.effects.purity.open).toBe(true)
    }
  })

  Test('does not reuse field-read evidence for pending, missing or invalid calls', async () => {
    const file = await parse(
      `${display}
      type Pending is text with { func Format() { return Pending.Format() } }
      type Row is { Content Display }
      type PendingRow is { Content Pending }
      func Invalid(Value Row) -> text { return Value.Content.ToText(1) }
      func Missing(Value Row) -> text { return Value.Content.Absent() }
      func Pending(Value PendingRow) { return Value.Content.Format() }
    `,
      true,
    )
    for (const name of ['Invalid', 'Missing', 'Pending']) {
      const owner = namedFunction(file, name)
      const call = AST.streamAllContents(owner).find(AST.isMethodCallExpression)
      Expect.Is(call, AST.isMethodCallExpression)
      const { snapshot, analysis } = materialize(file, owner)
      Expect(snapshot.calls.get(call)?.kind).toBe('unknown')
      Expect(snapshot.reads.get(call.callee)?.classification).toBe('unknown')
      Expect(analysis.effects.purity.open).toBe(true)
    }
  })
})

async function parse(source: string, allowUnresolved = false): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  if (!allowUnresolved) {
    Expect(parsed.diagnostics).toEqual([])
  }
  return parsed.entry.ast
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = AST.streamAllContents(file).find(node => AST.isFunctionDeclaration(node) && node.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}

function materialize(file: AST.TaoFile, owner: AST.Node) {
  const requirements = AST.streamAllContents(file).filter(AST.isCapabilityMethodDeclaration)
  const snapshot = ASTUtils.publishCanonicalEffectSnapshot([file], {
    requirements: new Map(requirements.map(requirement => [requirement, {
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    }])),
  })
  const projected = ASTUtils.projectCallableEffectPublications(snapshot, owner)
  const facts = ASTUtils.discoverCallableEffectFacts(owner, projected.inputs, projected.context)
  return { snapshot, facts, analysis: ASTUtils.analyzeCallableEffects(owner, facts) }
}

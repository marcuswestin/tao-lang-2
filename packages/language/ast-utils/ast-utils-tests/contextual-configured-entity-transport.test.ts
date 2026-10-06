import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'

Describe('Contextual configured entity handle transport', () => {
  Test('leaves raw entity values and authored fields unknown outside capability capture', async () => {
    const file = await parse(`
      data Books / Book {
        Title text,
        Parent Book
      }
      type RawRow is { Content Book }
      func Bare(Book Book) -> Book { return Book }
      func Raw(Book Book) -> RawRow { return RawRow { Content: Book } }
      func Reference(Book Book) -> RawRow { return RawRow { Book } }
      func Field(Book Book) -> text { return Book.Title }
      func EntityField(Book Book) -> RawRow { return RawRow { Content: Book.Parent } }
      func Many(Books Books) -> Books { return Books }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (const name of ['Bare', 'Raw', 'Reference', 'Field', 'EntityField', 'Many']) {
      const owner = namedFunction(file, name)
      const reference = read(owner)
      Expect(snapshot.reads.get(reference)?.classification).toBe('unknown')
      Expect(snapshot.reads.get(reference)?.proof?.kind).toBe('parameter')
      Expect(createAssociatedEffects([file]).analyses.get(owner)?.effects.purity.open).toBe(true)
    }
    for (const name of ['Raw', 'Reference']) {
      const site = AST.streamAllContents(namedFunction(file, name)).find(AST.isConfigurationConstructor)
      Expect.Is(site, AST.isConfigurationConstructor)
      const binding = snapshot.constructors.get(site)?.binding
      Expect(binding?.kind).toBe('complete')
      Expect(binding?.pairs[0]?.actual.kind).toBe('entity')
      Expect(binding?.pairs[0]?.expected.kind).toBe('entity')
    }
  })

  Test('does not exempt mutable, copied, action, state or alias entity operands', async () => {
    const file = await parse(`
      can Display { Label() fails never -> text }
      data Books / Book { Title text, func Book.Label() fails never -> text { return Book.Id } }
      type Row is { Content Display }
      func Mutable(mutable Book Book) -> Row { return Row { Content: Book } }
      func Copied(copy Book Book) -> Row { return Row { Content: Book } }
      action ActionValue(Book Book) -> Row { return Row { Content: Book } }
      view Scope(Book Book) {
        state Current is Book = Book
        let Alias = Book
        func State() -> Row { return Row { Content: Current } }
        func Aliased() -> Row { return Row { Content: Alias } }
      }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (const name of ['Mutable', 'Copied', 'State']) {
      Expect(snapshot.reads.get(read(namedFunction(file, name)))?.classification).toBe('reactive')
    }
    const action = file.statements.find(AST.isActionDeclaration)
    Expect.Is(action, AST.isActionDeclaration)
    Expect(snapshot.reads.get(read(action))?.classification).toBe('unknown')
    const alias = read(namedFunction(file, 'Aliased'))
    Expect(snapshot.reads.get(alias)?.proof?.kind).toBe('live-alias')
    Expect(snapshot.reads.get(alias)?.initializer).toBe(AST.streamAllContents(file).find(AST.isAliasDeclaration)?.value)
    Expect(createAssociatedEffects([file]).analyses.get(namedFunction(file, 'Aliased'))?.effects.purity.open).toBe(true)
  })

  Test('retains unknown binding and reads for a genuinely missing capability implementation', async () => {
    const file = await parse(`
      can Display { Label() fails never -> text }
      data Books / Book { Title text }
      type Row is { Content Display }
      func Missing(Book Book) -> Row { return Row { Content: Book } }
    `)
    const owner = namedFunction(file, 'Missing')
    const site = AST.streamAllContents(owner).find(AST.isConfigurationConstructor)
    Expect.Is(site, AST.isConfigurationConstructor)
    const snapshot = publishCanonicalEffectSnapshot([file])
    Expect(snapshot.constructors.get(site)?.kind).toBe('unknown')
    Expect(snapshot.reads.get(read(owner))?.classification).toBe('unknown')
    Expect(createAssociatedEffects([file]).analyses.get(owner)?.effects.purity.open).toBe(true)
  })
})

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  return parsed.entry.ast
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const owner = AST.streamAllContents(file).find(node => AST.isFunctionDeclaration(node) && node.name === name)
  Expect.Is(owner, AST.isFunctionDeclaration)
  return owner
}

function read(owner: AST.Node): AST.ValueReference | AST.MemberAccessExpression | AST.ConfigurationEntry {
  const reference = AST.streamAllContents(owner).find(node =>
    AST.isValueReference(node) || AST.isMemberAccessExpression(node)
    || (AST.isConfigurationEntry(node) && !!node.reference)
  )
  Expect.Is(
    reference,
    (node): node is AST.ValueReference | AST.MemberAccessExpression | AST.ConfigurationEntry =>
      AST.isValueReference(node) || AST.isMemberAccessExpression(node) || AST.isConfigurationEntry(node),
  )
  return reference
}

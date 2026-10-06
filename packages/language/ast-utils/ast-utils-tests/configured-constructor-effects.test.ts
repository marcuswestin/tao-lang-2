import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'
import { resolveConfiguredItemConstruction } from '../ast-utils-src/configured-item-bindings'
import { Type } from '../ast-utils-src/Type'

Describe('Configured constructor execution publication', () => {
  Test('allocates a named boolean wrapper and a record with actual reference entries', async () => {
    const file = await parse(`
      type RowFactory is yes/no
      type RowKey is text
      type Caption is text
      type Row is { Key RowKey, Caption Caption }
      func Enabled() fails never -> RowFactory { return RowFactory yes }
      func Build(Key RowKey, Caption Caption) fails never -> Row { return Row { Caption, Key } }
    `)
    const build = fn(file, 'Build')
    const site = constructor(build)
    const plan = resolveConfiguredItemConstruction(site)
    Expect(plan.kind).toBe('complete')
    Expect(plan.pairs.length).toBe(2)
    Expect(plan.pairs[0]?.entry).toBe(site.block?.entries[1])
    Expect(plan.pairs[1]?.entry).toBe(site.block?.entries[0])
    Expect(plan.operands[0]?.node).toBe(site.block?.entries[1])
    Expect(plan.operands[1]?.node).toBe(site.block?.entries[0])
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (const entry of site.block?.entries ?? []) {
      Expect(entry.reference?.ref).toBe(
        build.parameterList.parameters.find(parameter => Type.parameterName(parameter) === entry.reference?.$refText),
      )
      Expect(snapshot.reads.get(entry)?.classification).toBe('immutable')
    }
    const effects = createAssociatedEffects([file])
    for (const owner of [build, fn(file, 'Enabled')]) {
      Expect(effects.analyses.get(owner)?.effects).toEqual(closed)
    }
  })

  Test('executes only selected defaults in declaration order and leaves methods latent', async () => {
    const file = await parse(`
      let Foreign is text = Read from ./Native.ts
      type Row is {
        First text is Foreign,
        Second text is "default",
        Fixed is "filled",
        func Latent() fails never -> text { return Foreign }
      }
      func Omitted() -> Row { return Row {} }
      func Supplied() fails never -> Row { return Row { First: "safe" } }
    `)
    const omitted = fn(file, 'Omitted')
    const supplied = fn(file, 'Supplied')
    const plan = resolveConfiguredItemConstruction(constructor(supplied))
    Expect(plan.kind).toBe('complete')
    Expect(plan.operands.map(operand => operand.origin)).toEqual(['supplied', 'default', 'filled'])
    Expect(plan.operands[0]?.node).toBe(constructor(supplied).block?.entries[0])
    const methods = AST.streamAllContents(file).filter(AST.isAssociatedFunctionDeclaration)
    const methodNodes = new Set<AST.Node>(methods)
    Expect(plan.operands.some(operand => methodNodes.has(operand.node))).toBe(false)
    const effects = createAssociatedEffects([file])
    Expect(effects.analyses.get(supplied)?.effects).toEqual(closed)
    Expect(effects.analyses.get(omitted)?.effects.purity.open).toBe(true)
    Expect(effects.analyses.get(omitted)?.effects.failures.open).toBe(true)
  })

  Test('retains alias initializers and conservative bare entity reference reads', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      let Foreign is text = Read from ./Native.ts
      type Row is { Caption text }
      type EntityRow is { Book Book }
      func Aliased() -> Row { return Row { Foreign } }
      func Captured(Value Book) -> EntityRow { return EntityRow { Value } }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const alias = constructor(fn(file, 'Aliased')).block?.entries[0]
    Expect.Is(alias, AST.isConfigurationEntry)
    Expect(snapshot.reads.get(alias)?.initializer).toBe(file.statements.find(AST.isAliasDeclaration)?.value)
    const entity = constructor(fn(file, 'Captured')).block?.entries[0]
    Expect.Is(entity, AST.isConfigurationEntry)
    Expect(snapshot.reads.get(entity)?.classification).toBe('unknown')
    const effects = createAssociatedEffects([file])
    Expect(effects.analyses.get(fn(file, 'Aliased'))?.effects.failures.open).toBe(true)
    Expect(effects.analyses.get(fn(file, 'Captured'))?.effects.purity.open).toBe(true)
  })

  Test('rejects missing, ambiguous, duplicate and invalid labels without inventing bindings', async () => {
    const file = await parse(`
      type Pair is { Left text, Right text }
      func Missing() -> Pair { return Pair {} }
      func Ambiguous(Value text) -> Pair { return Pair { Value } }
      func Duplicate() -> Pair { return Pair { Left: "a", Left: "b", Right: "c" } }
      func Invalid() -> Pair { return Pair { Wrong: "a", Right: "b" } }
    `)
    for (const name of ['Missing', 'Ambiguous', 'Duplicate', 'Invalid']) {
      const site = constructor(fn(file, name))
      const plan = resolveConfiguredItemConstruction(site)
      Expect(plan.kind).toBe('invalid')
      Expect(plan.diagnostics.length > 0).toBe(true)
      Expect(publishCanonicalEffectSnapshot([file]).constructors.get(site)?.kind).toBe('unknown')
    }
    Expect(resolveConfiguredItemConstruction(constructor(fn(file, 'Ambiguous'))).pairs.length).toBe(0)
  })

  Test('binds actual nested records to declared capabilities without executing their methods', async () => {
    const file = await parse(`
      can Display { ToText() fails never -> text }
      type RowKey is text
      type HeaderLabel is text
      type GroupHeader is {
        HeaderLabel HeaderLabel,
        func ToText() fails never -> text { return GroupHeader.HeaderLabel }
      }
      type GroupedRow is { RowKey RowKey, Content Display }
      func Build(RowKey RowKey, HeaderLabel HeaderLabel) fails never -> GroupedRow {
        return GroupedRow { RowKey, Content: GroupHeader { HeaderLabel } }
      }
      func Bare(RowKey RowKey, HeaderLabel HeaderLabel) fails never -> GroupedRow {
        return GroupedRow { RowKey, GroupHeader { HeaderLabel } }
      }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (const name of ['Build', 'Bare']) {
      const owner = fn(file, name)
      const outer = constructor(owner)
      const nested = AST.streamAllContents(outer).find(node => AST.isConfigurationConstructor(node))
      const publication = snapshot.constructors.get(outer)
      Expect(publication?.binding?.kind).toBe('complete')
      Expect(publication?.binding?.pairs[1]?.field.name).toBe('Content')
      if (name === 'Build') {
        Expect.Is(nested, AST.isConfigurationConstructor)
        Expect(snapshot.constructors.get(nested)?.kind).toBe('complete')
      } else {
        const entry = outer.block?.entries[1]
        Expect.Is(entry, AST.isConfigurationEntry)
        Expect(snapshot.constructors.get(entry)?.kind).toBe('complete')
      }
      Expect(createAssociatedEffects([file]).analyses.get(owner)?.effects).toEqual(closed)
    }
  })

  Test('keeps abstract construction, configurable providers and unlinked entries unresolved', async () => {
    const file = await parse(
      `
      abstract type AbstractRow is { Caption text }
      type Provider is nav with { Caption text }
      type Row is { Caption text }
      data Books / Book { Title text }
      type Projection is Book { Title }
      can Display { ToText() fails never -> text }
      type Pending is { func ToText() { return Read() from ./Native.ts } }
      type CapabilityRow is { Content Display }
      func Abstract() -> AbstractRow { return AbstractRow { Caption: "x" } }
      func Configurable() -> Provider { return Provider { Caption: "x" } }
      func Unlinked() -> Row { return Row { Missing } }
      func Projected() -> Projection { return Projection { Title: "x" } }
      func PendingValue() -> CapabilityRow { return CapabilityRow { Content: Pending {} } }
    `,
      ["No data entity or value named 'Missing' is in scope."],
    )
    for (const name of ['Abstract', 'Configurable', 'Unlinked', 'Projected', 'PendingValue']) {
      const site = constructor(fn(file, name))
      Expect(resolveConfiguredItemConstruction(site).kind).toBe('unresolved')
      Expect(publishCanonicalEffectSnapshot([file]).constructors.get(site)?.kind).toBe('unknown')
    }
  })

  Test('propagates modeled operand/default failures while supplied values suppress defaults', async () => {
    const file = await parse(`
      type Problem is one of Broken
      func Native() fails Broken -> text { return Read() from ./Native.ts }
      type Row is { Caption text is Native() }
      func Omitted() fails Broken -> Row { return Row {} }
      func Explicit() fails Broken -> Row { return Row { Caption: Native() } }
      func Supplied() fails never -> Row { return Row { Caption: "safe" } }
    `)
    const effects = createAssociatedEffects([file])
    for (const name of ['Omitted', 'Explicit']) {
      Expect(effects.analyses.get(fn(file, name))?.effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: ['Broken'], open: false },
      })
    }
    Expect(effects.analyses.get(fn(file, 'Supplied'))?.effects).toEqual(closed)
  })

  Test('retains reactive supplied reference reads and empty record allocation', async () => {
    const file = await parse(`
      type Factory is {}
      type Row is { Caption text }
      func FactoryValue() fails never -> Factory { return Factory {} }
      func Mutable(mutable Caption text) -> Row { return Row { Caption } }
      func Copied(copy Caption text) -> Row { return Row { Caption } }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const effects = createAssociatedEffects([file])
    Expect(snapshot.constructors.get(constructor(fn(file, 'FactoryValue')))?.kind).toBe('complete')
    Expect(effects.analyses.get(fn(file, 'FactoryValue'))?.effects).toEqual(closed)
    for (const name of ['Mutable', 'Copied']) {
      const entry = constructor(fn(file, name)).block?.entries[0]
      Expect.Is(entry, AST.isConfigurationEntry)
      Expect(snapshot.reads.get(entry)?.classification).toBe('reactive')
      Expect(effects.analyses.get(fn(file, name))?.effects).toEqual({
        purity: { violations: ['reactive-state'], open: false },
        failures: { cases: [], open: false },
      })
    }
  })
})

const closed = { purity: { violations: [], open: false }, failures: { cases: [], open: false } }

async function parse(source: string, diagnostics: readonly string[] = []): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual(diagnostics)
  return parsed.entry.ast
}

function fn(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}

function constructor(owner: AST.Node): AST.ConfigurationConstructor {
  const site = AST.streamAllContents(owner).find(AST.isConfigurationConstructor)
  Expect.Is(site, AST.isConfigurationConstructor)
  return site
}

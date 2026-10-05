import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { resolveAssociatedMethodInvocation } from '../ast-utils-src/associated-invocations'
import { resolveRenderInvocation } from '../ast-utils-src/invocations'
import { Type } from '../ast-utils-src/Type'

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors.map(error => error.message)).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  return parsed.entry.ast
}

function view(file: AST.TaoFile, name: string): AST.ViewDeclaration {
  const declaration = file.statements.find(node => AST.isViewDeclaration(node) && node.name === name)
  Expect.Is(declaration, AST.isViewDeclaration)
  return declaration
}

function renders(declaration: AST.ViewDeclaration): AST.RenderStatement[] {
  return AST.statementsOf(declaration.block).filter(AST.isRenderStatement)
}

Describe('ordinary generic view binding', () => {
  Test('resolves native item slot domains against the actual enclosing generic view', async () => {
    const file = await parse(`
      can Keyed { Key() fails never -> text }
      can Displayed { Render() fails never -> rendered }
      view NativeRows where type T is Keyed and Displayed, type U is Keyed (Items list of T, Footer U)
        accepts slots @item(Value T, Ordinal number) from ./NativeRows.tsx
    `)
    const native = view(file, 'NativeRows')
    const input = native.foreign!.slots[0]!.parameterList!.parameters[0]!
    const type = Type.ofParameter(input)
    Expect(type.genericParameter).toBe(native.genericParameters[0])
    Expect(Type.aggregateCapabilityRequirements(type).map(requirement => requirement.name)).toEqual(['Key', 'Render'])
    const items = Type.ofParameter(AST.parametersOf(native)[0]!)
    Expect(items.kind).toBe('list')
    if (items.kind === 'list') {
      Expect(items.element?.genericParameter).toBe(type.genericParameter)
    }
  })
  Test('specializes actual view parameters while retaining event and source witnesses', async () => {
    const file = await parse(`
      type Name is text
      view Tile where type T is text (Value T, Press action) { }
      view Main(Value Name) {
        action Choose() { }
        render Tile(Value) { on press Choose }
      }
    `)
    const tile = view(file, 'Tile')
    const generic = tile.genericParameters[0]!
    const parameter = AST.parametersOf(tile)[0]!
    Expect(Type.ofParameter(parameter).genericParameter === generic).toBe(true)
    const render = renders(view(file, 'Main'))[0]!
    const resolved = resolveRenderInvocation(render)
    Expect(resolved.view === tile).toBe(true)
    Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(resolved.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(resolved.eventDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(resolved.pairs[0]?.parameter === parameter).toBe(true)
    Expect(resolved.pairs[0]?.argument === AST.argumentsOf(render)[0]).toBe(true)
    Expect(Type.displayName(resolved.parameterTypes!.get(parameter)!)).toBe('Name')
    Expect(resolved.transportTypes!.get(parameter)!.genericParameter === generic).toBe(true)
    Expect(Type.displayName(resolved.transportTypes!.get(parameter)!.genericReceiver!)).toBe('Name')
    Expect(resolved.result).toEqual({ kind: 'primitive', primitive: 'rendered' })
    Expect(resolved.eventPairs).toHaveLength(1)
    Expect(resolved.eventPairs[0]?.parameter === AST.parametersOf(tile)[1]).toBe(true)
  })

  Test('infers nominal list elements and forwards symbolic elements through actual view owners', async () => {
    const file = await parse(`
      type Name is text
      type ComparedNames is list of Name
      let Readers = ComparedNames ["Ada", "Lovelace"]
      view Listing where type T is text (Values list of T) { }
      view Forward where type U is text (Values list of U) { render Listing(Values) }
      view Main { render Listing(Readers) }
    `)
    const listing = view(file, 'Listing')
    const parameter = AST.parametersOf(listing)[0]!
    for (const name of ['Main', 'Forward']) {
      const render = renders(view(file, name))[0]!
      const resolved = resolveRenderInvocation(render)
      Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(resolved.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual([])
      const concrete = resolved.parameterTypes!.get(parameter)!
      const transport = resolved.transportTypes!.get(parameter)!
      Expect(concrete.kind).toBe('list')
      Expect(transport.kind).toBe('list')
      if (concrete.kind !== 'list' || transport.kind !== 'list') {
        continue
      }
      Expect(concrete.nominal === parameter.inlineType).toBe(true)
      Expect(transport.nominal === concrete.nominal).toBe(true)
      Expect(transport.element?.genericParameter === listing.genericParameters[0]).toBe(true)
      Expect(Type.displayName(concrete.element!)).toBe(name === 'Main' ? 'Name' : 'U')
      Expect(Type.displayName(transport.element!.genericReceiver!)).toBe(name === 'Main' ? 'Name' : 'U')
      if (name === 'Forward') {
        Expect(concrete.element?.genericParameter === view(file, 'Forward').genericParameters[0]).toBe(true)
      }
      const context = Type.correspondenceResolver(new Map())
      const instantiated = context.instantiateGenericInvocation(listing, AST.argumentsOf(render))
      Expect(instantiated.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(instantiated.result).toEqual({ kind: 'primitive', primitive: 'rendered' })
    }
  })

  Test('keeps independent lexical symbols distinct and excludes raw or defaulted inference anchors', async () => {
    const file = await parse(`
      view Independent where type T is text, type U is text (Left T, Right U) { }
      view Tile where type T is text (Value T default "fallback") { }
      view Main { render Tile(Value: "raw") render Tile() }
    `)
    const independent = view(file, 'Independent')
    const left = Type.ofParameter(AST.parametersOf(independent)[0]!)
    const right = Type.ofParameter(AST.parametersOf(independent)[1]!)
    Expect(left.genericParameter === independent.genericParameters[0]).toBe(true)
    Expect(right.genericParameter === independent.genericParameters[1]).toBe(true)
    Expect(Type.identityKey(left) === Type.identityKey(right)).toBe(false)
    Expect(Type.isCallableAssignable(left, right)).toBe(false)
    const calls = renders(view(file, 'Main'))
    Expect(calls).toHaveLength(2)
    for (const render of calls) {
      Expect(resolveRenderInvocation(render).genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual([
        'uninferred-generic',
      ])
    }
  })

  Test('uses actual generic view role constructors to infer typed payloads only', async () => {
    const file = await parse(`
      type Name is text
      view Tile where type T is text (Value T) { }
      view Main(Provided Name) { render Tile(.Value Provided) render Tile(.Value "raw") }
    `)
    const calls = renders(view(file, 'Main'))
    Expect(calls).toHaveLength(2)
    const parameter = AST.parametersOf(view(file, 'Tile'))[0]!
    const argument = AST.argumentsOf(calls[0]!)[0]!
    Expect(Type.genericRoleConstructor(argument)?.parameter === parameter).toBe(true)
    const typed = resolveRenderInvocation(calls[0]!)
    Expect(typed.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(typed.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(Type.displayName(typed.parameterTypes!.get(parameter)!)).toBe('Name')
    const raw = resolveRenderInvocation(calls[1]!)
    Expect(raw.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual(['uninferred-generic'])
  })

  Test('keeps associated views nongeneric and specializes their concrete Self inputs', async () => {
    const file = await parse(`
      type Parent is text with { view Parent.Render(Other Self) { } }
      type Child is Parent
      func Show(Value Child, Other Child) -> rendered { return Value.Render(Other: Other) }
    `)
    const fn = file.statements.find(AST.isFunctionDeclaration)!
    const call = AST.returnStatementsOf(fn)[0]!.value
    Expect.Is(call, AST.isMethodCallExpression)
    const resolved = resolveAssociatedMethodInvocation(call)
    Expect(resolved.problem).toBeUndefined()
    Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect.Is(resolved.declaration, AST.isAssociatedViewDeclaration)
    Expect(Type.displayName(resolved.descriptor!.signature.inputs[0]!.type)).toBe('Child')
    Expect(resolved.genericDiagnostics).toBeUndefined()
    Expect(resolved.descriptor?.result).toEqual({ kind: 'primitive', primitive: 'rendered' })
  })
})

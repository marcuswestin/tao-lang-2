import { ASTUtils, Packages, Type } from '@ast-utils'
import { AST, Parser, URI } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

const declarations = `
  use Occurrence from @tao/ui
  type Name is text
  type Names is list of Name
  view Rows where type T is text (Items list of T, Footer number)
    accepts slots @item(Value T, Occurrence) from ./Rows.tsx
`

function namedView(file: AST.TaoFile, name: string): AST.ViewDeclaration {
  const view = file.statements.find(node => AST.isViewDeclaration(node) && node.name === name)
  Expect.Is(view, AST.isViewDeclaration)
  return view
}

async function withParsed(source: string, check: (parsed: Awaited<ReturnType<typeof Parser.parse>>) => void) {
  await withTaoFiles('tao-typed-renderer-slots-', { 'Main.tao': source }, async (paths, root) => {
    const packages = Packages.createResolver(await Packages.createContext(root))
    const parsed = await Parser.parse(Parser.createContext({ packages }), URI.file(paths['Main.tao']))
    Expect(parsed.diagnostics).toEqual([])
    check(parsed)
  })
}

Describe('typed renderer slot domains', () => {
  Test('matches specialized generic renderer inputs by concrete nominal type without losing their owners', async () => {
    await withParsed(
      `
      ${declarations}
      type OtherName is text
      view Concrete(Occurrence, Name) { render Name }
      view Sibling(OtherName, Occurrence) { render OtherName }
      view ConcreteOwner(Items Names) {
        @row(Name, Occurrence): empty
        render Rows(Items, 1) { @item: @row }
      }
      view NamedOwner(Items Names) {
        render Rows(Items, 1) { @item: Concrete }
      }
      view WrongOwner(Items Names) {
        render Rows(Items, 1) { @item: Sibling }
      }
    `,
      parsed => {
        const name = parsed.entry.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Name')
        Expect.Is(name, AST.isTypeDeclaration)
        const owner = namedView(parsed.entry.ast, 'ConcreteOwner')
        const use = [...AST.streamAllContents(owner)].find(AST.isRenderSlotUse)!
        const comparison = ASTUtils.compareRendererSlotForwarding(use)!
        Expect(comparison.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
        const pair = comparison.correspondence.find(pair => pair.supplied.localName === 'Name')!
        Expect(pair.required.declaration).toBe(AST.renderSlotParametersOf(use.slot.ref!)[0])
        Expect(pair.supplied.declaration).toBe(AST.renderSlotParametersOf(use.forwardedSlot!.ref!)[0])
        Expect(Type.identityKey(pair.required.type)).toBe(Type.identityKey(Type.ofDefinition(name)))
        Expect(Type.identityKey(pair.supplied.type)).toBe(Type.identityKey(Type.ofDefinition(name)))
        for (
          const [ownerName, rendererName, compatible] of [
            ['NamedOwner', 'Concrete', true],
            ['WrongOwner', 'Sibling', false],
          ] as const
        ) {
          const fill = [...AST.streamAllContents(namedView(parsed.entry.ast, ownerName))].find(AST.isRenderSlotUse)!
          Expect(
            ASTUtils.compareRendererSlotRenderer(fill.slot.ref!, namedView(parsed.entry.ast, rendererName), fill)
              .compatible,
          ).toBe(compatible)
        }
      },
    )
  })

  Test('retains generic role preference and rejects ambiguous, wrong-domain and writable correspondences', async () => {
    await withParsed(
      `
      ${declarations}
      type Count is number
      type OtherName is text
      view Pair where type T is text (Items list of T) accepts slots @item(First T, Second T) from ./Pair.tsx
      view Directed(Items Names) {
        @row(Second Name, First Name): empty
        render Pair(Items) { @item: @row }
      }
      view Ambiguous(Items Names) {
        @row(Left Name, Right Name): empty
        render Pair(Items) { @item: @row }
      }
      view Wrong(Items Names) {
        @row(Count, Occurrence): empty
        render Rows(Items, 1) { @item: @row }
      }
      view Writer(Items Names) {
        @row(mutable Name, Occurrence): empty
        render Rows(Items, 1) { @item: @row }
      }
      view Conflicting(Items Names) {
        @row(Value OtherName default "other", Name, Occurrence): empty
        render Rows(Items, 1) { @item: @row }
      }
      view Ordinary accepts slots @item(Value text) from ./Ordinary.tsx
      view WrongRole {
        @row(Wrong text): empty
        render Ordinary { @item: @row }
      }
    `,
      parsed => {
        for (const name of ['Directed', 'Ambiguous', 'Wrong', 'Writer', 'Conflicting', 'WrongRole']) {
          const use = [...AST.streamAllContents(namedView(parsed.entry.ast, name))].find(AST.isRenderSlotUse)!
          const comparison = ASTUtils.compareRendererSlotForwarding(use)!
          Expect(comparison.compatible).toBe(name === 'Directed')
          if (name === 'Directed') {
            Expect(comparison.correspondence.map(pair => [pair.required.role, pair.supplied.role])).toEqual([
              ['Second', 'Second'],
              ['First', 'First'],
            ])
          }
          if (name === 'Ambiguous') {
            Expect(comparison.correspondence).toEqual([])
          }
          if (name === 'WrongRole') {
            Expect(comparison.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['unknown-named', 'missing'])
          }
          if (name === 'Conflicting') {
            Expect(
              comparison.diagnostics.some(diagnostic =>
                diagnostic.kind === 'incompatible-input' && diagnostic.required.role === 'Value'
              ),
            ).toBe(true)
          }
        }
      },
    )
  })

  Test(
    'specializes inline input domains while retaining actual slot, binding and library Occurrence owners',
    async () => {
      await withParsed(
        `
      ${declarations}
      view Main {
        let Items = Names ["Ada"]
        render Rows(Items, 1) { @item Entry, Position -> Entry }
      }
    `,
        parsed => {
          const rows = namedView(parsed.entry.ast, 'Rows')
          const use = [...AST.streamAllContents(namedView(parsed.entry.ast, 'Main'))].find(AST.isRenderSlotUse)!
          const contract = use.slot.ref!
          const parameters = AST.renderSlotParametersOf(contract)
          const invocation = AST.renderSlotInvocationOf(use)!
          Expect(invocation.view?.ref).toBe(rows)
          const actual = ASTUtils.resolveRenderInvocation(invocation)
          Expect(actual.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual([])
          Expect(Type.displayName(actual.bindings!.get(rows.genericParameters[0]!)!)).toBe('Name')
          const signature = ASTUtils.rendererSlotSignatureOf(contract, use)
          Expect(signature.inputs.map((input, index) => input.declaration === parameters[index])).toEqual([true, true])
          Expect(signature.inputs.map(input => Type.displayName(input.type))).toEqual(['Name', 'Occurrence'])
          const library = parsed.files.find(file => file.path.endsWith('/@tao/ui/LazyList.tao'))
          Expect(library).toBeDefined()
          const occurrence = library!.ast.statements.find(node =>
            AST.isTypeDeclaration(node) && node.name === 'Occurrence'
          )
          Expect.Is(occurrence, AST.isTypeDeclaration)
          Expect(signature.inputs[1]!.type.kind).toBe('item')
          Expect(signature.inputs[1]!.type.kind === 'item' && signature.inputs[1]!.type.nominal).toBe(occurrence)
          for (const [index, binding] of use.inputBindings.entries()) {
            const domain = ASTUtils.resolveRendererSlotInputBinding(binding)
            Expect(domain?.binding).toBe(binding)
            Expect(domain?.parameter).toBe(parameters[index])
            Expect(domain?.input.declaration).toBe(parameters[index])
            Expect(Type.displayName(Type.ofValueDeclaration(binding))).toBe(index === 0 ? 'Name' : 'Occurrence')
          }
          const position = Type.ofRenderSlotInputBinding(use.inputBindings[1]!)
          const ordinal = Type.atMemberPath(position, ['Ordinal'])
          Expect(ordinal.kind === 'primitive' && ordinal.primitive).toBe('number')
          Expect(Type.displayName(ordinal)).toBe('Occurrence.Ordinal')
          Expect(Type.ofParameter(parameters[0]!).genericParameter).toBe(rows.genericParameters[0])
        },
      )
    },
  )

  Test('passes occurrence omission metadata through the real enclosing generic invocation', async () => {
    await withParsed(
      `
      ${declarations}
      view Main {
        let Items = Names ["Ada"]
        render Rows(Items) { @item Entry -> Entry }
      }
    `,
      parsed => {
        const rows = namedView(parsed.entry.ast, 'Rows')
        const footer = AST.parametersOf(rows)[1]!
        const use = [...AST.streamAllContents(namedView(parsed.entry.ast, 'Main'))].find(AST.isRenderSlotUse)!
        const invocation = AST.renderSlotInvocationOf(use)!
        Expect(ASTUtils.resolveRenderInvocation(invocation).diagnostics.map(diagnostic => diagnostic.kind))
          .toEqual(['missing-argument'])
        const observed = new Set<AST.ParameterDeclaration>()
        const metadata = {
          parameterOmissible: (parameter: AST.ParameterDeclaration) => {
            observed.add(parameter)
            return parameter === footer
          },
        }
        const signature = ASTUtils.rendererSlotSignatureOf(use.slot.ref!, use, metadata)
        Expect(observed.has(footer)).toBe(true)
        Expect(signature.inputs[0]!.declaration).toBe(AST.renderSlotParametersOf(use.slot.ref!)[0])
        Expect(Type.displayName(signature.inputs[0]!.type)).toBe('Name')
        Expect(ASTUtils.resolveRenderInvocation(invocation, metadata).diagnostics).toEqual([])
        Expect(Type.displayName(Type.ofRenderSlotInputBinding(use.inputBindings[0]!, metadata))).toBe('Name')
      },
    )
  })

  Test(
    'compares actual forwarded slots with specialized domains and rejects readonly-to-writable replacement',
    async () => {
      await withParsed(
        `
      ${declarations}
      view Safe(Items Names) {
        @item(Value Name, Occurrence): empty
        render Rows(Items, 1) { @item: @item }
      }
      view WrongDomain(Items Names) {
        @item(Value number, Occurrence): empty
        render Rows(Items, 1) { @item: @item }
      }
      view Writer(Items Names) {
        @item(mutable Value Name, Occurrence): empty
        render Rows(Items, 1) { @item: @item }
      }
    `,
        parsed => {
          for (const name of ['Safe', 'WrongDomain', 'Writer']) {
            const owner = namedView(parsed.entry.ast, name)
            const use = [...AST.streamAllContents(owner)].find(AST.isRenderSlotUse)!
            const supplied = AST.renderSlotDeclarationsOf(owner)[0]!
            Expect(use.forwardedSlot?.ref).toBe(supplied)
            Expect(use.slot.ref).toBe(AST.renderSlotDeclarationsOf(namedView(parsed.entry.ast, 'Rows'))[0])
            const comparison = ASTUtils.compareRendererSlotForwarding(use)
            Expect(comparison).toBeDefined()
            Expect(comparison!.compatible).toBe(name === 'Safe')
            if (name === 'Safe') {
              Expect(comparison!.diagnostics).toEqual([])
              Expect(
                comparison!.correspondence.map((pair, index) =>
                  pair.required.declaration === AST.renderSlotParametersOf(use.slot.ref!)[index]
                ),
              ).toEqual([true, true])
              Expect(
                comparison!.correspondence.map((pair, index) =>
                  pair.supplied.declaration === AST.renderSlotParametersOf(supplied)[index]
                ),
              ).toEqual([true, true])
            } else {
              const reason = name === 'Writer' ? 'caller-storage' : 'input-domain'
              Expect(
                comparison!.diagnostics.some(diagnostic =>
                  diagnostic.kind === 'incompatible-input' && diagnostic.reasons.includes(reason)
                ),
              ).toBe(true)
            }
          }
        },
      )
    },
  )
  Test('renders real inline text, view, scene and nav bindings without replacing their nodes', async () => {
    await withParsed(
      `
      view Receiver accepts slots @item(TextValue text, ViewValue view, SceneValue scene, NavValue nav) from ./Receiver.tsx
      view Main {
        render Receiver {
          @item TextEntry, ViewEntry, SceneEntry, NavEntry -> TextEntry {
            ViewEntry
            SceneEntry
            NavEntry
          }
        }
      }
    `,
      parsed => {
        const use = [...AST.streamAllContents(namedView(parsed.entry.ast, 'Main'))].find(AST.isRenderSlotUse)!
        const renders = [use.render!, ...use.render!.block!.statements.filter(AST.isViewRender)]
        Expect(renders).toHaveLength(4)
        for (const [index, render] of renders.entries()) {
          const target = ASTUtils.resolveRenderTarget(render)
          Expect(target).toBeDefined()
          Expect(ASTUtils.renderTargetName(target!)).toBe(use.inputBindings[index]!.name)
          if (index === 0) {
            Expect(target!.kind).toBe('text')
            Expect(target!.kind === 'text' && target!.declaration).toBe(use.inputBindings[index])
          } else {
            Expect(target!.kind).toBe('parameter')
            Expect(target!.kind === 'parameter' && target!.parameter).toBe(use.inputBindings[index])
            Expect(target!.kind === 'parameter' && target!.family).toBe(['view', 'scene', 'nav'][index - 1])
            Expect(ASTUtils.renderTargetIsNav(target!)).toBe(index === 3)
          }
        }
      },
    )
  })
})

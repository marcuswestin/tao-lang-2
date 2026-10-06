import { ASTUtils, Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { associatedWitnessExports } from '../compiler-src/codegen/react-native/app/associated-witness-plan'
import {
  compileAssociatedWitness,
  withAssociatedWitnessBindings,
} from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { capabilityTransportOwners } from '../compiler-src/codegen/react-native/app/capability-projection'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: published associated rendered views', () => {
  Test('calls a real view witness without executing its component and retains live receiver inputs', async () => {
    const parsed = await Parser.parseCode(`
      type Token is text with {
        view Render(Prefix text) { render Prefix }
      }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const owner = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(owner, AST.isTypeDeclaration)
    const view = ASTUtils.ownAssociatedViews(owner)[0]!
    const selected = Type.associatedCallable(view, owner)
    Assert(selected.kind === 'ready', 'the authored view has its mounted descriptor')
    const code = withAssociatedWitnessBindings(
      new Map([[owner, '_Witness']]),
      () => Langium.toString(Compile.AssociatedMethodsDeclaration(owner)),
    )
    const javascript = new Bun.Transpiler({ loader: 'tsx' }).transformSync(code)
    const { default: TR } = await runtimeModule
    const scope = { Token: TR.Value('module shadow') }
    const witness = new Function('TR', '_Scope', `${javascript}\nreturn _Witness`)(TR, scope)
    const receiver = TR.Cell(TR.Value('before'))
    const prefix = TR.Value('Caption: ')
    const description = TR.Call(witness.Render, receiver, prefix)
    const mounted = TR.MountRendered(description, { __tao: { testTag: 'occurrence' } })
    Expect(mounted.type).toBe(witness.$views[0])
    Expect(mounted.props).toMatchObject({ __taoReceiver: receiver, Prefix: prefix })
    receiver.set(TR.Value('after'))
    Expect(mounted.props.__taoReceiver.getJSValue()).toBe('after')
    Expect(scope.Token.getJSValue()).toBe('module shadow')
    Expect(
      withAssociatedWitnessBindings(
        new Map([[owner, '_Witness']]),
        () => Langium.toString(compileAssociatedWitness(selected.descriptor)),
      ),
    ).toBe('_Witness["Render"]')
  })

  Test('publishes an entity view and transports its structural witness under the single-item receiver', async () => {
    const parsed = await Parser.parseCode(
      `
      can ui { Render() fails never -> rendered }
      data Books / Book {
        Title text,
        view Book.Render() { render Book.Title }
      }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const owner = parsed.entry.ast.statements.find(AST.isEntityDataDeclaration)
    const capability = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(owner, AST.isEntityDataDeclaration)
    Expect.Is(capability, AST.isTypeDeclaration)
    Expect(associatedWitnessExports(parsed.entry.ast).has(owner)).toBe(true)
    const actual = Type.ofAssociatedOwner(owner)
    const expected = Type.ofDefinition(capability)
    ASTUtils.withAssociatedEffects(ASTUtils.createAssociatedEffects([parsed.entry.ast]), () => {
      const plan = ASTUtils.planCapabilityTransport(actual, expected)
      Assert(plan.kind === 'ready', 'the real mounted creator satisfies the render capability')
      Expect(capabilityTransportOwners(actual, expected).has(owner)).toBe(true)
    })
    const code = withAssociatedWitnessBindings(
      new Map([[owner, '_BookWitness']]),
      () => Langium.toString(Compile.EntityDataDeclaration(owner)),
    )
    Expect(code).toContain('_Scope.Book = _ViewProps.__taoReceiver')
    Expect(code).not.toContain('_Scope.Books = _ViewProps.__taoReceiver')
    Expect(code).toContain('TR.RenderView(_BookWitness["$views"][0]')
  })
})

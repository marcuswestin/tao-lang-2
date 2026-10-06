import { AST, Parser } from '@parser'
import { Assert, Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { parameterRequiresWritable } from '../ast-utils-src/reactive-parameters'
import {
  bindRendererSlotArguments,
  compareRendererSlotRenderer,
  rendererSlotSignatureOf,
} from '../ast-utils-src/renderer-slots'

Describe('Renderer slot signatures and storage', () => {
  Test('uses real slot parameters for named defaults, replacements, fills, and placements', async () => {
    const parsed = await Parser.parseCode(`
      view Default(Value text?, Caption text default "caption") { }
      view Replacement(Caption text default "caption", Value text?) { }
      view Host() { }
      view Owner() {
        @item(Value text?, Caption text default "caption"): Default
        @empty: empty
        render Host() {
          @item(Caption: "caption", Value: "value")
          @item()
          @item(Value: "first", Value: "second", Extra: "unknown")
          @empty
        }
      }
      view Main() {
        render Owner() {
          @item: Replacement
          @empty: empty
        }
      }
    `)
    expectParserAndLinkClean(parsed.diagnostics)
    const nodes = [...AST.streamAllContents(parsed.entry.ast)]
    const contract = nodes.find(AST.isRenderSlotDeclaration)
    Expect.Is(contract, AST.isRenderSlotDeclaration)
    const uses = nodes.filter(AST.isRenderSlotUse)
    Expect(uses).toHaveLength(6)
    Expect(uses.map(AST.isRenderSlotFill)).toEqual([false, false, false, false, true, true])
    const placements = uses.filter(use => !AST.isRenderSlotFill(use))
    const fills = uses.filter(AST.isRenderSlotFill)
    Expect(placements).toHaveLength(4)
    Expect(fills).toHaveLength(2)

    const signature = rendererSlotSignatureOf(contract)
    Expect(AST.renderSlotParameterOwner(signature.inputs[0]!.declaration) === contract).toBe(true)
    Expect(signature.inputs.map(input => [input.role, input.acceptsNone, input.omissible])).toEqual([
      ['Value', true, false],
      ['Caption', false, true],
    ])
    const comparison = compareRendererSlotRenderer(contract, findView(nodes, 'Replacement'))
    Expect(comparison.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(comparison.correspondence.map(pair => [pair.required.role, pair.supplied.role])).toEqual([
      ['Caption', 'Caption'],
      ['Value', 'Value'],
    ])

    const [complete, missing, duplicateAndUnknown, emptyPlacement] = placements
    Expect.Is(complete, AST.isRenderSlotUse)
    const completeBinding = bindRendererSlotArguments(complete)
    Assert.defined(completeBinding, 'a linked placement has a slot signature')
    Expect(completeBinding.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    const completeArguments = AST.argumentsOf(complete)
    Expect(completeArguments).toHaveLength(2)
    Expect(completeBinding.pairs).toHaveLength(2)
    Expect(completeBinding.pairs[0]?.parameter === signature.inputs[0]!.declaration).toBe(true)
    Expect(completeBinding.pairs[0]?.argument === completeArguments[1]).toBe(true)
    Expect(completeBinding.pairs[1]?.parameter === signature.inputs[1]!.declaration).toBe(true)
    Expect(completeBinding.pairs[1]?.argument === completeArguments[0]).toBe(true)
    Expect.Is(missing, AST.isRenderSlotUse)
    const missingBinding = bindRendererSlotArguments(missing)
    Assert.defined(missingBinding, 'the incomplete placement links to its slot')
    Expect(missingBinding.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['missing-argument'])
    const missingDiagnostic = missingBinding.diagnostics[0]
    if (missingDiagnostic?.kind === 'missing-argument') {
      Expect(missingDiagnostic.parameter === signature.inputs[0]!.declaration).toBe(true)
    }
    Expect.Is(duplicateAndUnknown, AST.isRenderSlotUse)
    const malformedBinding = bindRendererSlotArguments(duplicateAndUnknown)
    Assert.defined(malformedBinding, 'the malformed placement still links to its slot')
    Expect(malformedBinding.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([
      'duplicate-named-argument',
      'unknown-named-argument',
    ])
    const duplicateDiagnostic = malformedBinding.diagnostics.find(diagnostic =>
      diagnostic.kind === 'duplicate-named-argument'
    )
    if (duplicateDiagnostic?.kind === 'duplicate-named-argument') {
      Expect(duplicateDiagnostic.argument === AST.argumentsOf(duplicateAndUnknown)[1]).toBe(true)
    }
    const unknownDiagnostic = malformedBinding.diagnostics.find(diagnostic =>
      diagnostic.kind === 'unknown-named-argument'
    )
    if (unknownDiagnostic?.kind === 'unknown-named-argument') {
      Expect(unknownDiagnostic.argument === AST.argumentsOf(duplicateAndUnknown)[2]).toBe(true)
    }
    Expect(fills.every(fill => AST.isRenderSlotFill(fill))).toBe(true)
    Expect(fills.map(fill => AST.renderSlotBodyOf(fill).kind)).toEqual(['named', 'empty'])
    Expect(fills.every(fill => bindRendererSlotArguments(fill) === undefined)).toBe(true)
    const namedBody = AST.renderSlotBodyOf(fills[0]!)
    Expect(namedBody.kind).toBe('named')
    if (namedBody.kind === 'named') {
      Expect(namedBody.renderer.ref === findView(nodes, 'Replacement')).toBe(true)
    }
    Expect.Is(emptyPlacement, AST.isRenderSlotUse)
    Expect(bindRendererSlotArguments(emptyPlacement)?.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    const emptyContract = nodes.find(node =>
      AST.isRenderSlotDeclaration(node) && AST.renderSlotBodyOf(node).kind === 'empty'
    )
    Expect.Is(emptyContract, AST.isRenderSlotDeclaration)
    Expect(AST.renderSlotBodyOf(emptyContract).kind).toBe('empty')
  })

  Test('infers writable defaults, permits readonly replacements, and checks writable domains', async () => {
    const parsed = await Parser.parseCode(`
      type Base is text
      type Leaf is Base
      view MutableDefault(mutable Value Base) { }
      view Readonly(Value Base) { }
      view MutableLeaf(mutable Value Leaf) { }
      view BroadWriter(mutable Value Base) { }
      view ReadonlyDefault(Value Base) { }
      view Owner() {
        @item(Value Base): MutableDefault
        @leaf(Value Leaf): MutableLeaf
        @readonly(Value Base): ReadonlyDefault
      }
    `)
    expectParserAndLinkClean(parsed.diagnostics)
    const nodes = [...AST.streamAllContents(parsed.entry.ast)]
    const contracts = nodes.filter(AST.isRenderSlotDeclaration)
    Expect(contracts).toHaveLength(3)
    const [contract, leafContract, readonlyContract] = contracts
    Expect.Is(contract, AST.isRenderSlotDeclaration)
    Expect.Is(leafContract, AST.isRenderSlotDeclaration)
    Expect.Is(readonlyContract, AST.isRenderSlotDeclaration)
    const parameter = AST.renderSlotParametersOf(contract)[0]
    Expect.Is(parameter, AST.isParameterDeclaration)
    Expect(parameterRequiresWritable(parameter)).toBe(true)
    Expect(parameterRequiresWritable(parameter)).toBe(true)
    Expect(rendererSlotSignatureOf(contract).inputs[0]!.callerWritable).toBe(true)
    Expect(compareRendererSlotRenderer(contract, findView(nodes, 'Readonly')).compatible).toBe(true)
    const broadWriter = compareRendererSlotRenderer(leafContract, findView(nodes, 'BroadWriter'))
    Expect(broadWriter.compatible).toBe(false)
    Expect(
      broadWriter.diagnostics.some(diagnostic =>
        diagnostic.kind === 'incompatible-input' && diagnostic.reasons.includes('write-domain')
      ),
    ).toBe(true)
    const mutableAgainstReadonly = compareRendererSlotRenderer(readonlyContract, findView(nodes, 'MutableDefault'))
    Expect(mutableAgainstReadonly.compatible).toBe(false)
    Expect(
      mutableAgainstReadonly.diagnostics.some(diagnostic =>
        diagnostic.kind === 'incompatible-input' && diagnostic.reasons.includes('caller-storage')
      ),
    ).toBe(true)
  })

  Test('follows placement forwarding and parameter defaults while preserving copy isolation', async () => {
    const parsed = await Parser.parseCode(`
      view Writer(mutable Value number, mutable Other number) { }
      view Host() { }
      view Nested(Forwarded number, copy Snapshot number) {
        @item(Value number, Other number): Writer
        render Host() { @item(Value: Forwarded, Other: Snapshot) }
      }
      view Defaults() {
        @item(Source number, mutable Value number default Source): empty
      }
    `)
    expectParserAndLinkClean(parsed.diagnostics)
    const nodes = [...AST.streamAllContents(parsed.entry.ast)]
    const nested = findView(nodes, 'Nested')
    const nestedParameters = AST.parametersOf(nested)
    Expect(nestedParameters.map(parameter => parameterRequiresWritable(parameter))).toEqual([true, false])
    const defaults = findView(nodes, 'Defaults')
    const defaultContract = [...AST.streamAllContents(defaults)].find(AST.isRenderSlotDeclaration)
    Expect.Is(defaultContract, AST.isRenderSlotDeclaration)
    const [sourceParameter] = AST.renderSlotParametersOf(defaultContract)
    const [, valueParameter] = AST.renderSlotParametersOf(defaultContract)
    Expect.Is(sourceParameter, AST.isParameterDeclaration)
    Expect.Is(valueParameter, AST.isParameterDeclaration)
    Expect(parameterRequiresWritable(sourceParameter)).toBe(true)
    Expect(parameterRequiresWritable(valueParameter)).toBe(true)
  })

  Test('terminates real named-default and nested-placement cycles on repeated queries', async () => {
    const parsed = await Parser.parseCode(`
      view A(Value text) {
        @loop(Value text): B
        render Host() { @loop(Value) }
      }
      view B(mutable Value text) {
        @loop(Value text): A
        render Host() { @loop(Value) }
      }
      view C(Value text) {
        @loop(Value text): D
        render Host() { @loop(Value) }
      }
      view D(Value text) {
        @loop(Value text): C
        render Host() { @loop(Value) }
      }
      view Host() { }
    `)
    expectParserAndLinkClean(parsed.diagnostics)
    const nodes = [...AST.streamAllContents(parsed.entry.ast)]
    const contracts = nodes.filter(AST.isRenderSlotDeclaration)
    Expect(contracts).toHaveLength(4)
    const parameters = contracts.map(contract => AST.renderSlotParametersOf(contract)[0]!)
    const first = parameters.map(parameter => parameterRequiresWritable(parameter))
    Expect(first).toEqual(parameters.map(parameter => parameterRequiresWritable(parameter)))
    Expect(first).toEqual([true, true, false, false])
  })
})

function findView(nodes: readonly AST.Node[], name: string): AST.ViewDeclaration {
  const view = nodes.find(node => AST.isViewDeclaration(node) && node.name === name)
  Expect.Is(view, AST.isViewDeclaration)
  return view
}

function expectParserAndLinkClean(diagnostics: Parameters<typeof Diagnostics.errorMessages>[0]): void {
  Expect(Diagnostics.errorMessages(diagnostics, 'parser')).toEqual([])
  Expect(Diagnostics.errorMessages(diagnostics, 'linker')).toEqual([])
}

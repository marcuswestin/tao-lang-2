import { ASTUtils, Type } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Assert, Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { analyzeCallableEffects, type CallableAnalysis } from '../../ast-utils/ast-utils-src/callable-effects'
import { NodeValidation } from '../validator-src/node-validation'
import { Validation } from '../validator-src/validation'
import {
  capabilityTransportValidationChecks,
  CapabilityTransportValidationMessages as messages,
  validateCapabilityTransport,
} from '../validator-src/validators/capability-transport-validator'

const declarations = `
  type A is text with { func ToText() -> text { return "a" } }
  type B is text with { func ToText() -> text { return "b" } }
  type Child is A
  type Erased is A | B
  type Equivalent is A | Child
  can Display { ToText() -> text }
`

async function fixture(source: string) {
  const parsed = await Parser.parseCode(declarations + source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  const file = parsed.entry.ast
  const owners = file.statements.filter(AST.isTypeDeclaration)
  const descriptors = new Map<
    AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
    ASTUtils.AssociatedCallableDescriptor
  >()
  const analyses = new Map<AST.Node, CallableAnalysis>()
  for (const owner of owners) {
    for (const method of [...ASTUtils.ownAssociatedMethods(owner), ...ASTUtils.capabilityRequirements(owner)]) {
      const callable = Type.associatedCallable(method, owner)
      Assert(callable.kind === 'ready', 'the parsed fixture has a ready real method descriptor')
      descriptors.set(method, callable.descriptor)
      if (AST.isAssociatedFunctionDeclaration(method)) {
        // Unit evidence exercises transport over sealed contracts; production discovery belongs to its producer.
        analyses.set(
          method,
          analyzeCallableEffects(method, [{
            node: method,
            kind: 'complete',
            purity: { open: false, violations: [] },
            failures: { cases: [], open: false },
            executes: [],
          }]),
        )
      }
    }
  }
  const collected = Validation.collectDiagnostics()
  const ctx = Validation.createContext(collected.accept, {
    entryFilePath: parsed.entry.path,
    workspaceFiles: [file],
    packagesContext: {
      index: { projectRoot: '/__fixture__', projectRoots: [], packages: new Map() },
      stdlibRoot: '/__fixture__',
      physicalPaths: new Map(),
      requirementAliases: new Map(),
    },
  })
  const namedType = (name: string) => {
    const owner = owners.find(owner => owner.name === name)
    Assert.defined(owner, 'the fixture has its named type')
    return owner
  }
  const fn = (name: string) => {
    const node = AST.streamAllContents(file).find(node => AST.isFunctionDeclaration(node) && node.name === name)
    Expect.Is(node, AST.isFunctionDeclaration)
    return node
  }
  return {
    file,
    descriptors,
    analyses,
    collected,
    ctx,
    namedType,
    fn,
    withEffects: <T>(run: () => T) => ASTUtils.withAssociatedEffects({ descriptors, analyses }, run),
  }
}

Describe('validator: capability transport', () => {
  Test('reports erased distinct methods at the real source expression without changing admission', async () => {
    const f = await fixture('func Entry(Value Erased) -> Display { return Value }')
    const value = AST.returnStatementsOf(f.fn('Entry'))[0]!.value
    const expected = Type.ofDefinition(f.namedType('Display'))
    f.withEffects(() => {
      Expect(Type.isAssignable(Type.ofExpression(value), expected)).toBe(true)
      Expect(validateCapabilityTransport(value, expected, f.ctx)).toEqual({
        kind: 'unsupported',
        reason: 'erased-union',
      })
    })
    Expect(f.collected.diagnostics.map(diagnostic => [diagnostic.message, diagnostic.nodeType, diagnostic.range]))
      .toEqual([[messages.alternatives('Display'), value.$type, value.$cstNode?.range]])
  })

  Test('accepts concrete, equivalent inherited and optional source conversions', async () => {
    const f = await fixture(`
      func Unique(Value A) -> Display { return Value }
      func EquivalentValue(Value Equivalent) -> Display { return Value }
      func ConsumeOptional(Value Display?) -> text { return "ok" }
      func Optional(Value A?) -> text { return ConsumeOptional(Value) }
    `)
    f.withEffects(() => {
      for (const name of ['Unique', 'EquivalentValue']) {
        const fn = f.fn(name)
        const value = AST.returnStatementsOf(fn)[0]!.value
        Expect(validateCapabilityTransport(value, Type.ofFunctionReturn(fn), f.ctx).kind).toBe('ready')
      }
      const call = AST.returnStatementsOf(f.fn('Optional'))[0]!.value
      Expect.Is(call, AST.isFunctionCallExpression)
      const expected = Type.ofParameter(AST.parametersOf(f.fn('ConsumeOptional'))[0]!)
      Expect(validateCapabilityTransport(AST.argumentsOf(call)[0]!.value, expected, f.ctx).kind).toBe('ready')
    })
    Expect(f.collected.diagnostics).toEqual([])
  })

  Test('keeps missing and open evidence unknown without fabricating a transport diagnostic', async () => {
    const f = await fixture('func Entry(Value A) -> Display { return Value }')
    const value = AST.returnStatementsOf(f.fn('Entry'))[0]!.value
    const expected = Type.ofDefinition(f.namedType('Display'))
    Expect(validateCapabilityTransport(value, expected, f.ctx)).toEqual({ kind: 'unknown', reason: 'missing-effects' })
    f.analyses.clear()
    f.withEffects(() => {
      Expect(validateCapabilityTransport(value, expected, f.ctx)).toEqual({ kind: 'unknown', reason: 'missing-proof' })
    })
    const method = ASTUtils.ownAssociatedMethods(f.namedType('A'))[0]!
    f.analyses.set(method, {
      effects: { purity: { open: true, violations: [] }, failures: { open: false, cases: [] } },
      findings: [],
    })
    f.withEffects(() => {
      Expect(validateCapabilityTransport(value, expected, f.ctx)).toEqual({ kind: 'unknown', reason: 'missing-proof' })
    })
    Expect(f.collected.diagnostics).toEqual([])
  })

  Test('registered checks anchor ordinary and associated arguments, defaults and returns', async () => {
    const f = await fixture(`
      func Ordinary(Value Display) -> text { return "ok" }
      func Source() -> Erased { return A "a" }
      func Defaulted(Value Display default Source()) -> text { return "ok" }
      type Calls is text with { func Associated(Value Display) -> text { return "ok" } }
      func OrdinaryEntry(Value Erased) -> text { return Ordinary(Value) }
      func AssociatedEntry(Value Erased, Owner Calls) -> text { return Owner.Associated(Value) }
      func Returning(Value Erased) -> Display { return Value }
    `)
    const ordinary = AST.streamAllContents(f.fn('OrdinaryEntry')).find(AST.isFunctionCallExpression)
    const associated = AST.streamAllContents(f.fn('AssociatedEntry')).find(AST.isMethodCallExpression)
    const parameter = AST.parametersOf(f.fn('Defaulted'))[0]!
    const returned = AST.returnStatementsOf(f.fn('Returning'))[0]!
    Expect.Is(ordinary, AST.isFunctionCallExpression)
    Expect.Is(associated, AST.isMethodCallExpression)
    const values = [
      AST.argumentsOf(ordinary)[0]!.value,
      AST.argumentsOf(associated)[0]!.value,
      parameter.defaultValue!,
      returned.value,
    ]
    f.withEffects(() => {
      NodeValidation.validate(
        [ordinary, associated, parameter, returned],
        f.file,
        f.ctx,
        NodeValidation.compile([capabilityTransportValidationChecks]),
      )
    })
    Expect(Diagnostics.errorMessages(f.collected.diagnostics)).toEqual(
      values.map(() => messages.alternatives('Display')),
    )
    Expect(f.collected.diagnostics.map(diagnostic => [diagnostic.nodeType, diagnostic.range]))
      .toEqual(values.map(value => [value.$type, value.$cstNode?.range]))
  })
})

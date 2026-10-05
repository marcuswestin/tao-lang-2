import { ASTUtils, NumericUnits, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import type { NumericUnitReading } from '../../../../../language/ast-utils/ast-utils-src/numeric-unit-readings'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

let activeBindings: ReadonlyMap<AST.TypeDeclaration, string> | undefined

/** withQuantityFactoryBindings scopes canonical owner factories to one synchronous emission pass. */
export function withQuantityFactoryBindings<ResultT>(
  bindings: ReadonlyMap<AST.TypeDeclaration, string>,
  emit: () => ResultT,
): ResultT {
  Assert(activeBindings === undefined, 'quantity factory bindings are not nested')
  activeBindings = bindings
  try {
    return emit()
  } finally {
    activeBindings = undefined
  }
}

/** quantityFactoryBinding reads the singleton factory supplied by the owning module plan. */
export function quantityFactoryBinding(owner: AST.TypeDeclaration): string {
  Assert.defined(activeBindings, 'quantity factory bindings are scoped to an emission pass')
  const binding = activeBindings.get(owner)
  Assert.defined(binding, 'a quantity owner has a planned factory binding', { owner: owner.name })
  return binding
}

/** NumericUnitConstruction constructs through the declaration's checked, singleton factory. */
export function NumericUnitConstruction(expression: AST.NumericUnitConstruction): Compiled {
  const resolved = NumericUnits.resolveSuffix(expression)
  Assert.defined(resolved, 'validated numeric construction resolves its owning unit table')
  const binding = quantityFactoryBinding(resolved.plan.owner)
  return gen`${binding}.fromUnit(${Compile.Expression(expression.input)}.jsValue, ${gen.jsLiteral(resolved.unit.name)})`
}

/** compileNumericUnitReading selects a view through the receiver's concrete checked factory. */
export function compileNumericUnitReading(reading: NumericUnitReading, receiver: Compiled): Compiled {
  const binding = quantityFactoryBinding(reading.concreteFactoryOwner)
  return gen`${binding}.inUnit(${receiver}, ${gen.jsLiteral(reading.unit.name)})`
}

/** checkedNumericValue checks unowned numeric backing once while retaining its runtime wrapper. */
export function checkedNumericValue(value: Compiled, target: ASTUtils.TaoType): Compiled {
  if (target.kind !== 'primitive' || target.primitive !== 'numeric' || Type.quantityOwner(target)) {
    return value
  }
  const domain = target.nominal && AST.isTypeDeclaration(target.nominal) ? target.nominal.name : 'numeric'
  return gen`(() => { const result = ${value}; TR.checkedNumericBacking(result.jsValue, ${
    gen.jsLiteral(domain)
  }); return result })()`
}

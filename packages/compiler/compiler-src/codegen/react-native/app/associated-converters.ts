import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { associatedWitnessBinding } from './AssociatedMethodsCompiler'
import { compileRuntimeType } from './runtime-type-compiler'

/** One converter callback receives the authored source once and returns its implicit target. */
export function compileAssociatedConverterDeclaration(declaration: AST.AssociatedConverterDeclaration): Compiled {
  const descriptor = Type.associatedConverterDescriptor(declaration)
  Assert.defined(descriptor, 'a converter has its real attached owner and declared domains')
  const source = AST.associatedConverterSourceOwner(declaration)
  return gen`TR.Function((_TaoConverterReceiver: ${compileRuntimeType(descriptor.receiver)}): ${
    compileRuntimeType(descriptor.result)
  } => {
    return TR.BlockScope(_Scope, _Scope => {
      ${AST.isTypeDeclaration(source) ? gen`${gen.scopeName(source)} = _TaoConverterReceiver` : gen.noop()}
      ${Compile.FunctionBlockBody(declaration.block)}
    })
  })`
}

/** Selection retains the actual converter declaration index; no synthetic callable AST is needed. */
export function compileAssociatedConversion(expression: AST.ConversionExpression): Compiled {
  const resolution = Type.associatedConversion(expression)
  Assert(resolution.problem === undefined, 'a validated explicit conversion has one applicable converter')
  Assert.defined(resolution.descriptor, 'a validated conversion retains its selected declaration')
  const descriptor = resolution.descriptor
  const index = Type.ownAssociatedConverters(descriptor.owner).indexOf(descriptor.declaration)
  Assert(index >= 0, 'the selected converter belongs to its actual publication owner')
  return gen`TR.Call(${associatedWitnessBinding(descriptor.owner)}["$converters"][${index}], ${
    Compile.Expression(expression.value)
  })`
}

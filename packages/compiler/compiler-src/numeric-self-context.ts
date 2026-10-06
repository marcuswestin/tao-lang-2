import { Type } from '@ast-utils'
import { AST } from '@parser'

/** Explicit numeric Self is supplied by the selected static contract, not by a payload's subtype. */
export function hasNumericSelfContext(method: AST.AssociatedFunctionDeclaration): boolean {
  const numericSelf = (type: ReturnType<typeof Type.ofFunctionReturn>) =>
    type.kind === 'primitive' && type.primitive === 'numeric' && type.selfOwner !== undefined
  return numericSelf(Type.ofFunctionReturn(method))
    || AST.parametersOf(method).some(parameter => numericSelf(Type.ofParameter(parameter)))
}

/** A foreign head receives context only inside the associated implementation that declares Self. */
export function nativeNumericSelfContext(bridge: AST.FromExpression): boolean {
  const method = AST.findOwningAssociatedFunction(bridge)
  return method !== undefined && hasNumericSelfContext(method)
}

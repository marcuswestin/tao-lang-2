import { injectionArgumentName } from './injections'
import {
  type ItemPropertyBindingDiagnostic as ItemPropertyBindingDiagnosticData,
  type ItemPropertyBindingPair as ItemPropertyBindingPairData,
  type ItemPropertyBindingResult as ItemPropertyBindingResultData,
  type RenderInvocationPair as RenderInvocationPairData,
  type ResolvedRenderInvocation as ResolvedRenderInvocationData,
  resolveItemPropertyBindings,
  resolveRenderInvocation,
} from './invocations'
import { referencedNames } from './references'
import { getDocument, isNode, streamAllContents } from './traversal'

/** ASTUtils exposes shared semantic helpers for Tao AST consumers. */
const ASTUtils = {
  getDocument,
  injectionArgumentName,
  isNode,
  referencedNames,
  resolveItemPropertyBindings,
  resolveRenderInvocation,
  streamAllContents,
}

namespace ASTUtils {
  /** RenderInvocationPair declares one resolved render argument-to-parameter pairing. */
  export type RenderInvocationPair = RenderInvocationPairData

  /** ItemPropertyBindingPair declares one item constructor value-to-field pairing. */
  export type ItemPropertyBindingPair = ItemPropertyBindingPairData

  /** ItemPropertyBindingDiagnostic declares one item constructor binding problem. */
  export type ItemPropertyBindingDiagnostic = ItemPropertyBindingDiagnosticData

  /** ItemPropertyBindingResult declares item constructor binding output. */
  export type ItemPropertyBindingResult = ItemPropertyBindingResultData

  /** ResolvedRenderInvocation declares the semantic shape of a render invocation. */
  export type ResolvedRenderInvocation = ResolvedRenderInvocationData
}

export { Packages } from './Packages'
export { Type } from './Type'
export default ASTUtils

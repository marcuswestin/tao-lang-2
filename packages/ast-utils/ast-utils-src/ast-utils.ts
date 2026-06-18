import { injectionArgumentName } from './injections'
import {
  type ActionInvocationPair as ActionInvocationPairData,
  type InvocationArity as InvocationArityData,
  invocationArity,
  type ItemPropertyBindingDiagnostic as ItemPropertyBindingDiagnosticData,
  type ItemPropertyBindingPair as ItemPropertyBindingPairData,
  type ItemPropertyBindingResult as ItemPropertyBindingResultData,
  type RenderInvocationPair as RenderInvocationPairData,
  resolveActionInvocation,
  resolveActionTarget,
  type ResolvedActionInvocation as ResolvedActionInvocationData,
  type ResolvedActionTarget as ResolvedActionTargetData,
  type ResolvedRenderInvocation as ResolvedRenderInvocationData,
  resolveItemPropertyBindings,
  resolveRenderInvocation,
} from './invocations'
import { type LayoutTermValue as LayoutTermValueData, LayoutUtils } from './layouts'
import { referencedNames } from './references'
import { getDocument, isNode, streamAllContents } from './traversal'

/** ASTUtils exposes shared semantic helpers for Tao AST consumers. */
const ASTUtils = {
  getDocument,
  injectionArgumentName,
  invocationArity,
  isNode,
  Layout: LayoutUtils,
  referencedNames,
  resolveActionInvocation,
  resolveActionTarget,
  resolveItemPropertyBindings,
  resolveRenderInvocation,
  streamAllContents,
}

namespace ASTUtils {
  /** ActionInvocationPair declares one resolved action argument-to-parameter pairing. */
  export type ActionInvocationPair = ActionInvocationPairData

  /** InvocationArity declares the lists and matched-pair count used for arity diagnostics. */
  export type InvocationArity = InvocationArityData

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

  /** ResolvedActionInvocation declares the semantic shape of an action invocation. */
  export type ResolvedActionInvocation = ResolvedActionInvocationData

  /** ResolvedActionTarget declares how an expression resolves as an action target. */
  export type ResolvedActionTarget = ResolvedActionTargetData

  /** Layout declares types produced by parsed layout-clause semantic helpers. */
  export namespace Layout {
    /** TermValue declares compact runtime values from parsed layout terms. */
    export type TermValue = LayoutTermValueData
  }
}

export { Packages } from './Packages'
export { Type } from './Type'
export default ASTUtils

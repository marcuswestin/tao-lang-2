import { injectionArgumentName } from './injections'
import {
  type ActionInvocationPair as ActionInvocationPairData,
  type InvocationArity as InvocationArityData,
  invocationArity,
  type RenderInvocationPair as RenderInvocationPairData,
  resolveActionInvocation,
  resolveActionTarget,
  type ResolvedActionInvocation as ResolvedActionInvocationData,
  type ResolvedActionTarget as ResolvedActionTargetData,
  type ResolvedRenderInvocation as ResolvedRenderInvocationData,
  resolveRenderInvocation,
} from './invocations'
import { Packages } from './Packages'
import { referencedNames } from './references'
import { getDocument, isNode, streamAllContents } from './traversal'

/** ASTUtils exposes shared semantic helpers for Tao AST consumers. */
const ASTUtils = {
  getDocument,
  injectionArgumentName,
  invocationArity,
  isNode,
  referencedNames,
  resolveActionInvocation,
  resolveActionTarget,
  resolveRenderInvocation,
  streamAllContents,
}

namespace ASTUtils {
  /** ActionInvocationPair declares one positional action argument-to-parameter pairing. */
  export type ActionInvocationPair = ActionInvocationPairData

  /** InvocationArity declares the lists and matched-pair count used for arity diagnostics. */
  export type InvocationArity = InvocationArityData

  /** RenderInvocationPair declares one positional render argument-to-parameter pairing. */
  export type RenderInvocationPair = RenderInvocationPairData

  /** ResolvedActionInvocation declares the semantic shape of an action invocation. */
  export type ResolvedActionInvocation = ResolvedActionInvocationData

  /** ResolvedActionTarget declares how an expression resolves as an action target. */
  export type ResolvedActionTarget = ResolvedActionTargetData

  /** ResolvedRenderInvocation declares the semantic shape of a render invocation. */
  export type ResolvedRenderInvocation = ResolvedRenderInvocationData
}

export { Packages }
export default ASTUtils

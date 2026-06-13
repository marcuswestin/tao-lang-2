import { injectionArgumentName } from './injections'
import {
  type RenderInvocationPair as RenderInvocationPairData,
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
  isNode,
  referencedNames,
  resolveRenderInvocation,
  streamAllContents,
}

namespace ASTUtils {
  /** RenderInvocationPair declares one positional render argument-to-parameter pairing. */
  export type RenderInvocationPair = RenderInvocationPairData

  /** ResolvedRenderInvocation declares the semantic shape of a render invocation. */
  export type ResolvedRenderInvocation = ResolvedRenderInvocationData
}

export { Packages }
export default ASTUtils

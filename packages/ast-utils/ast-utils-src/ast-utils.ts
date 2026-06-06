import { injectionArgumentName } from './injections'
import {
  type RenderInvocation as RenderInvocationData,
  type RenderInvocationPair as RenderInvocationPairData,
  resolveRenderInvocation,
} from './invocations'
import { getDocument, isNode, streamAllContents } from './traversal'

/** ASTUtils exposes shared semantic helpers for Tao AST consumers. */
const ASTUtils = {
  getDocument,
  injectionArgumentName,
  isNode,
  resolveRenderInvocation,
  streamAllContents,
}

namespace ASTUtils {
  /** RenderInvocationPair declares one positional render argument-to-parameter pairing. */
  export type RenderInvocationPair = RenderInvocationPairData

  /** RenderInvocation declares the semantic shape of a render invocation. */
  export type RenderInvocation = RenderInvocationData
}

export default ASTUtils

import { AST, Langium } from '@parser'
import { Assert } from '@shared'
import { Format } from './Format'
import { createNodeFormat, type FormattedNodeType } from './formatting'

/** TaoFormatter formats Tao documents by dispatching per-node Format handlers. */
export class TaoFormatter extends Langium.AbstractFormatter {
  protected format(node: AST.Node): void {
    const handler = Format[node.$type as FormattedNodeType]
    Assert.defined(handler, `a Tao format handler for AST node type '${node.$type}'`)
    // Handlers are keyed by `$type`, so the node is the handler's concrete node type.
    handler(createNodeFormat(node, this.getNodeFormatter(node)) as never)
  }
}

import { AST, Langium } from '@parser'
import { Format } from './Format'
import { createNodeFormat } from './formatting'

/** TaoFormatter formats Tao documents by dispatching per-node Format handlers. */
export class TaoFormatter extends Langium.AbstractFormatter {
  protected format(node: AST.Node): void {
    const handler = Format[node.$type as keyof typeof Format]
    if (handler) {
      // Handlers are keyed by `$type`, so the node is the handler's concrete node type.
      handler(createNodeFormat(node, this.getNodeFormatter(node)) as never)
    }
  }
}

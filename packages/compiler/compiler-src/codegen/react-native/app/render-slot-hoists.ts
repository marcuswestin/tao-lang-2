import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'

/** SlotBodyHoist carries a complete component definition and its actual source definition site. */
export type SlotBodyHoist = Readonly<{
  sourceAnchor: AST.Node
  bodyName: string
  definition: Compiled
}>

/** emitSlotBodyHoists emits one file's caller-compiled component definitions in supplied order. */
export function emitSlotBodyHoists(rows: readonly SlotBodyHoist[]): Compiled {
  const anchors = new Set<AST.Node>()
  const names = new Set<string>()
  for (const row of rows) {
    Assert(!anchors.has(row.sourceAnchor), 'slot body hoists have distinct source anchors')
    Assert(!names.has(row.bodyName), 'slot body hoists have distinct component names', { bodyName: row.bodyName })
    anchors.add(row.sourceAnchor)
    names.add(row.bodyName)
  }
  return gen.list(rows, row => row.definition)
}

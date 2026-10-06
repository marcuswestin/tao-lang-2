import { AST } from '@parser'
import { Assert } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'

/** SlotBodyHoist carries a complete component definition and its actual source definition site. */
export type SlotBodyHoist = Readonly<{
  sourceAnchor: AST.Node
  bodyName: string
  definition: Compiled
}>

/** SlotBodyPlan is one file's source-anchored component allocation, carried through recursive compilation. */
type SlotBodyPlan = {
  readonly rows: SlotBodyHoist[]
  readonly names: Map<AST.Node, string>
}

type SlotCodegenOptions = CodegenOptions & { slotBodyPlan?: SlotBodyPlan }

/** createSlotBodyOptions starts a fresh body plan without mutating the caller's compilation options. */
export function createSlotBodyOptions(options: CodegenOptions): SlotCodegenOptions {
  return { ...options, slotBodyPlan: { rows: [], names: new Map() } }
}

/** slotBodyRows returns the completed plan after the file's source content has been compiled. */
export function slotBodyRows(options: CodegenOptions): readonly SlotBodyHoist[] {
  return (options as SlotCodegenOptions).slotBodyPlan?.rows ?? []
}

/** registerSlotBody reserves the name before compiling nested bodies and emits each actual source site once. */
export function registerSlotBody(
  sourceAnchor: AST.Node,
  options: CodegenOptions,
  definition: (bodyName: string) => Compiled,
): string {
  const plan = (options as SlotCodegenOptions).slotBodyPlan
  Assert.defined(plan, 'slot bodies compile inside a file-local body plan')
  const existing = plan.names.get(sourceAnchor)
  if (existing) {
    return existing
  }
  const bodyName = `_TaoSlotBody${plan.names.size}`
  plan.names.set(sourceAnchor, bodyName)
  plan.rows.push({ sourceAnchor, bodyName, definition: definition(bodyName) })
  return bodyName
}

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

import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** NodeValidationCheck validates one AST node during a file traversal. */
export type NodeValidationCheck<NodeT extends AST.Node> = (
  node: NodeT,
  ctx: ValidationContext,
  file: AST.TaoFile,
) => void

/** NodeValidationChecks groups validation handlers by generated AST type. */
export type NodeValidationChecks = {
  [TypeName in keyof AST.TaoLangAstType]?: AST.TaoLangAstType[TypeName] extends AST.Node ?
      | NodeValidationCheck<AST.TaoLangAstType[TypeName]>
      | readonly NodeValidationCheck<AST.TaoLangAstType[TypeName]>[]
    : never
}

type AnyNodeValidationCheck = NodeValidationCheck<AST.Node>
type CompiledNodeValidationChecks = ReadonlyMap<string, readonly AnyNodeValidationCheck[]>

/** NodeValidationReuse replays only explicitly admitted handler invocations at their original slots. */
export interface NodeValidationReuse {
  readonly checks: ReadonlySet<AnyNodeValidationCheck>
  run(node: AST.Node, check: AnyNodeValidationCheck, slot: number, ctx: ValidationContext, file: AST.TaoFile): void
}

/** NodeValidation compiles and runs validation handlers without repeated tree traversals. */
export const NodeValidation = {
  compile,
  validate,
}

function compile(groups: readonly NodeValidationChecks[]): CompiledNodeValidationChecks {
  const checksByType = new Map<string, AnyNodeValidationCheck[]>()
  for (const group of groups) {
    for (const [registeredType, value] of Object.entries(group)) {
      const checks = (Array.isArray(value) ? value : [value]) as AnyNodeValidationCheck[]
      for (const concreteType of AST.reflection.getAllSubTypes(registeredType)) {
        const registeredChecks = checksByType.get(concreteType) ?? []
        registeredChecks.push(...checks)
        checksByType.set(concreteType, registeredChecks)
      }
    }
  }
  return checksByType
}

function validate(
  nodes: readonly AST.Node[],
  file: AST.TaoFile,
  ctx: ValidationContext,
  checksByType: CompiledNodeValidationChecks,
  recordProfile?: (handler: string, durationMs: number) => void,
  reuse?: NodeValidationReuse,
): void {
  if (recordProfile === undefined) {
    for (const node of nodes) {
      const checks = checksByType.get(node.$type) ?? []
      for (let slot = 0; slot < checks.length; slot++) {
        const check = checks[slot]!
        if (reuse?.checks.has(check)) {
          reuse.run(node, check, slot, ctx, file)
        } else {
          check(node, ctx, file)
        }
      }
    }
    return
  }

  for (const node of nodes) {
    const checks = checksByType.get(node.$type) ?? []
    for (const [index, check] of checks.entries()) {
      const startedAt = performance.now()
      try {
        if (reuse?.checks.has(check)) {
          reuse.run(node, check, index, ctx, file)
        } else {
          check(node, ctx, file)
        }
      } finally {
        recordProfile(check.name || `${node.$type}[${index}]`, performance.now() - startedAt)
      }
    }
  }
}

import { AST } from '@parser'
import type { ValidationContext } from '../validation'

/** primitiveSlots is `AST.primitiveSlots` computed once per validation run for each primitive. */
export function primitiveSlots(ctx: ValidationContext, name: AST.PrimitiveType): readonly AST.TypeProperty[] {
  return ctx.memo(`workspace-index.primitiveSlots.${name}`, () => AST.primitiveSlots(ctx.workspaceFiles, name))
}

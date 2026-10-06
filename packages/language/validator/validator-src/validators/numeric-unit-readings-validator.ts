import { ASTUtils, NumericUnits, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import { NumericUnitReadingsValidationMessages as messages } from './NumericUnitReadingsValidationMessages'

/** numericUnitReadingsValidationChecks checks real generated readings and inherited table boundaries. */
export const numericUnitReadingsValidationChecks = {
  [AST.MethodCallExpression.$type]: (invocation, ctx) => {
    const resolution = ASTUtils.resolveNumericUnitReading(invocation)
    if (resolution.kind !== 'invalid-unit-reading') {
      return
    }
    ctx.error(
      invocation,
      resolution.problem === 'arguments'
        ? messages.arguments(resolution.reading.unit.name)
        : messages.collision(resolution.reading.unit.name),
    )
  },
  [AST.TypeDeclaration.$type]: (owner, ctx) => {
    for (const { unit, method } of ASTUtils.numericUnitReadingCollisions(owner)) {
      // Diagnose the authored implementation once, rather than each inheriting declaration.
      if (
        owner.type && AST.isDerivedTypeExpression(owner.type)
        && [...owner.type.slots.methods, ...owner.type.slots.views].some(declaration => declaration === method)
      ) {
        ctx.error(method, messages.collision(unit.name))
      }
    }
    if (!owner.type || !AST.isDerivedTypeExpression(owner.type) || owner.type.slots.unitBlocks.length === 0) {
      return
    }
    const parent = AST.isNamedTypeReference(owner.type.base) ? Type.definitionOfReference(owner.type.base) : undefined
    if (AST.isTypeDeclaration(parent) && NumericUnits.unitOwner(parent)) {
      for (const block of owner.type.slots.unitBlocks) {
        ctx.error(block, messages.inheritedTable)
      }
    }
  },
} satisfies NodeValidationChecks

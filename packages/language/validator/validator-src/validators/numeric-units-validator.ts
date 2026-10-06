import { NumericUnits, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { NumericUnitsValidationMessages as messages } from './NumericUnitsValidationMessages'

/** numericUnitsValidationChecks validates declaration-owned units and explicit scalar construction. */
export const numericUnitsValidationChecks = {
  [AST.NumericUnitBlock.$type]: validateBlock,
  [AST.NumericUnitConstruction.$type]: (construction, ctx) => {
    if (!AST.numericUnitConstructionInputIsAllowed(construction)) {
      ctx.error(construction, messages.constructionShape)
    }
    const input = Type.ofExpression(construction.input)
    if (input.kind !== 'unresolved' && (input.kind !== 'primitive' || input.primitive !== 'number')) {
      ctx.error(construction.input, messages.constructionInput)
    }
    if (construction.unit.ref && !NumericUnits.resolveSuffix(construction)) {
      ctx.error(construction, messages.invalidTable)
    }
  },
} satisfies NodeValidationChecks

function validateBlock(block: AST.NumericUnitBlock, ctx: ValidationContext): void {
  const slots = block.$container
  const derived = slots.$container
  const owner = derived?.$container
  const backing = AST.isDerivedTypeExpression(derived) ? Type.ofReference(derived.base) : undefined
  if (
    !AST.isItemTypeExpression(slots) || !AST.isDerivedTypeExpression(derived)
    || !AST.isTypeDeclaration(owner) || owner.type !== derived || derived.slots !== slots
    || backing?.kind !== 'primitive' || backing.primitive !== 'numeric'
  ) {
    ctx.error(block, messages.blockPlacement)
  } else if (slots.unitBlocks.length !== 1) {
    ctx.error(block, messages.multipleBlocks)
  }
  if (block.units.length === 0) {
    ctx.error(block, messages.emptyBlock)
  }
  const seen = new Set<string>()
  for (const unit of block.units) {
    if (seen.has(unit.name)) {
      ctx.error(unit, messages.duplicateUnit(unit.name))
    }
    seen.add(unit.name)
    if (unit.sign || !Number.isFinite(unit.scale) || unit.scale <= 0) {
      ctx.error(unit, messages.scale(unit.name))
    }
  }
  if (block.units.filter(unit => unit.default).length !== 1) {
    ctx.error(block, messages.defaultUnit)
  }
}

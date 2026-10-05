import { AST } from '@parser'
import { Type } from './Type'

/** The checked, directly owned unit table used by all quantity emitters. */
export type NumericUnitsDeclarationPlan = Readonly<{
  owner: AST.TypeDeclaration
  units: readonly Readonly<{ name: string; scale: number }>[]
  defaultUnit: string
}>

/** A suffix selects a unit from its canonical declaration's table. */
export type NumericUnitsSuffixResolution = Readonly<{
  plan: NumericUnitsDeclarationPlan
  unit: NumericUnitsDeclarationPlan['units'][number]
}>

/** NumericUnits resolves declaration-owned construction without a separate type registry. */
export class NumericUnits {
  private constructor() {}

  static declarationPlan(owner: AST.TypeDeclaration): NumericUnitsDeclarationPlan | undefined {
    const declaration = owner.type
    if (!declaration || !AST.isDerivedTypeExpression(declaration)) {
      return undefined
    }
    const backing = Type.ofReference(declaration.base)
    const blocks = declaration.slots.unitBlocks
    if (backing.kind !== 'primitive' || backing.primitive !== 'numeric' || blocks.length !== 1) {
      return undefined
    }
    const rows = blocks[0]!.units
    if (rows.length === 0 || rows.filter(unit => unit.default).length !== 1) {
      return undefined
    }
    const names = new Set<string>()
    for (const row of rows) {
      if (!row.name || names.has(row.name) || row.sign || !Number.isFinite(row.scale) || row.scale <= 0) {
        return undefined
      }
      names.add(row.name)
    }
    return {
      owner,
      units: rows.map(row => ({ name: row.name, scale: row.scale })),
      defaultUnit: rows.find(row => row.default)!.name,
    }
  }

  static resolveSuffix(expression: AST.Expression): NumericUnitsSuffixResolution | undefined {
    if (!AST.isNumericUnitConstruction(expression)) {
      return undefined
    }
    const unit = expression.unit.ref
    if (!unit) {
      return undefined
    }
    const block = unit.$container
    const slots = block.$container
    const declaration = slots.$container
    const owner = declaration.$container
    if (
      !AST.isNumericUnitBlock(block) || !AST.isItemTypeExpression(slots)
      || !AST.isDerivedTypeExpression(declaration) || !AST.isTypeDeclaration(owner)
      || declaration.slots !== slots
    ) {
      return undefined
    }
    const plan = NumericUnits.declarationPlan(owner)
    const row = plan?.units.find(candidate => candidate.name === unit.name)
    return plan && row ? { plan, unit: row } : undefined
  }
}

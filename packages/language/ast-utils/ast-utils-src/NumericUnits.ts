import { AST } from '@parser'
import { Type } from './Type'

/** A checked table plan retains its concrete declaration owner, including inherited unit tables. */
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

/** NumericUnits resolves declaration-owned construction and inherited table ownership. */
export class NumericUnits {
  private constructor() {}

  /** Returns a concrete owner's checked unit plan, backed by its first linked table owner. */
  static declarationPlan(owner: AST.TypeDeclaration): NumericUnitsDeclarationPlan | undefined {
    const tableOwner = NumericUnits.unitOwner(owner)
    const inherited = tableOwner ? NumericUnits.directDeclarationPlan(tableOwner) : undefined
    return inherited ? { ...inherited, owner } : undefined
  }

  private static directDeclarationPlan(owner: AST.TypeDeclaration): NumericUnitsDeclarationPlan | undefined {
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

  /** Finds the declaration that owns a numeric unit table through linked parents and aliases. */
  static unitOwner(owner: AST.TypeDeclaration): AST.TypeDeclaration | undefined {
    const visited = new Set<AST.TypeDeclaration>()
    let current: AST.TypeDeclaration | undefined = owner
    while (current && !visited.has(current)) {
      visited.add(current)
      const alias: AST.Declaration | undefined = current.aliasTarget?.member.ref
      if (AST.isTypeDeclaration(alias)) {
        current = alias
        continue
      }
      const type: AST.TypeExpression | undefined = current.type
      if (!type) {
        return undefined
      }
      if (AST.isDerivedTypeExpression(type)) {
        if (type.slots.unitBlocks.length > 0) {
          return NumericUnits.directDeclarationPlan(current) ? current : undefined
        }
        const parent: AST.TypeDefinition | undefined = AST.isNamedTypeReference(type.base)
          ? Type.definitionOfReference(type.base)
          : undefined
        if (!AST.isTypeDeclaration(parent)) {
          return undefined
        }
        current = parent
        continue
      }
      const parent: AST.TypeDefinition | undefined = AST.isNamedTypeReference(type)
        ? Type.definitionOfReference(type)
        : undefined
      if (!AST.isTypeDeclaration(parent)) {
        return undefined
      }
      current = parent
    }
    return undefined
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

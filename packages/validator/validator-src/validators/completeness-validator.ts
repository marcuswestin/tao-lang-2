import { Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

export const completenessValidationMessages = {
  incomplete: (name: string, slots: readonly string[]) =>
    `Declaration '${name}' is incomplete; fill supplied slot${slots.length === 1 ? '' : 's'} ${
      slots.map(slot => `'${slot}'`).join(', ')
    } before using it as a value.`,
} as const

/** completenessValidationChecks applies one supplied-slot rule at every declaration-as-value reference. */
export const completenessValidationChecks = {
  [AST.ConfigurationReference.$type]: (reference, ctx) => {
    reportIncomplete(reference.target.ref, reference, ctx)
  },
  [AST.ValueReference.$type]: (reference, ctx) => {
    if (!AST.isRefinementExpression(reference)) {
      const target = reference.target.ref
      reportIncomplete(AST.isNamedDeclaration(target) ? target : undefined, reference, ctx)
    }
  },
} satisfies NodeValidationChecks

function reportIncomplete(
  declaration: AST.NamedDeclaration | undefined,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  const slots = incompleteSuppliedSlots(declaration)
  if (declaration && slots.length > 0) {
    ctx.error(completenessValidationMessages.incomplete(Type.declarationName(declaration), slots), node)
  }
}

function incompleteSuppliedSlots(declaration: AST.NamedDeclaration | undefined): string[] {
  if (AST.isVisualDeclaration(declaration)) {
    return AST.parametersOf(declaration)
      .filter(parameter => parameter.defaultValue === undefined)
      .map(Type.parameterName)
  }
  if (declaration && AST.isConfigurableDeclaration(declaration)) {
    return AST.configurationPropertiesOf(declaration).map(property => property.name)
  }
  if (AST.isTypeDeclaration(declaration)) {
    const type = Type.ofDefinition(declaration)
    return type.kind === 'item' && type.item
      ? type.item.properties.filter(Type.propertyRequiresValue).map(property => property.name)
      : []
  }
  return []
}

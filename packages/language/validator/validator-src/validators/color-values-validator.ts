import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** colorValueValidationMessages declares the diagnostics for `color` parameters and design color names. */
export const colorValueValidationMessages = {
  colorTypePosition: "Type 'color' is only a view parameter's type.",
  shadeOnValue: (name: string, shade: number) => `Only a design color has a numeric shade: '${name}.${shade}'.`,
  unknownShade: (color: string, shade: number) => `Design color '${color}' has no shade '${shade}'.`,
} as const

/**
 * colorValueValidationChecks keeps `color` to the one place Decisions §13 opens it: a view parameter.
 * Where its argument or default names a design color, the value scope offers the mounted designs'
 * colors and the ordinary argument and default type checks decide whether a `color` was expected, so
 * a text literal, a number, or a design color given to a `text` parameter fails the way any
 * mismatched value does.
 */
export const colorValueValidationChecks = {
  [AST.PrimitiveTypeReference.$type]: validateColorTypePosition,
  [AST.MemberAccessExpression.$type]: validateShade,
} satisfies NodeValidationChecks

/** A `color` has no state, alias, field, or action form yet; only a view parameter may declare one. */
function validateColorTypePosition(type: AST.PrimitiveTypeReference, ctx: ValidationContext): void {
  if (type.primitive !== 'color') {
    return
  }
  const declaration = type.$container
  const parameter = AST.isParameterTypeDeclaration(declaration) ? declaration.$container : undefined
  const owner = AST.isParameterDeclaration(parameter) ? parameter.$container.$container : undefined
  if (!AST.isViewDeclaration(owner)) {
    ctx.error(type, colorValueValidationMessages.colorTypePosition)
  }
}

function validateShade(access: AST.MemberAccessExpression, ctx: ValidationContext): void {
  const shade = access.shade
  const target = access.target.ref
  if (shade === undefined || target === undefined) {
    return
  }
  if (!AST.isDesignColorEntry(target)) {
    ctx.error(access, colorValueValidationMessages.shadeOnValue(access.target.$refText, shade))
  } else if (AST.designColorShade(target, shade) === undefined) {
    ctx.error(access, colorValueValidationMessages.unknownShade(target.name, shade))
  }
}

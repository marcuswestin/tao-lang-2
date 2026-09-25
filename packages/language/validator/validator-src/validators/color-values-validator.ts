import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** colorValueValidationMessages declares the diagnostics for `color` parameters and design color names. */
export const colorValueValidationMessages = {
  colorTypePosition: "Type 'color' is only a view parameter's type.",
  missingDesignColor: (design: string, path: string, view: string | undefined) =>
    view === undefined
      ? `Design '${design}' has no color '${path}'; every design this project's apps mount must declare it.`
      : `Design '${design}' has no color '${path}'; every design that can mount '${view}' must declare it.`,
  shadeOnValue: (name: string, shade: number) => `Only a design color has a numeric shade: '${name}.${shade}'.`,
  unknownShade: (color: string, shade: number) => `Design color '${color}' has no shade '${shade}'.`,
} as const

/**
 * colorValueValidationChecks keeps `color` to the one place Decisions §13 opens it: a view parameter.
 * Where its argument or default names a design color, the value scope offers the mounted designs'
 * colors and the ordinary argument and default type checks decide whether a `color` was expected, so
 * a text literal, a number, or a design color given to a `text` parameter fails the way any
 * mismatched value does. The name must also be declared by every design that can mount the view, so
 * no app meets a color its own design lacks at render.
 */
export const colorValueValidationChecks = {
  [AST.PrimitiveTypeReference.$type]: validateColorTypePosition,
  [AST.MemberAccessExpression.$type]: validateShade,
  [AST.ValueReference.$type]: validateMountedDesignColor,
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

/**
 * The scope links a shade to a color that declares it wherever one does, so a linked color lacking
 * the shade means no mounted design declares it; one that has it is then held to every design.
 */
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
  } else {
    validateMountedDesignColor(access, ctx)
  }
}

/**
 * A design color name links when any mounted design declares it, but whichever app mounts the view
 * resolves it against that app's own design at render, so each mounted design must declare the name,
 * and the shade when one is written. Every design lacking it is named, in name order.
 */
function validateMountedDesignColor(
  node: AST.ValueReference | AST.MemberAccessExpression,
  ctx: ValidationContext,
): void {
  const color = node.target.ref
  if (!AST.isDesignColor(color) || !AST.isDesignColorPosition(node)) {
    return
  }
  const shade = AST.isMemberAccessExpression(node) ? node.shade : undefined
  const view = AST.findOwningView(node)?.name
  for (const design of mountedDesigns(ctx)) {
    if (AST.designColorNamed(design, color.name, shade) === undefined) {
      ctx.error(
        node,
        colorValueValidationMessages.missingDesignColor(design.name, AST.designColorPath(color, shade), view),
      )
    }
  }
}

/** Which designs can mount a view is a property of the project, so it is read once per run. */
function mountedDesigns(ctx: ValidationContext): readonly AST.DesignDeclaration[] {
  return ctx.memo(
    'color-values-validator.mountedDesigns',
    () => AST.mountedDesigns(ctx.projectFiles ?? ctx.workspaceFiles),
  )
}

import * as AST from './parserASTExport'

/**
 * A `color` value starts as a design color name, written where a `color` is expected (Decisions §13):
 * an argument (`Tint: accent`) or a parameter default (`default inkMuted`). Those two positions are
 * the only ones whose value scope offers the mounted designs' colors, so a design name never becomes
 * a value by accident anywhere else — not in state, an alias, or an interpolation.
 */
export function isDesignColorPosition(expression: AST.Node): boolean {
  const owner = expression.$container
  return (AST.isArgument(owner) && owner.value === expression)
    || (AST.isParameterDeclaration(owner) && owner.defaultValue === expression)
}

/**
 * selectedDesigns collects the designs the given files' apps mount through their `Design` property.
 * A view is resolved against whichever of these mounts it, so every one of them is a candidate.
 */
export function selectedDesigns(files: readonly AST.TaoFile[]): AST.DesignDeclaration[] {
  const designs = new Set<AST.DesignDeclaration>()
  for (const file of files) {
    for (const property of AST.streamAllContents(file).filter(AST.isAppProperty)) {
      if (property.name !== 'Design' || !property.value || !AST.isValueReference(property.value)) {
        continue
      }
      const design = property.value.target.ref
      if (AST.isDesignDeclaration(design)) {
        designs.add(design)
      }
    }
  }
  return [...designs]
}

/** designColorsOf lists the colors one design declares, typed-block entries and legacy flat tokens alike. */
export function designColorsOf(design: AST.DesignDeclaration): AST.DesignColor[] {
  return design.block.members.flatMap((member): AST.DesignColor[] =>
    AST.isDesignToken(member) ? [member] : AST.isDesignColorsBlock(member) ? member.entries : []
  )
}

/** designColorShade finds the family member a numeric shade names, as in `schemeAccent.20`. */
export function designColorShade(
  color: AST.DesignColorEntry,
  shade: number,
): AST.DesignColorFamilyMember | undefined {
  return color.family?.members.find(member => member.name === shade)
}

/**
 * designColorPath is the name the runtime resolves against the mounted design. It matches the keys
 * `DesignCompiler` gives a design's colors, so a family shade reads `schemeAccent.20` in both.
 */
export function designColorPath(color: AST.DesignColor, shade?: number): string {
  return shade === undefined ? color.name : `${color.name}.${shade}`
}

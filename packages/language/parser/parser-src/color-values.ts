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
 * selectedDesigns collects the designs the given files' apps mount through a `Design` property
 * written in an app block. It does not see a design a refinement sets (`app DemoDark = Demo with
 * { Design Dark }`); `mountedDesigns` does, and is what a design color name is checked against.
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

/**
 * mountedDesigns collects every design an app in the given files can mount: the `Design` its block
 * sets, the one a refinement's patch sets (`app DemoDark = Demo with { Design Dark }`), and, where a
 * refinement leaves it alone, the one its base app mounts. Any of these apps may mount a given view,
 * so a design color written for that view must be declared in every one (Decisions §13). The list is
 * sorted by name, so which design a diagnostic names never depends on declaration order.
 */
export function mountedDesigns(files: readonly AST.TaoFile[]): AST.DesignDeclaration[] {
  const designs = new Set<AST.DesignDeclaration>()
  for (const app of files.flatMap(file => file.statements.filter(AST.isAppDeclaration))) {
    const design = appDesign(app, new Set())
    if (design) {
      designs.add(design)
    }
  }
  return [...designs].toSorted((left, right) => left.name.localeCompare(right.name))
}

function appDesign(app: AST.AppDeclaration, seen: Set<AST.AppDeclaration>): AST.DesignDeclaration | undefined {
  if (seen.has(app)) {
    return undefined
  }
  seen.add(app)
  if (app.block) {
    return designNamedBy(app.block.statements.filter(AST.isAppProperty).findLast(isDesignProperty)?.value)
  }
  const value = app.value
  if (AST.isRefinementExpression(value)) {
    const patched = value.patchBlock.entries.findLast(isDesignProperty)
    if (patched) {
      return designNamedBy(patched.value)
    }
  }
  const base = AST.isRefinementExpression(value) || AST.isValueReference(value) ? value.target.ref : undefined
  return AST.isAppDeclaration(base) ? appDesign(base, seen) : undefined
}

function isDesignProperty(property: AST.AppProperty | AST.ConfigurationEntry): boolean {
  return property.name === 'Design' && property.value !== undefined
}

/** designNamedBy reads the design a `Design` value names; `Design none` names none. */
function designNamedBy(
  value: AST.Expression | AST.ConfigurationValue | undefined,
): AST.DesignDeclaration | undefined {
  const target = AST.isValueReference(value) || AST.isConfigurationReference(value) ? value.target.ref : undefined
  return AST.isDesignDeclaration(target) ? target : undefined
}

/**
 * designColorNamed finds the color a design declares under `name`, and with `shade` given, only one
 * whose family declares that shade.
 */
export function designColorNamed(
  design: AST.DesignDeclaration,
  name: string,
  shade?: number,
): AST.DesignColor | undefined {
  return designColorsOf(design).find(color =>
    color.name === name
    && (shade === undefined || (AST.isDesignColorEntry(color) && designColorShade(color, shade) !== undefined))
  )
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

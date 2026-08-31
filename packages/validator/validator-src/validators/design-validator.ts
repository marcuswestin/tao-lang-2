import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { designValidationCodes } from '../diagnostic-codes'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { LayoutValidator } from './layout-validator'

const visualHeads = new Set(['bg', 'border', 'fg', 'line', 'radius', 'size', 'weight'])
const colorHeads = new Set(['bg', 'border', 'fg'])
const builtInHeads = new Set([
  'aligned',
  'bg',
  'border',
  'centered',
  'claim',
  'compress',
  'content',
  'fg',
  'fill',
  'gap',
  'height',
  'hug',
  'line',
  'margin',
  'pad',
  'radius',
  'rigid',
  'size',
  'weight',
  'width',
])

const cssHexColor = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i
const taoTag = /^#[A-Za-z_][A-Za-z0-9_]*$/

/** designValidationMessages declares stable diagnostics for the minimal design model. */
const designValidationMessages = {
  bundleCycle: (design: string, path: readonly string[]) =>
    `Design '${design}' has a bundle cycle: ${path.join(' -> ')}.`,
  duplicateMember: (name: string) => `Design member '${name}' is declared more than once.`,
  exploration: (entry: string) =>
    `Inline design exploration '${entry}' must be promoted to a token, style bundle, or element default for release.`,
  malformedColor: (value: string) => `Design color '${value}' must use exactly 3, 4, 6, or 8 hexadecimal digits.`,
  malformedTag: (value: string) =>
    `Tag '${value}' must start with a letter or underscore and contain only letters, digits, or underscores.`,
  malformedVisual: (entry: string) => `Malformed design entry '${entry}'.`,
  missingMountedDesign: (entry: string) => `Design entry '${entry}' requires an app Design selection.`,
  reservedBundle: (name: string) => `Design bundle '${name}' collides with built-in clause '${name}'.`,
  unknownBundle: (design: string, name: string) => `Design '${design}' has no bundle '${name}'.`,
  unknownToken: (design: string, name: string) => `Design '${design}' has no token '${name}'.`,
  weightedRigidClaim: "Design entries 'claim' and 'rigid' cannot remain effective together.",
} as const

/** DesignValidator validates declarations and mounted-app-aware combined render specs. */
export const DesignValidator = {
  checks: {
    [AST.DesignDeclaration.$type]: validateDesignDeclaration,
    [AST.ExpectCheckboxStateStep.$type]: validateTaggedTestStep,
    [AST.ExpectScopeStep.$type]: validateTaggedTestStep,
    [AST.Render.$type]: validateRenderDesign,
    [AST.SelectStep.$type]: validateTaggedTestStep,
    [AST.TagEnterStep.$type]: validateTaggedTestStep,
    [AST.TagInputValueExpectation.$type]: validateTaggedTestStep,
    [AST.TagPressStep.$type]: validateTaggedTestStep,
    [AST.TagStatement.$type]: validateTag,
    [AST.TagSubmitStep.$type]: validateTaggedTestStep,
  } satisfies NodeValidationChecks,
  messages: designValidationMessages,
}

function validateDesignDeclaration(design: AST.DesignDeclaration, ctx: ValidationContext): void {
  const members = new Map<string, AST.DesignMember>()
  for (const member of design.members) {
    if (members.has(member.name)) {
      ctx.error(designValidationMessages.duplicateMember(member.name), member)
    } else {
      members.set(member.name, member)
    }
    if (AST.isDesignToken(member)) {
      if (!cssHexColor.test(member.value)) {
        ctx.error(designValidationMessages.malformedColor(member.value), member)
      }
    } else if (builtInHeads.has(member.name)) {
      ctx.error(designValidationMessages.reservedBundle(member.name), member)
    }
  }

  const tokens = new Set(design.members.filter(AST.isDesignToken).map(token => token.name))
  const bundles = new Map(design.members.filter(AST.isDesignBundle).map(bundle => [bundle.name, bundle]))
  for (const bundle of bundles.values()) {
    validateEntries(bundle.spec.entries, design, tokens, bundles, ctx)
  }
  validateBundleCycles(design, bundles, ctx)
  for (const bundle of bundles.values()) {
    const expanded = expandBundle(bundle, bundles, new Set())
    if (expanded) {
      validateEffectiveConflicts(expanded, ctx)
    }
  }
}

function validateRenderDesign(render: AST.Render, ctx: ValidationContext): void {
  const clause = render.layoutClause
  if (!clause) {
    return
  }
  for (const entry of clause.entries.filter(isInlineDesignExploration)) {
    ctx.warning(designValidationMessages.exploration(entryText(entry)), entry, {
      code: designValidationCodes.exploration,
    })
  }
  const designEntries = clause.entries.filter(entry => !LayoutValidator.isLayoutEntry(entry))
  if (designEntries.length === 0) {
    return
  }

  for (const entry of designEntries.filter(isVisualEntry)) {
    validateVisualEntry(entry, undefined, undefined, ctx)
  }

  const designs = selectedWorkspaceDesigns(ctx)
  if (designs.length > 1) {
    // A source file can participate in multiple mounted apps. Name resolution is deliberately
    // deferred in this case so identical private bundle names stay app-occurrence-local. The
    // mounted-design runtime checks the effective result for the actual app occurrence.
    return
  }
  const design = designs[0]
  if (!design) {
    for (const entry of designEntries.filter(requiresDesignLookup)) {
      const text = entryText(entry)
      if (!isVisualEntry(entry)) {
        // A bare word only names a bundle once a design defines it, so LayoutValidator defers it here.
        ctx.error(LayoutValidator.messages.unsupportedEntry(text), entry)
      }
      ctx.error(designValidationMessages.missingMountedDesign(text), entry)
    }
    return
  }

  const tokens = new Set(design.members.filter(AST.isDesignToken).map(token => token.name))
  const bundles = new Map(design.members.filter(AST.isDesignBundle).map(bundle => [bundle.name, bundle]))
  validateEntries(clause.entries, design, tokens, bundles, ctx, { validateLayout: false })

  const expanded = expandEntries(clause.entries, bundles, new Set())
  if (expanded) {
    validateEffectiveConflicts(expanded, ctx)
  }
}

function validateTag(tag: AST.TagStatement, ctx: ValidationContext): void {
  validateTagValue(tag.tag, tag, ctx)
}

type TaggedTestStep =
  | AST.ExpectCheckboxStateStep
  | AST.ExpectScopeStep
  | AST.SelectStep
  | AST.TagEnterStep
  | AST.TagInputValueExpectation
  | AST.TagPressStep
  | AST.TagSubmitStep

function validateTaggedTestStep(step: TaggedTestStep, ctx: ValidationContext): void {
  validateTagValue(step.tag, step, ctx)
}

function validateTagValue(value: string, node: AST.Node, ctx: ValidationContext): void {
  if (!taoTag.test(value)) {
    ctx.error(designValidationMessages.malformedTag(value), node)
  }
}

function validateEntries(
  entries: readonly AST.LayoutEntry[],
  design: AST.DesignDeclaration,
  tokens: ReadonlySet<string>,
  bundles: ReadonlyMap<string, AST.DesignBundle>,
  ctx: ValidationContext,
  options: { validateLayout?: boolean } = {},
): void {
  for (const entry of entries) {
    if (LayoutValidator.isLayoutEntry(entry)) {
      if (options.validateLayout !== false) {
        LayoutValidator.validateEntry(entry, ctx)
      }
      continue
    }
    if (isVisualEntry(entry)) {
      validateVisualEntry(entry, design, tokens, ctx)
      continue
    }
    const values = ASTUtils.layoutEntryValues(entry)
    const name = String(values[0] ?? '')
    if (values.length !== 1) {
      ctx.error(designValidationMessages.malformedVisual(entryText(entry)), entry)
    } else if (!bundles.has(name)) {
      ctx.error(designValidationMessages.unknownBundle(design.name, name), entry)
    }
  }
}

function validateVisualEntry(
  entry: AST.LayoutEntry,
  design: AST.DesignDeclaration | undefined,
  tokens: ReadonlySet<string> | undefined,
  ctx: ValidationContext,
): void {
  const [head, ...terms] = ASTUtils.layoutEntryValues(entry)
  const name = String(head)
  if (colorHeads.has(name)) {
    const token = terms.length === 1 && typeof terms[0] === 'string' ? terms[0] : undefined
    if (!token) {
      ctx.error(designValidationMessages.malformedVisual(entryText(entry)), entry)
    } else if (token.startsWith('#')) {
      if (!cssHexColor.test(token)) {
        ctx.error(designValidationMessages.malformedColor(token), entry)
      }
    } else if (design && tokens && !tokens.has(token)) {
      ctx.error(designValidationMessages.unknownToken(design.name, token), entry)
    }
    return
  }

  const value = terms.length === 1 && typeof terms[0] === 'number' ? terms[0] : undefined
  const valid = name === 'weight'
    ? value !== undefined && value >= 100 && value <= 900 && value % 100 === 0
    : value !== undefined && value > 0
  if (!valid) {
    ctx.error(designValidationMessages.malformedVisual(entryText(entry)), entry)
  }
}

function validateBundleCycles(
  design: AST.DesignDeclaration,
  bundles: ReadonlyMap<string, AST.DesignBundle>,
  ctx: ValidationContext,
): void {
  const complete = new Set<string>()
  const reported = new Set<string>()
  for (const bundle of bundles.values()) {
    visit(bundle, [])
  }

  function visit(bundle: AST.DesignBundle, path: readonly string[]): void {
    if (complete.has(bundle.name)) {
      return
    }
    const nextPath = [...path, bundle.name]
    for (const entry of bundle.spec.entries) {
      const reference = bundleReference(entry, bundles)
      if (!reference) {
        continue
      }
      const cycleStart = nextPath.indexOf(reference.name)
      if (cycleStart >= 0) {
        const cycle = [...nextPath.slice(cycleStart), reference.name]
        const key = [...new Set(cycle.slice(0, -1))].sort().join('|')
        if (!reported.has(key)) {
          reported.add(key)
          ctx.error(designValidationMessages.bundleCycle(design.name, cycle), entry)
        }
        continue
      }
      visit(reference, nextPath)
    }
    complete.add(bundle.name)
  }
}

function expandBundle(
  bundle: AST.DesignBundle,
  bundles: ReadonlyMap<string, AST.DesignBundle>,
  path: ReadonlySet<string>,
): AST.LayoutEntry[] | undefined {
  if (path.has(bundle.name)) {
    return undefined
  }
  return expandEntries(bundle.spec.entries, bundles, new Set([...path, bundle.name]))
}

function expandEntries(
  entries: readonly AST.LayoutEntry[],
  bundles: ReadonlyMap<string, AST.DesignBundle>,
  path: ReadonlySet<string>,
): AST.LayoutEntry[] | undefined {
  const result: AST.LayoutEntry[] = []
  for (const entry of entries) {
    const bundle = bundleReference(entry, bundles)
    if (!bundle) {
      result.push(entry)
      continue
    }
    const expanded = expandBundle(bundle, bundles, path)
    if (!expanded) {
      return undefined
    }
    result.push(...expanded)
  }
  return result
}

function validateEffectiveConflicts(entries: readonly AST.LayoutEntry[], ctx: ValidationContext): void {
  const conflict = LayoutValidator.effectiveWeightedRigidClaim(entries)
  if (conflict) {
    ctx.error(designValidationMessages.weightedRigidClaim, conflict.rigid)
  }
}

function selectedWorkspaceDesigns(ctx: ValidationContext): AST.DesignDeclaration[] {
  const designs = new Set<AST.DesignDeclaration>()
  for (const file of ctx.workspaceFiles) {
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

function bundleReference(
  entry: AST.LayoutEntry,
  bundles: ReadonlyMap<string, AST.DesignBundle>,
): AST.DesignBundle | undefined {
  return entry.terms.length === 0 && !LayoutValidator.isLayoutEntry(entry) && !isVisualEntry(entry)
    ? bundles.get(entryHead(entry))
    : undefined
}

function isVisualEntry(entry: AST.LayoutEntry): boolean {
  return visualHeads.has(entryHead(entry))
}

/** requiresDesignLookup marks the entries a design resolves: bundle references and color tokens. Numeric visuals stand alone. */
function requiresDesignLookup(entry: AST.LayoutEntry): boolean {
  const values = ASTUtils.layoutEntryValues(entry)
  if (isVisualEntry(entry)) {
    return colorHeads.has(String(values[0]))
      && values.length === 2
      && typeof values[1] === 'string'
      && !values[1].startsWith('#')
  }
  return values.length === 1
}

function isInlineDesignExploration(entry: AST.LayoutEntry): boolean {
  if (LayoutValidator.isLayoutEntry(entry)) {
    return true
  }
  const values = ASTUtils.layoutEntryValues(entry)
  if (!isVisualEntry(entry) || values.length !== 2) {
    return false
  }
  return typeof values[1] === 'number'
    || (typeof values[1] === 'string' && values[1].startsWith('#'))
}

function entryHead(entry: AST.LayoutEntry): string {
  return String(ASTUtils.layoutEntryValues(entry)[0] ?? '')
}

function entryText(entry: AST.LayoutEntry): string {
  return ASTUtils.layoutEntryValues(entry).join(' ')
}

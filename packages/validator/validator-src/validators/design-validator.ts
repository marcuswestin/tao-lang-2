import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { designValidationCodes } from '../diagnostic-codes'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { LayoutValidator } from './layout-validator'

const visualHeads = new Set<string>(ASTUtils.designVisualHeads)
const colorHeads = new Set<string>(ASTUtils.designColorHeads)
const builtInHeads = new Set([
  ...ASTUtils.designVisualHeads,
  'aligned',
  'centered',
  'claim',
  'compress',
  'content',
  'fill',
  'gap',
  'height',
  'hug',
  'margin',
  'pad',
  'rigid',
  'width',
])

const cssHexColor = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i
const taoTag = /^#[A-Za-z_][A-Za-z0-9_]*$/

type DesignSpecMember = AST.DesignBundle | AST.DesignStyleEntry | AST.DesignTextEntry

/** designValidationMessages declares stable diagnostics for the minimal design model. */
const designValidationMessages = {
  bundleCycle: (design: string, path: readonly string[]) =>
    `Design '${design}' has a bundle cycle: ${path.join(' -> ')}.`,
  duplicateMember: (name: string) => `Design member '${name}' is declared more than once.`,
  duplicateVisualAlias: (first: string, second: string) =>
    `Design entries '${first}' and '${second}' set the same visual property.`,
  exploration: (entry: string) =>
    `Inline design exploration '${entry}' must be promoted to a token, style bundle, or element default for release.`,
  malformedColor: (value: string) => `Design color '${value}' must use exactly 3, 4, 6, or 8 hexadecimal digits.`,
  malformedTag: (value: string) =>
    `Tag '${value}' must start with a letter or underscore and contain only letters, digits, or underscores.`,
  malformedVisual: (entry: string) => `Malformed design entry '${entry}'.`,
  invalidColorCondition: "Derived design colors currently require 'when Scheme is Light|Dark'.",
  invalidScreen: (name: string) =>
    `Design screen '${name}' must use an increasing px threshold; only the last may omit it.`,
  invalidSize: (name: string) => `Design size '${name}' must resolve from px/rem values in the same unit family.`,
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
  validateUniqueBlocks(design, ctx)
  const namedMembers = designNamedMembers(design)
  const members = new Map<string, AST.Node>()
  for (const member of namedMembers) {
    if (members.has(member.name)) {
      ctx.error(designValidationMessages.duplicateMember(member.name), member.node)
    } else {
      members.set(member.name, member.node)
    }
  }
  const tokens = designColorNames(design)
  const sizes = designSizeNames(design)
  const bundles = designSpecMembers(design)

  for (const token of design.block.members.filter(AST.isDesignToken)) {
    validateColorLiteral(token.value, token, ctx)
  }
  for (const block of design.block.members.filter(AST.isDesignColorsBlock)) {
    for (const entry of block.entries) {
      validateColorValue(entry.value, tokens, ctx)
      for (const family of entry.family?.members ?? []) {
        validateColorValue(family.value, tokens, ctx)
      }
    }
  }
  validateSizes(design, ctx)
  validateScreens(design, ctx)
  for (const bundle of bundles.values()) {
    if (builtInHeads.has(bundle.name)) {
      ctx.error(designValidationMessages.reservedBundle(bundle.name), bundle)
    }
    validateEntries(bundle.spec.entries, design, tokens, sizes, bundles, ctx)
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
  const sizeEntries = clause.entries.filter(requiresSizeLookup)
  if (designEntries.length === 0 && sizeEntries.length === 0) {
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
    for (const entry of sizeEntries) {
      ctx.error(designValidationMessages.missingMountedDesign(entryText(entry)), entry)
    }
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

  const tokens = designColorNames(design)
  const sizes = designSizeNames(design)
  const bundles = designSpecMembers(design)
  validateDesignLayoutReferences(clause.entries, design, sizes, ctx)
  validateEntries(clause.entries, design, tokens, sizes, bundles, ctx, { validateLayout: false })

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
  sizes: ReadonlySet<string>,
  bundles: ReadonlyMap<string, DesignSpecMember>,
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
      validateVisualEntry(entry, design, tokens, ctx, sizes)
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
  sizes?: ReadonlySet<string>,
): void {
  const conditioned = conditionedVisualValues(entry)
  if (conditioned === undefined) {
    ctx.error(designValidationMessages.malformedVisual(entryText(entry)), entry)
    return
  }
  const [head, ...terms] = conditioned
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

  const term = terms.length === 1 ? terms[0] : undefined
  if (typeof term === 'string' && sizes === undefined) {
    return
  }
  const value = typeof term === 'number' ? term : undefined
  const size = typeof term === 'string' && sizes?.has(term) === true
  const valid = name === 'weight'
    ? (value !== undefined && value >= 100 && value <= 900 && value % 100 === 0)
      || (typeof term === 'string' && ['bold', 'medium', 'regular', 'semibold'].includes(term))
    : size || (value !== undefined && value > 0)
  if (!valid) {
    ctx.error(designValidationMessages.malformedVisual(entryText(entry)), entry)
  }
}

function validateBundleCycles(
  design: AST.DesignDeclaration,
  bundles: ReadonlyMap<string, DesignSpecMember>,
  ctx: ValidationContext,
): void {
  const complete = new Set<string>()
  const reported = new Set<string>()
  for (const bundle of bundles.values()) {
    visit(bundle, [])
  }

  function visit(bundle: DesignSpecMember, path: readonly string[]): void {
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
  bundle: DesignSpecMember,
  bundles: ReadonlyMap<string, DesignSpecMember>,
  path: ReadonlySet<string>,
): AST.LayoutEntry[] | undefined {
  if (path.has(bundle.name)) {
    return undefined
  }
  return expandEntries(bundle.spec.entries, bundles, new Set([...path, bundle.name]))
}

function expandEntries(
  entries: readonly AST.LayoutEntry[],
  bundles: ReadonlyMap<string, DesignSpecMember>,
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
  const visualAliases = new Map<string, { entry: AST.LayoutEntry; head: string }>()
  for (const entry of entries.filter(isVisualEntry)) {
    const values = conditionedVisualValues(entry)
    if (values === undefined) {
      continue
    }
    const head = String(values[0] ?? '')
    if (values.length < 2) {
      continue
    }
    const canonical = ASTUtils.canonicalDesignVisualHead(head)
    const previous = visualAliases.get(canonical)
    if (previous !== undefined && previous.head !== head) {
      ctx.error(designValidationMessages.duplicateVisualAlias(previous.head, head), entry)
    } else if (previous === undefined) {
      visualAliases.set(canonical, { entry, head })
    }
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

function validateUniqueBlocks(design: AST.DesignDeclaration, ctx: ValidationContext): void {
  for (
    const predicate of [
      AST.isDesignColorsBlock,
      AST.isDesignSizesBlock,
      AST.isDesignTextBlock,
      AST.isDesignScreensBlock,
      AST.isDesignStylesBlock,
    ]
  ) {
    const blocks = design.block.members.filter(predicate)
    for (const block of blocks.slice(1)) {
      ctx.error(`Design '${design.name}' may declare each typed block only once.`, block)
    }
  }
}

function designNamedMembers(design: AST.DesignDeclaration): Array<{ name: string; node: AST.Node }> {
  const result: Array<{ name: string; node: AST.Node }> = []
  for (const member of design.block.members) {
    if (AST.isDesignToken(member) || AST.isDesignBundle(member)) {
      result.push({ name: member.name, node: member })
    } else if (AST.isDesignColorsBlock(member)) {
      for (const entry of member.entries) {
        result.push({ name: entry.name, node: entry })
        result.push(...(entry.family?.members ?? []).map(family => ({
          name: `${entry.name}.${family.name}`,
          node: family,
        })))
      }
    } else if (AST.isDesignSizesBlock(member) || AST.isDesignTextBlock(member) || AST.isDesignStylesBlock(member)) {
      result.push(...member.entries.map(entry => ({ name: entry.name, node: entry })))
    }
  }
  return result
}

function designColorNames(design: AST.DesignDeclaration): Set<string> {
  return new Set(
    designNamedMembers(design).filter(({ node }) =>
      AST.isDesignToken(node) || AST.isDesignColorEntry(node) || AST.isDesignColorFamilyMember(node)
    ).map(member => member.name),
  )
}

function designSizeNames(design: AST.DesignDeclaration): Set<string> {
  return new Set(
    design.block.members.filter(AST.isDesignSizesBlock).flatMap(block => block.entries.map(entry => entry.name)),
  )
}

function designSpecMembers(design: AST.DesignDeclaration): Map<string, DesignSpecMember> {
  const result = new Map<string, DesignSpecMember>()
  for (const member of design.block.members) {
    if (AST.isDesignBundle(member)) {
      result.set(member.name, member)
    } else if (AST.isDesignTextBlock(member) || AST.isDesignStylesBlock(member)) {
      for (const entry of member.entries) {
        result.set(entry.name, entry)
      }
    }
  }
  return result
}

function validateColorLiteral(value: string, node: AST.Node, ctx: ValidationContext): void {
  if (!cssHexColor.test(value)) {
    ctx.error(designValidationMessages.malformedColor(value), node)
  }
}

function validateColorValue(
  value: AST.DesignColorValue,
  colors: ReadonlySet<string>,
  ctx: ValidationContext,
): void {
  if (AST.isDesignColorAtom(value)) {
    validateColorAtom(value, colors, ctx)
    return
  }
  if (value.environment !== 'Scheme' || (value.expected !== 'Dark' && value.expected !== 'Light')) {
    ctx.error(designValidationMessages.invalidColorCondition, value)
  }
  validateColorAtom(value.positive, colors, ctx)
  validateColorAtom(value.negative, colors, ctx)
}

function validateColorAtom(
  atom: AST.DesignColorAtom,
  colors: ReadonlySet<string>,
  ctx: ValidationContext,
): void {
  if (atom.literal !== undefined) {
    validateColorLiteral(atom.literal, atom, ctx)
    return
  }
  const path = designValuePath(atom.path!)
  if (!colors.has(path)) {
    ctx.error(`Design has no color '${path}'.`, atom)
  }
}

function validateSizes(design: AST.DesignDeclaration, ctx: ValidationContext): void {
  const entries = new Map(
    design.block.members.filter(AST.isDesignSizesBlock).flatMap(block =>
      block.entries.map(entry => [entry.name, entry] as const)
    ),
  )
  const resolved = new Map<string, 'px' | 'rem'>()
  const resolving = new Set<string>()
  for (const entry of entries.values()) {
    if (resolve(entry.name) === undefined) {
      ctx.error(designValidationMessages.invalidSize(entry.name), entry)
    }
  }

  function resolve(name: string): 'px' | 'rem' | undefined {
    const existing = resolved.get(name)
    if (existing !== undefined) {
      return existing
    }
    if (resolving.has(name)) {
      return undefined
    }
    const entry = entries.get(name)
    if (entry === undefined) {
      return undefined
    }
    resolving.add(name)
    const left = atomUnit(entry.value.left)
    const right = entry.value.right === undefined ? left : atomUnit(entry.value.right)
    resolving.delete(name)
    if (left === undefined || right !== left) {
      return undefined
    }
    resolved.set(name, left)
    return left
  }

  function atomUnit(atom: AST.DesignSizeAtom): 'px' | 'rem' | undefined {
    if (atom.dimension !== undefined) {
      return atom.dimension.value > 0 && (atom.dimension.unit === 'px' || atom.dimension.unit === 'rem')
        ? atom.dimension.unit
        : undefined
    }
    return resolve(designValuePath(atom.path!))
  }
}

function validateScreens(design: AST.DesignDeclaration, ctx: ValidationContext): void {
  for (const block of design.block.members.filter(AST.isDesignScreensBlock)) {
    let previous = 0
    block.entries.forEach((entry, index) => {
      const threshold = entry.threshold
      const valid = threshold === undefined
        ? index === block.entries.length - 1
        : threshold.unit === 'px' && threshold.value > previous
      if (!valid) {
        ctx.error(designValidationMessages.invalidScreen(entry.name), entry)
      }
      if (threshold !== undefined) {
        previous = threshold.value
      }
    })
  }
}

function validateDesignLayoutReferences(
  entries: readonly AST.LayoutEntry[],
  design: AST.DesignDeclaration,
  sizes: ReadonlySet<string>,
  ctx: ValidationContext,
): void {
  for (const entry of entries) {
    for (const reference of layoutSizeReferences(entry)) {
      if (!sizes.has(reference)) {
        ctx.error(`Design '${design.name}' has no size '${reference}'.`, entry)
      }
    }
  }
}

function layoutSizeReferences(entry: AST.LayoutEntry): string[] {
  if (!LayoutValidator.isLayoutEntry(entry)) {
    return []
  }
  const [head, ...terms] = ASTUtils.layoutEntryValues(entry)
  const candidates = head === 'gap'
    ? terms.slice(0, 1)
    : head === 'pad' || head === 'margin'
    ? (terms.length === 1 ? terms : terms.filter((_, index) => index % 2 === 1))
    : head === 'width' || head === 'height'
    ? (terms[0] === 'max' ? terms.slice(1, 2) : terms.slice(0, 1))
    : []
  return candidates.filter((value): value is string => typeof value === 'string' && value !== 'fill')
}

function designValuePath(path: AST.DesignValuePath): string {
  return [path.head, ...path.segments].join('.')
}

function bundleReference(
  entry: AST.LayoutEntry,
  bundles: ReadonlyMap<string, DesignSpecMember>,
): DesignSpecMember | undefined {
  return entry.terms.length === 0 && !LayoutValidator.isLayoutEntry(entry) && !isVisualEntry(entry)
    ? bundles.get(entryHead(entry))
    : undefined
}

function isVisualEntry(entry: AST.LayoutEntry): boolean {
  return visualHeads.has(entryHead(entry))
}

/** requiresDesignLookup marks the entries a design resolves: bundle references and color tokens. Numeric visuals stand alone. */
function requiresDesignLookup(entry: AST.LayoutEntry): boolean {
  const values = conditionedVisualValues(entry) ?? ASTUtils.layoutEntryValues(entry)
  if (isVisualEntry(entry)) {
    const head = String(values[0])
    return values.length === 2
      && typeof values[1] === 'string'
      && !values[1].startsWith('#')
      && !(head === 'weight' && ['bold', 'medium', 'regular', 'semibold'].includes(values[1]))
  }
  return values.length === 1
}

function requiresSizeLookup(entry: AST.LayoutEntry): boolean {
  return layoutSizeReferences(entry).length > 0
}

function isInlineDesignExploration(entry: AST.LayoutEntry): boolean {
  if (LayoutValidator.isLayoutEntry(entry)) {
    return true
  }
  const values = conditionedVisualValues(entry)
  if (values === undefined) {
    return false
  }
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

/** Scheme conditions are deliberately narrow: an exact postfix on one visual entry. */
function conditionedVisualValues(entry: AST.LayoutEntry): readonly (number | string)[] | undefined {
  const values = ASTUtils.layoutEntryValues(entry)
  const when = values.indexOf('when')
  if (when < 0) {
    return values
  }
  const condition = values.slice(when)
  if (
    condition.length !== 4
    || condition[0] !== 'when'
    || condition[1] !== 'Scheme'
    || condition[2] !== 'is'
    || (condition[3] !== 'Dark' && condition[3] !== 'Light')
  ) {
    return undefined
  }
  return values.slice(0, when)
}

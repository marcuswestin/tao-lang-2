import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { type LayoutConflictItem, LayoutConflictValidator } from './layout-conflict-validator'

/** layoutValidationMessages declares layout clause diagnostics. */
const layoutValidationMessages = {
  duplicateEntry: (key: string) => `Layout property '${key}' is declared more than once.`,
  conflictingEntries: (left: string, right: string) =>
    `Layout properties '${left}' and '${right}' cannot be used together.`,
  injectLayout: 'Layout clauses cannot be used on `render inject`.',
  malformedEntry: (entry: string) => `Malformed layout entry '${entry}'.`,
  positiveNumber: (entry: string) => `Layout entry '${entry}' must use positive numbers.`,
  unsupportedEntry: (entry: string) => `Unsupported layout entry '${entry}'.`,
  unsupportedTerm: (entry: string, term: string) => `Unsupported layout term '${term}' in '${entry}'.`,
} as const

const alignTermValues = ['top', 'bottom', 'left', 'right', 'center', 'baseline'] as const
const padSideValues = ['top', 'right', 'bottom', 'left', 'horizontal', 'vertical'] as const
const contentTermValues = [
  'top',
  'bottom',
  'left',
  'right',
  'center',
  'baseline',
  'stretch',
  'spread',
  'spread-inset',
  'spread-balanced',
] as const

type AlignTerm = (typeof alignTermValues)[number]
type ContentTerm = (typeof contentTermValues)[number]
type PadSide = (typeof padSideValues)[number]
type PhysicalPadSide = 'bottom' | 'left' | 'right' | 'top'
type ContentTermConflictKey = 'center' | 'cross-alignment' | 'horizontal' | 'main-distribution' | 'vertical'

type WeightedRigidClaim = {
  readonly claim: AST.LayoutEntry
  readonly rigid: AST.LayoutEntry
}

/** LayoutValidator validates render-site layout clauses. */
export const LayoutValidator = {
  checks: {
    [AST.Render.$type]: validateRender,
  } satisfies NodeValidationChecks,
  effectiveWeightedRigidClaim,
  isLayoutEntry,
  messages: layoutValidationMessages,
  validateEntry: validateLayoutEntry,
}

function validateRender(render: AST.Render, ctx: ValidationContext): void {
  if (AST.isRenderStatement(render) && render.injection && render.layoutClause) {
    ctx.error(render.layoutClause, layoutValidationMessages.injectLayout)
    return
  }
  if (render.layoutClause) {
    validateLayoutClause(render.layoutClause, ctx)
  }
}

function validateLayoutClause(layoutClause: AST.LayoutClause, ctx: ValidationContext): void {
  for (const entry of layoutClause.entries) {
    // A single unknown word may be a mounted-design bundle, while the visual heads share this
    // same combined clause surface. DesignValidator owns those cases. Entries with terms cannot
    // be bundle references and remain ordinary unsupported layout diagnostics here.
    if (isLayoutEntry(entry) || !isPotentialDesignEntry(entry)) {
      validateLayoutEntry(entry, ctx)
    }
  }
  // A design bundle can replace either winner after expansion. DesignValidator owns the effective
  // conflict check for every combined list; this local fast path is authoritative only when the
  // entire list is already made of direct layout entries.
  if (layoutClause.entries.every(isLayoutEntry)) {
    const conflict = effectiveWeightedRigidClaim(layoutClause.entries)
    if (conflict) {
      ctx.error(conflict.rigid, layoutValidationMessages.conflictingEntries('claim', 'rigid'))
    }
  }
}

function isLayoutEntry(entry: AST.LayoutEntry): boolean {
  const head = layoutEntryHead(entry)
  return head !== undefined && layoutHeadValue(head) !== undefined
}

function isPotentialDesignEntry(entry: AST.LayoutEntry): boolean {
  const head = layoutEntryHeadText(entry)
  return entry.terms.length === 0 || designVisualHeads.has(head)
}

const designVisualHeads = new Set<string>(ASTUtils.designVisualHeads)

function validateLayoutEntry(
  entry: AST.LayoutEntry,
  ctx: ValidationContext,
): void {
  const head = layoutEntryHead(entry)
  if (!head) {
    ctx.error(entry, layoutValidationMessages.unsupportedEntry(layoutEntryText(entry)))
    return
  }

  const headValue = layoutHeadValue(head)
  if (!headValue) {
    ctx.error(entry, layoutValidationMessages.unsupportedEntry(layoutEntryText(entry)))
    return
  }

  Switch(headValue, {
    claim: () => validateSingleNumber(entry, ctx, false),
    content: () => validateContent(entry, ctx),
    gap: () => validateSingleNumber(entry, ctx, true),
    margin: () => validateSpacing(entry, ctx, 'margin'),
    pad: () => validateSpacing(entry, ctx, 'pad'),
    width: () => validateDimension(entry, ctx, { supportsMaximum: true }),
    height: () => validateDimension(entry, ctx),
    fill: () => validateBareEntry(entry, ctx),
    hug: () => validateBareEntry(entry, ctx),
    compress: () => validateBareEntry(entry, ctx),
    rigid: () => validateBareEntry(entry, ctx),
    centered: () => validateBareEntry(entry, ctx),
    aligned: () => validateAligned(entry, ctx),
  })
}

function validateContent(
  entry: AST.LayoutEntry,
  ctx: ValidationContext,
): void {
  const terms = entry.terms
  if (terms.length < 1 || terms.length > 2 || !terms.every(AST.isLayoutWord)) {
    ctx.error(entry, layoutValidationMessages.malformedEntry(layoutEntryText(entry)))
    return
  }
  const contentTerms = validateAllowedTerms(entry, terms, contentTermValue, ctx)
  validateContentTermConflicts(entry, contentTerms, ctx)
}

function validateSingleNumber(entry: AST.LayoutEntry, ctx: ValidationContext, allowToken: boolean): void {
  const terms = entry.terms
  if (
    terms.length !== 1
    || (!AST.isLayoutNumberLiteral(terms[0]) && !(allowToken && isDesignSizeReference(terms[0])))
  ) {
    ctx.error(entry, layoutValidationMessages.malformedEntry(layoutEntryText(entry)))
    return
  }
  if (AST.isLayoutNumberLiteral(terms[0])) {
    validatePositiveNumber(entry, terms[0], ctx)
  }
}

function validatePositiveNumber(
  entry: AST.LayoutEntry,
  term: AST.LayoutNumberLiteral,
  ctx: ValidationContext,
): void {
  if (term.value <= 0) {
    ctx.error(entry, layoutValidationMessages.positiveNumber(layoutEntryText(entry)))
  }
}

function validateSpacing(entry: AST.LayoutEntry, ctx: ValidationContext, head: 'margin' | 'pad'): void {
  const terms = entry.terms
  if (terms.length === 1 && (AST.isLayoutNumberLiteral(terms[0]) || isDesignSizeReference(terms[0]))) {
    if (AST.isLayoutNumberLiteral(terms[0])) {
      validatePositiveNumber(entry, terms[0], ctx)
    }
    return
  }
  if (terms.length < 2 || terms.length % 2 !== 0) {
    ctx.error(entry, layoutValidationMessages.malformedEntry(layoutEntryText(entry)))
    return
  }

  const sideConflictItems: LayoutConflictItem<PhysicalPadSide>[] = []
  for (let index = 0; index < terms.length; index += 2) {
    const sideTerm = terms[index]
    const value = terms[index + 1]
    const side = sideTerm && AST.isLayoutWord(sideTerm) ? padSideValue(sideTerm) : undefined
    if (!side || !value || (!AST.isLayoutNumberLiteral(value) && !isDesignSizeReference(value))) {
      ctx.error(entry, layoutValidationMessages.malformedEntry(layoutEntryText(entry)))
      return
    }
    if (AST.isLayoutNumberLiteral(value)) {
      validatePositiveNumber(entry, value, ctx)
    }
    for (const physicalSide of padPhysicalSides(side)) {
      sideConflictItems.push({ keys: [physicalSide], label: `${head} ${physicalSide}`, node: entry })
    }
  }
  LayoutConflictValidator.validate(sideConflictItems, ctx, layoutValidationMessages)
}

function validateDimension(
  entry: AST.LayoutEntry,
  ctx: ValidationContext,
  options: { supportsMaximum?: boolean } = {},
): void {
  const terms = entry.terms
  if (options.supportsMaximum && terms[0] && AST.isLayoutWord(terms[0]) && layoutWordText(terms[0]) === 'max') {
    if (terms.length === 2 && (AST.isLayoutNumberLiteral(terms[1]) || isDesignSizeReference(terms[1]))) {
      if (AST.isLayoutNumberLiteral(terms[1])) {
        validatePositiveNumber(entry, terms[1], ctx)
      }
      return
    }
    ctx.error(entry, layoutValidationMessages.malformedEntry(layoutEntryText(entry)))
    return
  }
  if (terms.length !== 1) {
    ctx.error(entry, layoutValidationMessages.malformedEntry(layoutEntryText(entry)))
    return
  }
  const value = terms[0]!
  if (AST.isLayoutNumberLiteral(value)) {
    validatePositiveNumber(entry, value, ctx)
    return
  }
  if (AST.isLayoutWord(value) && layoutWordText(value) === 'fill') {
    return
  }
  // A non-keyword word or dotted path is resolved as a selected design size by DesignValidator.
  if (isDesignSizeReference(value)) {
    return
  }
  ctx.error(entry, layoutValidationMessages.unsupportedTerm(layoutEntryText(entry), layoutTermText(value)))
}

function validateBareEntry(entry: AST.LayoutEntry, ctx: ValidationContext): void {
  if (entry.terms.length > 0) {
    ctx.error(entry, layoutValidationMessages.malformedEntry(layoutEntryText(entry)))
  }
}

function validateAligned(
  entry: AST.LayoutEntry,
  ctx: ValidationContext,
): void {
  const terms = entry.terms
  if (terms.length !== 1 || !AST.isLayoutWord(terms[0])) {
    ctx.error(entry, layoutValidationMessages.malformedEntry(layoutEntryText(entry)))
    return
  }
  validateAllowedTerms(entry, [terms[0]], alignTermValue, ctx)
}

function validateAllowedTerms<TermT extends string>(
  entry: AST.LayoutEntry,
  terms: readonly AST.LayoutWord[],
  termValue: (term: AST.LayoutWord) => TermT | undefined,
  ctx: ValidationContext,
): TermT[] {
  const allowedTerms: TermT[] = []
  for (const term of terms) {
    const value = termValue(term)
    if (!value) {
      ctx.error(entry, layoutValidationMessages.unsupportedTerm(layoutEntryText(entry), layoutWordText(term)))
      continue
    }
    allowedTerms.push(value)
  }
  return allowedTerms
}

function validateContentTermConflicts(
  entry: AST.LayoutEntry,
  terms: readonly ContentTerm[],
  ctx: ValidationContext,
): void {
  LayoutConflictValidator.validate(
    terms.map(term => ({ keys: [contentTermConflictKey(term)], label: `content ${term}`, node: entry })),
    ctx,
    layoutValidationMessages,
  )
}

function contentTermConflictKey(term: ContentTerm): ContentTermConflictKey {
  return Switch(term, {
    'baseline': () => 'cross-alignment',
    'stretch': () => 'cross-alignment',
    'bottom': () => 'vertical',
    'top': () => 'vertical',
    'center': () => 'center',
    'left': () => 'horizontal',
    'right': () => 'horizontal',
    'spread': () => 'main-distribution',
    'spread-balanced': () => 'main-distribution',
    'spread-inset': () => 'main-distribution',
  })
}

/**
 * Returns the one incompatibility that can remain after left-to-right clause replacement.
 *
 * `fill`, `claim`, and `hug` are successive values of main-axis growth. `compress` and `rigid`
 * are successive values of shrink pressure. A weighted claim and a final rigid value are the only
 * incompatible winners; replacing either winner makes the resolved set valid again.
 */
function effectiveWeightedRigidClaim(entries: readonly AST.LayoutEntry[]): WeightedRigidClaim | undefined {
  const growth = entries.findLast(entry => ['fill', 'claim', 'hug'].includes(layoutEntryHeadText(entry)))
  const shrink = entries.findLast(entry => ['compress', 'rigid'].includes(layoutEntryHeadText(entry)))
  return growth && layoutEntryHeadText(growth) === 'claim' && shrink && layoutEntryHeadText(shrink) === 'rigid'
    ? { claim: growth, rigid: shrink }
    : undefined
}

const layoutHeads = ASTUtils.designLayoutHeads

const reservedDesignSizeTerms = new Set<string>([
  ...layoutHeads,
  ...alignTermValues,
  ...contentTermValues,
  ...padSideValues,
  'max',
  'shrink',
])

function isDesignSizeReference(term: AST.LayoutTerm | undefined): term is AST.LayoutWord {
  return term !== undefined
    && AST.isLayoutWord(term)
    && !reservedDesignSizeTerms.has(layoutWordText(term))
}

type LayoutHead = (typeof layoutHeads)[number]

function layoutHeadValue(head: AST.LayoutWord): LayoutHead | undefined {
  return layoutWordValue(head, layoutHeads)
}

function layoutEntryHead(entry: AST.LayoutEntry): AST.LayoutWord | undefined {
  return AST.isLayoutWord(entry.head) ? entry.head : undefined
}

function layoutEntryText(entry: AST.LayoutEntry): string {
  return ASTUtils.layoutEntryValues(entry).join(' ')
}

function layoutEntryHeadText(entry: AST.LayoutEntry): string {
  return String(ASTUtils.layoutTermValue(entry.head))
}

function layoutTermText(term: AST.LayoutTerm): string {
  return String(ASTUtils.layoutTermValue(term))
}

function layoutWordText(term: AST.LayoutWord): string {
  return layoutTermText(term)
}

function layoutWordValue<ValueT extends string>(
  word: AST.LayoutWord,
  values: readonly ValueT[],
): ValueT | undefined {
  const value = layoutWordText(word)
  return values.includes(value as ValueT) ? value as ValueT : undefined
}

function alignTermValue(term: AST.LayoutWord): AlignTerm | undefined {
  return layoutWordValue(term, alignTermValues)
}

function contentTermValue(term: AST.LayoutWord): ContentTerm | undefined {
  return layoutWordValue(term, contentTermValues)
}

function padSideValue(term: AST.LayoutWord): PadSide | undefined {
  return layoutWordValue(term, padSideValues)
}

function padPhysicalSides(side: PadSide): readonly PhysicalPadSide[] {
  return Switch(side, {
    bottom: () => ['bottom'],
    horizontal: () => ['left', 'right'],
    left: () => ['left'],
    right: () => ['right'],
    top: () => ['top'],
    vertical: () => ['top', 'bottom'],
  })
}

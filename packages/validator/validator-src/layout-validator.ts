import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { type LayoutConflictItem, LayoutConflictValidator } from './layout-conflict-validator'
import type { ValidationContext } from './validation'

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
const accessibilityRoleValues = [
  'adjustable',
  'button',
  'header',
  'image',
  'link',
  'none',
  'search',
  'summary',
  'text',
] as const
const padSideValues = ['top', 'right', 'bottom', 'left', 'horizontal', 'vertical'] as const
const dimensionTermValues = ['fill'] as const
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
type AccessibilityRole = (typeof accessibilityRoleValues)[number]
type ContentTerm = (typeof contentTermValues)[number]
type DimensionTerm = (typeof dimensionTermValues)[number]
type PadSide = (typeof padSideValues)[number]
type PhysicalPadSide = 'bottom' | 'left' | 'right' | 'top'
type ContentTermConflictKey = 'center' | 'cross-alignment' | 'horizontal' | 'main-distribution' | 'vertical'
type LayoutConflictKey =
  | 'accessibility-id'
  | 'accessibility-label'
  | 'accessibility-role'
  | 'compression-pressure'
  | 'content'
  | 'gap'
  | 'height'
  | 'height-axis-sizing'
  | 'main-size-pressure'
  | 'margin'
  | 'pad'
  | 'rigid-weighted-claim'
  | 'self-alignment'
  | 'width'
  | 'width-axis-sizing'

/** LayoutValidator validates render-site layout clauses. */
export const LayoutValidator = {
  messages: layoutValidationMessages,
  validate,
}

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const render of AST.streamAllContents(file).filter(AST.isRender)) {
    if (AST.isRenderStatement(render) && render.injection && render.layoutClause) {
      ctx.error(layoutValidationMessages.injectLayout, render.layoutClause)
      continue
    }
    if (render.layoutClause) {
      validateLayoutClause(render.layoutClause, ctx)
    }
  }
}

function validateLayoutClause(layoutClause: AST.LayoutClause, ctx: ValidationContext): void {
  for (const entry of layoutClause.entries) {
    validateLayoutEntry(entry, ctx)
  }
  LayoutConflictValidator.validate(layoutClause.entries.flatMap(layoutEntryConflictItem), ctx, layoutValidationMessages)
}

function validateLayoutEntry(
  entry: AST.LayoutEntry,
  ctx: ValidationContext,
): void {
  const head = layoutEntryHead(entry)
  if (!head) {
    ctx.error(layoutValidationMessages.unsupportedEntry(layoutEntryText(entry)), entry)
    return
  }

  const headValue = layoutHeadValue(head)
  if (!headValue) {
    ctx.error(layoutValidationMessages.unsupportedEntry(layoutEntryText(entry)), entry)
    return
  }

  Switch(headValue, {
    id: () => validateAccessibilityText(entry, ctx),
    label: () => validateAccessibilityText(entry, ctx),
    role: () => validateAccessibilityRole(entry, ctx),
    claim: () => validateSingleNumber(entry, ctx),
    content: () => validateContent(entry, ctx),
    gap: () => validateSingleNumber(entry, ctx),
    margin: () => validateSpacing(entry, ctx, 'margin'),
    pad: () => validateSpacing(entry, ctx, 'pad'),
    width: () => validateDimension(entry, ctx),
    height: () => validateDimension(entry, ctx),
    fill: () => validateBareEntry(entry, ctx),
    hug: () => validateBareEntry(entry, ctx),
    compress: () => validateBareEntry(entry, ctx),
    rigid: () => validateBareEntry(entry, ctx),
    centered: () => validateBareEntry(entry, ctx),
    aligned: () => validateAligned(entry, ctx),
  })
}

function validateAccessibilityText(entry: AST.LayoutEntry, ctx: ValidationContext): void {
  const terms = entry.terms
  if (terms.length !== 1 || (!AST.isLayoutWord(terms[0]) && !AST.isLayoutStringLiteral(terms[0]))) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
  }
}

function validateAccessibilityRole(entry: AST.LayoutEntry, ctx: ValidationContext): void {
  const terms = entry.terms
  if (terms.length !== 1) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
    return
  }
  const role = terms[0]
  if (!role) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
    return
  }
  const roleValue = AST.isLayoutWord(role) ? accessibilityRoleValue(role) : layoutStringRoleValue(role)
  if (!roleValue) {
    ctx.error(layoutValidationMessages.unsupportedTerm(layoutEntryText(entry), layoutTermText(role)), entry)
  }
}

function validateContent(
  entry: AST.LayoutEntry,
  ctx: ValidationContext,
): void {
  const terms = entry.terms
  if (terms.length < 1 || terms.length > 2 || !terms.every(AST.isLayoutWord)) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
    return
  }
  const contentTerms = validateAllowedTerms(entry, terms, contentTermValue, ctx)
  validateContentTermConflicts(entry, contentTerms, ctx)
}

function validateSingleNumber(entry: AST.LayoutEntry, ctx: ValidationContext): void {
  const terms = entry.terms
  if (terms.length !== 1 || !AST.isLayoutNumberLiteral(terms[0])) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
    return
  }
  validatePositiveNumber(entry, terms[0], ctx)
}

function validatePositiveNumber(
  entry: AST.LayoutEntry,
  term: AST.LayoutNumberLiteral,
  ctx: ValidationContext,
): void {
  if (term.value <= 0) {
    ctx.error(layoutValidationMessages.positiveNumber(layoutEntryText(entry)), entry)
  }
}

function validateSpacing(entry: AST.LayoutEntry, ctx: ValidationContext, head: 'margin' | 'pad'): void {
  const terms = entry.terms
  if (terms.length === 1 && AST.isLayoutNumberLiteral(terms[0])) {
    validatePositiveNumber(entry, terms[0], ctx)
    return
  }
  if (terms.length < 2 || terms.length % 2 !== 0) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
    return
  }

  const sideConflictItems: LayoutConflictItem<PhysicalPadSide>[] = []
  for (let index = 0; index < terms.length; index += 2) {
    const sideTerm = terms[index]
    const value = terms[index + 1]
    const side = sideTerm && AST.isLayoutWord(sideTerm) ? padSideValue(sideTerm) : undefined
    if (!side || !value || !AST.isLayoutNumberLiteral(value)) {
      ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
      return
    }
    validatePositiveNumber(entry, value, ctx)
    for (const physicalSide of padPhysicalSides(side)) {
      sideConflictItems.push({ keys: [physicalSide], label: `${head} ${physicalSide}`, node: entry })
    }
  }
  LayoutConflictValidator.validate(sideConflictItems, ctx, layoutValidationMessages)
}

function validateDimension(entry: AST.LayoutEntry, ctx: ValidationContext): void {
  const terms = entry.terms
  if (terms.length !== 1) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
    return
  }
  const value = terms[0]!
  if (AST.isLayoutNumberLiteral(value)) {
    validatePositiveNumber(entry, value, ctx)
    return
  }
  if (AST.isLayoutWord(value) && dimensionTermValue(value)) {
    return
  }
  ctx.error(layoutValidationMessages.unsupportedTerm(layoutEntryText(entry), layoutTermText(value)), entry)
}

function validateBareEntry(entry: AST.LayoutEntry, ctx: ValidationContext): void {
  if (entry.terms.length > 0) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
  }
}

function validateAligned(
  entry: AST.LayoutEntry,
  ctx: ValidationContext,
): void {
  const terms = entry.terms
  if (terms.length !== 1 || !AST.isLayoutWord(terms[0])) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
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
      ctx.error(layoutValidationMessages.unsupportedTerm(layoutEntryText(entry), layoutWordText(term)), entry)
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

function layoutEntryConflictItem(entry: AST.LayoutEntry): readonly LayoutConflictItem<LayoutConflictKey>[] {
  const head = layoutEntryHead(entry)
  const headValue = head ? layoutHeadValue(head) : undefined
  if (!headValue) {
    return []
  }
  return [{ keys: layoutConflictKeysByHead[headValue], label: layoutEntryHeadText(entry), node: entry }]
}

const layoutConflictKeysByHead = {
  id: ['accessibility-id'],
  label: ['accessibility-label'],
  role: ['accessibility-role'],
  aligned: ['self-alignment'],
  centered: ['self-alignment'],
  claim: ['main-size-pressure', 'rigid-weighted-claim'],
  compress: ['compression-pressure'],
  content: ['content'],
  fill: ['main-size-pressure', 'self-alignment', 'width-axis-sizing', 'height-axis-sizing'],
  gap: ['gap'],
  height: ['height', 'height-axis-sizing'],
  hug: ['main-size-pressure'],
  margin: ['margin'],
  pad: ['pad'],
  rigid: ['compression-pressure', 'rigid-weighted-claim'],
  width: ['width', 'width-axis-sizing'],
} as const satisfies Record<LayoutHead, readonly LayoutConflictKey[]>

const layoutHeads = [
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
  'id',
  'label',
  'role',
] as const

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

function accessibilityRoleValue(term: AST.LayoutWord): AccessibilityRole | undefined {
  return layoutWordValue(term, accessibilityRoleValues)
}

function layoutStringRoleValue(term: AST.LayoutTerm): AccessibilityRole | undefined {
  if (!AST.isLayoutStringLiteral(term)) {
    return undefined
  }
  const value = ASTUtils.layoutTermValue(term)
  return typeof value === 'string' && accessibilityRoleValues.includes(value as AccessibilityRole)
    ? value as AccessibilityRole
    : undefined
}

function contentTermValue(term: AST.LayoutWord): ContentTerm | undefined {
  return layoutWordValue(term, contentTermValues)
}

function dimensionTermValue(term: AST.LayoutWord): DimensionTerm | undefined {
  return layoutWordValue(term, dimensionTermValues)
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

import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { ValidationContext } from './validation'

/** layoutValidationMessages declares layout clause diagnostics. */
const layoutValidationMessages = {
  duplicateEntry: (key: string) => `Layout property '${key}' is declared more than once.`,
  conflictingEntries: (left: string, right: string) =>
    `Layout properties '${left}' and '${right}' cannot be used together.`,
  injectLayout: 'Layout clauses cannot be used on `render inject`.',
  malformedEntry: (entry: string) => `Malformed layout entry '${entry}'.`,
  unsupportedEntry: (entry: string) => `Unsupported layout entry '${entry}'.`,
  unsupportedTerm: (entry: string, term: string) => `Unsupported layout term '${term}' in '${entry}'.`,
} as const

const alignTermValues = ['top', 'bottom', 'left', 'right', 'center', 'baseline'] as const
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
type ContentTerm = (typeof contentTermValues)[number]
type DimensionTerm = (typeof dimensionTermValues)[number]
type PadSide = (typeof padSideValues)[number]
type PhysicalPadSide = 'bottom' | 'left' | 'right' | 'top'
type ContentTermConflictKey = 'center' | 'cross-alignment' | 'horizontal' | 'main-distribution' | 'vertical'
type LayoutConflictKey =
  | 'compression-pressure'
  | 'content'
  | 'gap'
  | 'height'
  | 'main-size-pressure'
  | 'pad'
  | 'self-alignment'
  | 'width'

/** LayoutValidator validates render-site layout clauses. */
export const LayoutValidator = {
  messages: layoutValidationMessages,
  validate,
}

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const render of ASTUtils.streamAllContents(file).filter(AST.isRender)) {
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
  const seen = new Map<LayoutConflictKey, AST.LayoutEntry>()
  for (const entry of layoutClause.entries) {
    validateLayoutEntry(entry, ctx)
    const keys = layoutEntryConflictKeys(entry)
    const conflictKey = keys.find(key => seen.has(key))
    if (conflictKey) {
      const existing = seen.get(conflictKey)!
      const existingHead = layoutEntryHeadText(existing)
      const head = layoutEntryHeadText(entry)
      ctx.error(
        existingHead === head
          ? layoutValidationMessages.duplicateEntry(head)
          : layoutValidationMessages.conflictingEntries(existingHead, head),
        entry,
      )
      continue
    }
    for (const key of keys) {
      seen.set(key, entry)
    }
  }
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
    content: () => validateContent(entry, ctx),
    gap: () => validateSingleNumber(entry, ctx),
    pad: () => validatePad(entry, ctx),
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
  }
}

function validatePad(entry: AST.LayoutEntry, ctx: ValidationContext): void {
  const terms = entry.terms
  if (terms.length === 1 && AST.isLayoutNumberLiteral(terms[0])) {
    return
  }
  if (terms.length < 2 || terms.length % 2 !== 0) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
    return
  }

  const seenSides = new Set<PhysicalPadSide>()
  for (let index = 0; index < terms.length; index += 2) {
    const sideTerm = terms[index]
    const value = terms[index + 1]
    const side = sideTerm && AST.isLayoutWord(sideTerm) ? padSideValue(sideTerm) : undefined
    if (!side || !value || !AST.isLayoutNumberLiteral(value)) {
      ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
      return
    }
    for (const physicalSide of padPhysicalSides(side)) {
      if (seenSides.has(physicalSide)) {
        ctx.error(layoutValidationMessages.duplicateEntry(`pad ${physicalSide}`), entry)
        return
      }
      seenSides.add(physicalSide)
    }
  }
}

function validateDimension(entry: AST.LayoutEntry, ctx: ValidationContext): void {
  const terms = entry.terms
  if (terms.length !== 1) {
    ctx.error(layoutValidationMessages.malformedEntry(layoutEntryText(entry)), entry)
    return
  }
  const value = terms[0]!
  if (AST.isLayoutNumberLiteral(value)) {
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
  const seen = new Map<ContentTermConflictKey, ContentTerm>()
  for (const term of terms) {
    const key = contentTermConflictKey(term)
    const existing = seen.get(key)
    if (existing) {
      const message = existing === term
        ? layoutValidationMessages.duplicateEntry(`content ${term}`)
        : layoutValidationMessages.conflictingEntries(`content ${existing}`, `content ${term}`)
      ctx.error(message, entry)
      return
    }
    seen.set(key, term)
  }
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

function layoutEntryConflictKeys(entry: AST.LayoutEntry): readonly LayoutConflictKey[] {
  const head = layoutEntryHead(entry)
  const headValue = head ? layoutHeadValue(head) : undefined
  if (!headValue) {
    return []
  }
  return Switch(headValue, {
    'content': () => ['content'],
    'gap': () => ['gap'],
    'pad': () => ['pad'],
    'width': () => ['width'],
    'height': () => ['height'],
    'hug': () => ['main-size-pressure'],
    'fill': () => ['main-size-pressure', 'self-alignment'],
    'compress': () => ['compression-pressure'],
    'rigid': () => ['compression-pressure'],
    'aligned': () => ['self-alignment'],
    'centered': () => ['self-alignment'],
  })
}

const layoutHeads = [
  'aligned',
  'centered',
  'compress',
  'content',
  'fill',
  'gap',
  'height',
  'hug',
  'pad',
  'rigid',
  'width',
] as const

type LayoutHead = (typeof layoutHeads)[number]

function layoutHeadValue(head: AST.LayoutWord): LayoutHead | undefined {
  return layoutWordValue(head, layoutHeads)
}

function layoutEntryHead(entry: AST.LayoutEntry): AST.LayoutWord | undefined {
  return AST.isLayoutWord(entry.head) ? entry.head : undefined
}

function layoutEntryText(entry: AST.LayoutEntry): string {
  return ASTUtils.Layout.entryValues(entry).join(' ')
}

function layoutEntryHeadText(entry: AST.LayoutEntry): string {
  return String(ASTUtils.Layout.termValue(entry.head))
}

function layoutTermText(term: AST.LayoutTerm): string {
  return String(ASTUtils.Layout.termValue(term))
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

import { AST, Parser } from '@parser'
import { Switch } from '@shared'

/** StudioDesignSourceRange is a zero-based, half-open range in authored Tao source. */
type StudioDesignSourceRange = Readonly<{ from: number; to: number }>

/** StudioDesignPaddingDelta describes one source-preserving numeric pad edit in a design bundle. */
export type StudioDesignPaddingDelta = Readonly<{
  designName: string
  bundleName: string
  expectedPadding: number
  padding: number
  entryIndex: number
  ownerKind: 'legacy' | 'styles' | 'text'
  oldLiteralRange: StudioDesignSourceRange
  newLiteralRange: StudioDesignSourceRange
  oldSpecRange: StudioDesignSourceRange
  newSpecRange: StudioDesignSourceRange
}>

type DesignSpecOwner = Readonly<{
  bundleName: string
  ownerKind: StudioDesignPaddingDelta['ownerKind']
  spec: AST.LayoutClause
}>

type NumberEntry = Readonly<{
  designName: string
  owner: DesignSpecOwner
  entryIndex: number
  value: number
  literalRange: StudioDesignSourceRange
  specRange: StudioDesignSourceRange
}>

// A source edit usually keeps the previous side as its baseline over several keystrokes. Cache
// syntax-only ASTs for a few exact snapshots so callers can reuse that baseline without retaining
// mutable parser state or introducing any linking, module loading, or filesystem work.
const syntaxCache = new Map<string, AST.TaoFile | undefined>()
const syntaxCacheLimit = 4

/**
 * Compute one constant scalar-padding edit between two Tao design source snapshots.
 *
 * Only the numeric literal in an unconditional `[pad NUMBER]` entry can differ. Every byte before
 * and after that literal must match, so unrelated declarations, comments, imports, and edits cannot
 * be mistaken for a padding adjustment.
 */
export function computeStudioDesignPaddingDelta(
  before: string,
  after: string,
): StudioDesignPaddingDelta | undefined {
  const oldFile = syntaxFile(before)
  const newFile = syntaxFile(after)
  if (oldFile === undefined || newFile === undefined) {
    return undefined
  }

  const oldDesigns = designSpecs(oldFile)
  const newDesigns = designSpecs(newFile)
  if (oldDesigns === undefined || newDesigns === undefined || oldDesigns.length !== newDesigns.length) {
    return undefined
  }

  const oldEntries = oldDesigns.flatMap(({ designName, owners }) =>
    owners.flatMap(owner => numberEntries(designName, owner))
  )
  const newEntries = newDesigns.flatMap(({ designName, owners }) =>
    owners.flatMap(owner => numberEntries(designName, owner))
  )
  const newByIdentity = new Map(newEntries.map(entry => [entryKey(entry), entry] as const))
  if (newByIdentity.size !== newEntries.length || oldEntries.length !== newEntries.length) {
    return undefined
  }

  const candidates: { oldEntry: NumberEntry; newEntry: NumberEntry; designName: string }[] = []
  for (const oldEntry of oldEntries) {
    const newEntry = newByIdentity.get(entryKey(oldEntry))
    if (newEntry === undefined) {
      return undefined
    }
    if (
      oldEntry.value !== newEntry.value
      && preservesOutsideLiteral(before, oldEntry.literalRange, after, newEntry.literalRange)
    ) {
      candidates.push({ oldEntry, newEntry, designName: oldEntry.designName })
    }
  }

  if (candidates.length !== 1) {
    return undefined
  }
  const candidate = candidates[0]!
  if (candidate.designName.length === 0 || candidate.oldEntry.owner.bundleName.length === 0) {
    return undefined
  }

  return Object.freeze({
    designName: candidate.designName,
    bundleName: candidate.oldEntry.owner.bundleName,
    expectedPadding: candidate.oldEntry.value,
    padding: candidate.newEntry.value,
    entryIndex: candidate.oldEntry.entryIndex,
    ownerKind: candidate.oldEntry.owner.ownerKind,
    oldLiteralRange: freezeRange(candidate.oldEntry.literalRange),
    newLiteralRange: freezeRange(candidate.newEntry.literalRange),
    oldSpecRange: freezeRange(candidate.oldEntry.specRange),
    newSpecRange: freezeRange(candidate.newEntry.specRange),
  })
}

function syntaxFile(source: string): AST.TaoFile | undefined {
  if (syntaxCache.has(source)) {
    const cached = syntaxCache.get(source)
    syntaxCache.delete(source)
    syntaxCache.set(source, cached)
    return cached
  }
  const parsed = Parser.parseSyntax(source)
  const file = parsed.errors === 0 && AST.isTaoFile(parsed.ast) ? parsed.ast : undefined
  syntaxCache.set(source, file)
  if (syntaxCache.size > syntaxCacheLimit) {
    const oldest = syntaxCache.keys().next().value as string | undefined
    if (oldest !== undefined) {
      syntaxCache.delete(oldest)
    }
  }
  return file
}

function designSpecs(
  file: AST.TaoFile,
): readonly Readonly<{ designName: string; owners: readonly DesignSpecOwner[] }>[] | undefined {
  const declarations = file.statements.filter(AST.isDesignDeclaration)
  const designNames = new Set<string>()
  const designs: { designName: string; owners: DesignSpecOwner[] }[] = []
  for (const declaration of declarations) {
    if (designNames.has(declaration.name)) {
      return undefined
    }
    designNames.add(declaration.name)

    const owners: DesignSpecOwner[] = []
    const bundleNames = new Set<string>()
    for (const member of declaration.block.members) {
      Switch.type(member, {
        DesignBundle: entry => {
          owners.push({ bundleName: entry.name, ownerKind: 'legacy', spec: entry.spec })
        },
        DesignStylesBlock: block => {
          owners.push(
            ...block.entries.map(entry => ({ bundleName: entry.name, ownerKind: 'styles' as const, spec: entry.spec })),
          )
        },
        DesignTextBlock: block => {
          owners.push(
            ...block.entries.map(entry => ({ bundleName: entry.name, ownerKind: 'text' as const, spec: entry.spec })),
          )
        },
        DesignColorsBlock: Switch.nothing,
        DesignScreensBlock: Switch.nothing,
        DesignSizesBlock: Switch.nothing,
        DesignToken: Switch.nothing,
      })
    }
    for (const owner of owners) {
      if (bundleNames.has(owner.bundleName)) {
        return undefined
      }
      bundleNames.add(owner.bundleName)
    }
    designs.push({ designName: declaration.name, owners })
  }
  return designs
}

function numberEntries(designName: string, owner: DesignSpecOwner): NumberEntry[] {
  const specRange = rangeOf(owner.spec)
  if (specRange === undefined) {
    return []
  }
  return owner.spec.entries.flatMap((entry, entryIndex) => {
    if (
      !AST.isLayoutWord(entry.head)
      || entry.head.value !== 'pad'
      || entry.terms.length !== 1
      || entry.condition !== undefined
      || !AST.isLayoutNumberLiteral(entry.terms[0])
    ) {
      return []
    }
    const term = entry.terms[0]
    const literalRange = rangeOf(term)
    const value = term.value
    if (literalRange === undefined || !Number.isFinite(value) || value < 0) {
      return []
    }
    return [{ designName, owner, entryIndex, value, literalRange, specRange }]
  })
}

function entryKey(entry: NumberEntry): string {
  return `${entry.designName}\u0000${entry.owner.ownerKind}\u0000${entry.owner.bundleName}\u0000${entry.entryIndex}`
}

function rangeOf(node: AST.Node): StudioDesignSourceRange | undefined {
  const cst = node.$cstNode
  return cst === undefined ? undefined : { from: cst.offset, to: cst.end }
}

function preservesOutsideLiteral(
  before: string,
  oldRange: StudioDesignSourceRange,
  after: string,
  newRange: StudioDesignSourceRange,
): boolean {
  return before.slice(0, oldRange.from) === after.slice(0, newRange.from)
    && before.slice(oldRange.to) === after.slice(newRange.to)
}

function freezeRange(range: StudioDesignSourceRange): StudioDesignSourceRange {
  return Object.freeze({ from: range.from, to: range.to })
}

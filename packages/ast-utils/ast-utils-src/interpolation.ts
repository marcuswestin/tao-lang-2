import { AST } from '@parser'
import { Type } from './Type'

/** InterpolationSegment declares one piece of a Tao text literal. */
export type InterpolationSegment =
  | { kind: 'text'; text: string }
  | { kind: 'value'; path: readonly string[]; source: string }

/** ResolvedInterpolation declares an interpolated name resolved against the enclosing scope. */
export type ResolvedInterpolation = {
  segment: Extract<InterpolationSegment, { kind: 'value' }>
  declaration?: AST.ValueDeclaration
  type: ReturnType<typeof Type.ofExpression>
}

// Built per call: a shared global regex would carry `lastIndex` between scans.
function interpolationPattern(): RegExp {
  return /\{([^{}]*)\}/g
}

/** interpolationSegments splits a Tao string literal's value into text and interpolated names. */
export function interpolationSegments(literal: AST.StringLiteral): InterpolationSegment[] {
  const raw = literalText(literal)
  const segments: InterpolationSegment[] = []
  let index = 0
  for (const match of raw.matchAll(interpolationPattern())) {
    const start = match.index
    if (start > index) {
      segments.push({ kind: 'text', text: raw.slice(index, start) })
    }
    const source = match[1] ?? ''
    segments.push({ kind: 'value', path: source.trim().split('.').map(part => part.trim()), source: source.trim() })
    index = start + match[0].length
  }
  if (index < raw.length) {
    segments.push({ kind: 'text', text: raw.slice(index) })
  }
  return segments
}

/** hasInterpolation returns true when a string literal contains at least one `{...}` segment. */
export function hasInterpolation(literal: AST.StringLiteral): boolean {
  return interpolationPattern().test(literalText(literal))
}

/** resolveInterpolation resolves one interpolated name path against the scope visible at `literal`. */
export function resolveInterpolation(
  literal: AST.StringLiteral,
  segment: Extract<InterpolationSegment, { kind: 'value' }>,
): ResolvedInterpolation {
  const [root, ...members] = segment.path
  const declaration = root ? visibleValueDeclaration(literal, root) : undefined
  if (!declaration) {
    return { segment, type: { kind: 'unresolved' } }
  }
  return { segment, declaration, type: Type.ofValuePath(declaration, members) }
}

/** visibleValueDeclaration finds the value declaration one name resolves to at `node`. */
export function visibleValueDeclaration(node: AST.Node, name: string): AST.ValueDeclaration | undefined {
  const owningAction = AST.findOwningAction(node)
  const actionParameter = owningAction
    ? AST.parametersOf(owningAction).find(parameter => Type.parameterName(parameter) === name)
    : undefined
  if (actionParameter) {
    return actionParameter
  }

  for (const block of AST.ancestorBlocks(node)) {
    const declaration = AST.valueDeclarationsOwnedByBlock(block).find(
      candidate => Type.declarationName(candidate) === name,
    )
    if (declaration) {
      return declaration
    }
  }

  const owningView = AST.findOwningView(node)
  const viewParameter = owningView
    ? AST.parametersOf(owningView).find(parameter => Type.parameterName(parameter) === name)
    : undefined
  if (viewParameter) {
    return viewParameter
  }

  const root = AST.findRoot(node)
  if (!AST.isTaoFile(root)) {
    return undefined
  }
  return AST.importableValueDeclarationsInFile(root).find(
    candidate => Type.declarationName(candidate) === name,
  )
}

// A literal's `value` keeps its source quotes; interpolation scans the text between them.
function literalText(literal: AST.StringLiteral): string {
  return literal.value
}

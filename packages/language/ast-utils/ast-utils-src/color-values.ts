import { AST } from '@parser'
import { design } from './design'
import { Type } from './Type'

const colorHeads = new Set<string>(design.colorHeads)

/**
 * clauseValueRead returns the Capitalized word a color head reads as a value (`background Tint`).
 * Design names are lowercase and values Capitalized (Decisions §13), so the case alone separates a
 * value read from a design color name.
 */
function clauseValueRead(entry: AST.LayoutEntry): AST.LayoutWord | undefined {
  const [term, ...rest] = entry.terms
  return AST.isLayoutWord(entry.head) && colorHeads.has(entry.head.value) && rest.length === 0
      && AST.isLayoutWord(term) && isCapitalizedWord(term)
    ? term
    : undefined
}

/** standaloneClauseValue returns a Capitalized word written as a whole clause entry, with no head. */
function standaloneClauseValue(entry: AST.LayoutEntry): AST.LayoutWord | undefined {
  return entry.terms.length === 0 && AST.isLayoutWord(entry.head) && isCapitalizedWord(entry.head)
    ? entry.head
    : undefined
}

/**
 * clauseValueNamed finds the value a clause word names, nearest declaration first: the enclosing
 * blocks' values and loop bindings, a branch payload, the owning declaration's parameters, then the
 * file's visible values. A clause is not an expression, so it has no linked reference to read.
 */
function clauseValueNamed(node: AST.Node, name: string): AST.ValueDeclaration | undefined {
  for (let current = node.$container; current !== undefined; current = current.$container) {
    const local = localValues(current).find(declaration => Type.declarationName(declaration) === name)
    if (local !== undefined) {
      return local
    }
  }
  return AST.visibleValueDeclarations(node, isDeclaredValue).find(declaration => declaration.name === name)
}

/** isColorValue says whether a value declaration carries a `color`. */
function isColorValue(declaration: AST.ValueDeclaration): boolean {
  const type = Type.ofValueDeclaration(declaration)
  return type.kind === 'primitive' && type.primitive === 'color'
}

function localValues(node: AST.Node): readonly AST.ValueDeclaration[] {
  if (AST.isBlock(node)) {
    const binding = AST.forBindingOwnedByBlock(node)
    return [...AST.valueDeclarationsOwnedByBlock(node), ...(binding === undefined ? [] : [binding])]
  }
  if ((AST.isGuardRenderBranch(node) || AST.isWhenRenderBranch(node)) && node.payload !== undefined) {
    return [node.payload]
  }
  if (AST.isParameterizedDeclaration(node)) {
    return AST.parametersOf(node)
  }
  if (AST.isAppDeclaration(node)) {
    return node.block?.statements.filter(AST.isStateDeclaration) ?? []
  }
  return []
}

function isDeclaredValue(candidate: unknown): candidate is AST.Declaration & AST.ValueDeclaration {
  return AST.isDeclaration(candidate) && AST.isValueDeclaration(candidate)
}

function isCapitalizedWord(word: AST.LayoutWord): boolean {
  return /^[A-Z]/.test(word.value)
}

/** colorValues groups the helpers that read a `color` value out of a clause list. */
export const colorValues = {
  clauseValueNamed,
  clauseValueRead,
  isColorValue,
  standaloneClauseValue,
} as const

import { AST, Langium } from '@tao/parser'

/** Compiled declares generated source text. */
export type Compiled = string

/** refResolved returns a linked cross-reference target or throws a compiler error. */
export function refResolved<T extends AST.Node>(ref: Langium.Reference<T>, label: string): T {
  const target = ref.ref
  if (target === undefined) {
    throw new Error(`Could not resolve ${label}: ${ref.$refText}.`)
  }
  return target
}

/** indent indents every non-empty generated source line by `spaces`. */
export function indent(lines: readonly string[] | string, spaces = 2): string[] {
  const text = typeof lines === 'string' ? lines.split('\n') : lines
  const prefix = ' '.repeat(spaces)
  return text.map(line => line.length === 0 ? line : `${prefix}${line}`)
}

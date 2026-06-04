import { AST, Langium } from '@parser'

/** Compiled declares a structured generated source node. */
export type Compiled = Langium.GeneratorNode

/** GenValue declares values accepted inside generated source template substitutions. */
type GenValue = Langium.Generated | number | boolean | null

/** GenListOptions declares line-separation options for generated AST node lists. */
type GenListOptions = {
  newLines?: true | 1 | 2 | 3 | 4 | 5 | 6
}

/** gen expands a source template into a structured generator node. */
export function gen(staticParts: TemplateStringsArray, ...substitutions: GenValue[]): Compiled {
  return Langium.expandToNode(staticParts, ...substitutions)
}

/** genNoop returns an empty structured generator node. */
export function genNoop(): Compiled {
  return new Langium.CompositeGeneratorNode()
}

/** genList compiles AST node lists into a generator node with non-empty items separated by new lines. */
export function genList<NodeT extends AST.Node>(
  nodes: Iterable<NodeT>,
  compileItem: (node: NodeT) => GenValue,
  options: GenListOptions = {},
): GenValue {
  return Langium.joinToNode(
    nodes,
    node => gen`${compileItem(node)}`,
    { appendNewLineIfNotEmpty: options.newLines ?? true },
  )
}

/** refResolved returns a linked cross-reference target or throws a compiler error. */
export function refResolved<T extends AST.Node>(ref: Langium.Reference<T>, label: string): T {
  const target = ref.ref
  if (target === undefined) {
    throw new Error(`Could not resolve ${label}: ${ref.$refText}.`)
  }
  return target
}

import { AST, Langium } from '@parser'
import { Assert } from '@shared'

/** Compiled declares a structured generated source node. */
export type Compiled = Langium.GeneratorNode

/** GenValue declares values accepted inside generated source template substitutions. */
type GenValue = Langium.Generated | number | boolean | null

/** GenListOptions declares line-separation options for generated AST node lists. */
type GenListOptions = {
  newLines?: true | 1 | 2 | 3 | 4 | 5 | 6
}

/** GenJoinOptions declares short separator and non-empty wrapper options. */
type GenJoinOptions = {
  prefix?: string
  separator?: string
  suffix?: string
}

/** NamedNode declares an AST node or semantic value with a source-level name. */
type NamedNode = {
  name: string
}

/** gen expands a source template into a structured generator node. */
export function gen(staticParts: TemplateStringsArray, ...substitutions: GenValue[]): Compiled {
  return Langium.expandToNode(staticParts, ...substitutions)
}

/** genNoop returns an empty structured generator node. */
export function genNoop(): Compiled {
  return new Langium.CompositeGeneratorNode()
}

/** genName compiles a named node's name as a generated code name token. */
export function genName(node: NamedNode): Compiled {
  return gen`${node.name}`
}

/** genNameLiteral compiles a named node's name as a JavaScript string literal. */
export function genNameLiteral(node: NamedNode): Compiled {
  return gen`${JSON.stringify(node.name)}`
}

/** genTextLines expands raw multiline text as structured generator lines. */
export function genTextLines(text: string): GenValue {
  return Langium.joinToNode(
    text.split('\n'),
    line => gen`${line}`,
    { appendNewLineIfNotEmpty: true },
  )
}

/** genJoin compiles item lists into a generator node separated by a short separator. */
export function genJoin<ItemT>(
  items: Iterable<ItemT>,
  compileItem: (item: ItemT) => GenValue,
  options: GenJoinOptions = {},
): GenValue {
  const itemList = Array.from(items)
  if (itemList.length === 0) {
    return genNoop()
  }

  const joined = Langium.joinToNode(
    itemList,
    item => gen`${compileItem(item)}`,
    { separator: options.separator ?? ', ' },
  )
  return gen`${options.prefix ?? ''}${joined}${options.suffix ?? ''}`
}

/** genList compiles item lists into a generator node with non-empty items separated by new lines. */
export function genList<ItemT>(
  items: Iterable<ItemT>,
  compileItem: (item: ItemT) => GenValue,
  options: GenListOptions = {},
): GenValue {
  return Langium.joinToNode(
    items,
    item => gen`${compileItem(item)}`,
    { appendNewLineIfNotEmpty: options.newLines ?? true },
  )
}

/** resolveRef returns a linked cross-reference target from a validated AST. */
export function resolveRef<T extends AST.Node>(ref: Langium.Reference<T>, label: string): T {
  const target = ref.ref
  Assert.defined(target, `validated ${label} is resolved`, { refText: ref.$refText })
  return target
}

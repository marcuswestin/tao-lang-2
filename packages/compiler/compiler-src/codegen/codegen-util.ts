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
  separator?: string
}

type AnyBlockStatement = AST.ActionStatement | AST.ProjectStatement | AST.Statement
type GenTemplate = (staticParts: TemplateStringsArray, ...substitutions: GenValue[]) => Compiled
type Gen = GenTemplate & {
  block: typeof genBlock
  comment: typeof genComment
  join: typeof genJoin
  list: typeof genList
  name: typeof genName
  nameLiteral: typeof genNameLiteral
  noop: typeof genNoop
  scopeName: typeof genScopeName
  textLines: typeof genTextLines
}

/** NamedNode declares an AST node or semantic value with a source-level name. */
type NamedNode = {
  name: string
}

/** genTemplate expands source templates. */
function genTemplate(staticParts: TemplateStringsArray, ...substitutions: GenValue[]): Compiled {
  return Langium.expandToNode(staticParts, ...substitutions)
}

/** genNoop returns an empty structured generator node. */
function genNoop(): Compiled {
  return new Langium.CompositeGeneratorNode()
}

/** genComment compiles one line comment into a structured generator node. */
function genComment(text: string): Compiled {
  return gen`// ${text}`
}

/** genName compiles a named node's name as a generated code name token. */
function genName(node: NamedNode): Compiled {
  return gen`${node.name}`
}

/** genScopeName compiles a named value declaration as a generated scope property. */
function genScopeName(node: NamedNode): Compiled {
  return gen`_Scope.${genName(node)}`
}

/** genNameLiteral compiles a named node's name as a JavaScript string literal. */
function genNameLiteral(node: NamedNode): Compiled {
  return gen`${JSON.stringify(node.name)}`
}

/** genTextLines expands raw multiline generator lines. */
function genTextLines(text: string): GenValue {
  return Langium.joinToNode(
    text.split('\n'),
    line => gen`${line}`,
    { appendNewLineIfNotEmpty: true },
  )
}

/** genJoin compiles item lists into a generator node separated by a short separator. */
function genJoin<ItemT>(
  items: Iterable<ItemT>,
  compileItem: (item: ItemT) => GenValue,
  options: GenJoinOptions = {},
): Compiled {
  const itemList = Array.from(items)
  return Langium.joinToNode(
    itemList,
    item => gen`${compileItem(item)}`,
    { separator: options.separator ?? ', ' },
  ) ?? genNoop()
}

/** genList compiles item lists into a generator node with non-empty items separated by new lines. */
function genList<ItemT>(
  items: Iterable<ItemT>,
  compileItem: (item: ItemT) => GenValue,
  options: GenListOptions = {},
): Compiled {
  return Langium.joinToNode(
    items,
    item => gen`${compileItem(item)}`,
    { appendNewLineIfNotEmpty: options.newLines ?? true },
  ) ?? genNoop()
}

function genBlock(
  owner: AST.ActionDeclaration | AST.ActionExpression,
  compileStatement: (statement: AST.ActionStatement) => GenValue,
  options?: GenListOptions,
): Compiled
function genBlock(
  owner: AST.AppDeclaration | AST.Render | AST.RenderableDeclaration,
  compileStatement: (statement: AST.Statement) => GenValue,
  options?: GenListOptions,
): Compiled
function genBlock(
  owner: AST.ProjectDeclaration,
  compileStatement: (statement: AST.ProjectStatement) => GenValue,
  options?: GenListOptions,
): Compiled
/** genBlock compiles statements from a node-owned Tao block with statement-type-safe compilers. */
function genBlock(
  owner: AST.BlockStatementOwner,
  compileStatement: (statement: never) => GenValue,
  options?: GenListOptions,
): Compiled {
  const statements = AST.blockStatements(owner) as AnyBlockStatement[]
  const compileBlockStatement = compileStatement as (statement: AnyBlockStatement) => GenValue
  return genList(statements, compileBlockStatement, options)
}

const genWithHelpers = genTemplate as Gen
Object.defineProperties(genWithHelpers, {
  block: { value: genBlock },
  comment: { value: genComment },
  join: { value: genJoin },
  list: { value: genList },
  name: { value: genName },
  nameLiteral: { value: genNameLiteral },
  noop: { value: genNoop },
  scopeName: { value: genScopeName },
  textLines: { value: genTextLines },
})

/** gen expands source templates and owns generator helper functions. */
export const gen = genWithHelpers

/** resolveRef returns a linked cross-reference target from a validated AST. */
export function resolveRef<T extends AST.Node>(ref: Langium.Reference<T>): T {
  const target = ref.ref
  Assert.defined(target, 'validated reference is resolved', { refText: ref.$refText })
  return target
}

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
type JsLiteralValue = string | number | readonly JsLiteralValue[]
type GenBlock = {
  (
    owner: AST.ActionDeclaration | AST.ActionExpression,
    compileStatement: (statement: AST.ActionStatement) => GenValue,
    options?: GenListOptions,
  ): Compiled
  (
    owner: AST.AppDeclaration | AST.Render | AST.RenderableDeclaration,
    compileStatement: (statement: AST.Statement) => GenValue,
    options?: GenListOptions,
  ): Compiled
  (
    owner: AST.ProjectDeclaration,
    compileStatement: (statement: AST.ProjectStatement) => GenValue,
    options?: GenListOptions,
  ): Compiled
}

/** NamedNode declares an AST node or semantic value with a source-level name. */
type NamedNode = {
  name: string
}

let _gen = {} as {
  tag: (staticParts: TemplateStringsArray, ...substitutions: GenValue[]) => Compiled
  template: (staticParts: TemplateStringsArray, ...substitutions: GenValue[]) => Compiled
  noop: () => Compiled
  comment: (text: string) => Compiled
  Name: (node: NamedNode) => Compiled
  scopeName: (node: NamedNode) => Compiled
  jsLiteral: (value: JsLiteralValue) => string
  nameLiteral: (node: NamedNode) => Compiled
  textLines: (text: string) => GenValue
  join: <ItemT>(
    items: Iterable<ItemT>,
    compileItem: (item: ItemT) => GenValue,
    options?: GenJoinOptions,
  ) => Compiled
  list: <ItemT>(
    items: Iterable<ItemT>,
    compileItem: (item: ItemT) => GenValue,
    options?: GenListOptions,
  ) => Compiled
  block: GenBlock
}

_gen.tag = function genTag(staticParts: TemplateStringsArray, ...substitutions: GenValue[]): Compiled {
  return _gen.template(staticParts, ...substitutions)
}

_gen.template = function genTemplate(staticParts: TemplateStringsArray, ...substitutions: GenValue[]): Compiled {
  return Langium.expandToNode(staticParts, ...substitutions)
}

_gen.noop = function genNoop(): Compiled {
  return new Langium.CompositeGeneratorNode()
}

_gen.comment = function genComment(text: string): Compiled {
  return _gen.tag`// ${text}`
}

_gen.Name = function genName(node: NamedNode): Compiled {
  return _gen.tag`${node.name}`
}

_gen.scopeName = function genScopeName(node: NamedNode): Compiled {
  return _gen.tag`_Scope.${_gen.Name(node)}`
}

_gen.jsLiteral = function genJsLiteral(value: JsLiteralValue): string {
  const literal = JSON.stringify(value)
  Assert.defined(literal, 'codegen JavaScript literal is serializable', { value })
  return literal
}

_gen.nameLiteral = function genNameLiteral(node: NamedNode): Compiled {
  return _gen.tag`${_gen.jsLiteral(node.name)}`
}

_gen.textLines = function genTextLines(text: string): GenValue {
  return Langium.joinToNode(
    text.split('\n'),
    line => _gen.tag`${line}`,
    { appendNewLineIfNotEmpty: true },
  )
}

/** gen.join compiles separated iterable items and emits no output when the iterable is empty. */
_gen.join = function genJoin<ItemT>(
  items: Iterable<ItemT>,
  compileItem: (item: ItemT) => GenValue,
  options: GenJoinOptions = {},
): Compiled {
  const itemList = Array.from(items)
  return Langium.joinToNode(
    itemList,
    item => _gen.tag`${compileItem(item)}`,
    { separator: options.separator ?? ', ' },
  ) ?? _gen.noop()
}

/** gen.list compiles iterable items as lines and emits no output when the iterable is empty. */
_gen.list = function genList<ItemT>(
  items: Iterable<ItemT>,
  compileItem: (item: ItemT) => GenValue,
  options: GenListOptions = {},
): Compiled {
  return Langium.joinToNode(
    items,
    item => _gen.tag`${compileItem(item)}`,
    { appendNewLineIfNotEmpty: options.newLines ?? true },
  ) ?? _gen.noop()
}

_gen.block = (function genBlock(
  owner: AST.BlockStatementOwner,
  compileStatement: (statement: never) => GenValue,
  options?: GenListOptions,
): Compiled {
  const statements = AST.blockStatements(owner) as AnyBlockStatement[]
  const compileBlockStatement = compileStatement as (statement: AnyBlockStatement) => GenValue
  return _gen.list(statements, compileBlockStatement, options)
}) as GenBlock

/** gen expands source templates and owns generator helper functions. */
export const gen = Object.assign(_gen.tag, {
  template: _gen.template,
  noop: _gen.noop,
  comment: _gen.comment,
  Name: _gen.Name,
  scopeName: _gen.scopeName,
  jsLiteral: _gen.jsLiteral,
  nameLiteral: _gen.nameLiteral,
  textLines: _gen.textLines,
  join: _gen.join,
  list: _gen.list,
  block: _gen.block,
})

/** resolveRef returns a linked cross-reference target from a validated AST. */
export function resolveRef<T extends AST.Node>(ref: Langium.Reference<T>): T {
  const target = ref.ref
  Assert.defined(target, 'validated reference is resolved', { refText: ref.$refText })
  return target
}

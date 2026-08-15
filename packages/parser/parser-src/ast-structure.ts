import { Langium } from './langium-exports'
import * as AST from './parserASTExport'

/** DeclarationNamespace identifies the independent declaration table a name occupies. */
export type DeclarationNamespace = 'type' | 'value'

const resolvedUseTargets = new WeakMap<AST.UseStatement, readonly AST.Declaration[]>()

/** declarationNamespace classifies declarations by the reference contexts that can resolve them. */
export function declarationNamespace(declaration: AST.Declaration): DeclarationNamespace {
  return AST.isPrimitiveDeclaration(declaration)
      || AST.isTypeDeclaration(declaration)
      || AST.isConfigurableDeclaration(declaration)
    ? 'type'
    : 'value'
}

/** primitiveDeclaration finds one parsed intrinsic primitive in the loaded workspace. */
export function primitiveDeclaration(
  files: readonly AST.TaoFile[],
  name: AST.PrimitiveType,
): AST.PrimitiveDeclaration | undefined {
  return files.flatMap(file => file.statements.filter(AST.isPrimitiveDeclaration))
    .find(declaration => declaration.name === name)
}

/** primitiveSlots returns the pinned supplied-slot contract for one parsed primitive. */
export function primitiveSlots(
  files: readonly AST.TaoFile[],
  name: AST.PrimitiveType,
): readonly AST.TypeProperty[] {
  return primitiveDeclaration(files, name)?.slots?.properties ?? []
}

/** inferredAppPropertyDeclaration resolves a bare app slot block from its slot name and primitive role. */
export function inferredAppPropertyDeclaration(
  value: AST.InferredAppPropertyValue,
): AST.ConfigurableDeclaration | undefined {
  const owner = value.$container
  if (!AST.isAppNavigator(owner) && !AST.isAppDatasource(owner)) {
    return undefined
  }
  const root = findRoot(value)
  if (!AST.isTaoFile(root)) {
    return undefined
  }
  const candidates = [
    ...root.statements.filter(AST.isConfigurableDeclaration),
    ...root.statements.filter(AST.isUseStatement).flatMap(resolvedImportedDeclarations)
      .filter(AST.isConfigurableDeclaration),
  ].filter(declaration => declaration.name === owner.name)
    .filter(declaration =>
      AST.isAppNavigator(owner) ? AST.isNavDeclaration(declaration) : AST.isDatasourceDeclaration(declaration)
    )
  return candidates.length === 1 ? candidates[0] : undefined
}

/** declarationKey returns a namespace-qualified key suitable for collision checks. */
export function declarationKey(declaration: AST.Declaration): string {
  return `${declarationNamespace(declaration)}:${declaration.name}`
}

/** rememberUseTargets records every declaration visible through a use target before one Langium ref is chosen. */
export function rememberUseTargets(
  useStatement: AST.UseStatement,
  declarations: readonly AST.Declaration[],
): void {
  resolvedUseTargets.set(useStatement, declarations)
}

/** resolvedImportedDeclarations returns every requested declaration, preserving type/value namespace peers. */
export function resolvedImportedDeclarations(useStatement: AST.UseStatement): AST.Declaration[] {
  const names = new Set(useStatement.importedDeclarations.map(reference => reference.$refText))
  const declarations = resolvedUseTargets.get(useStatement)
    ?? useStatement.importedDeclarations.map(reference => reference.ref).filter(AST.isDeclaration)
  return declarations.filter(declaration => names.has(declaration.name))
}

type ArgumentListOwner =
  | AST.Render
  | AST.DoStatement
  | AST.FunctionCallExpression
  | AST.ContextualPresentStatement
  | AST.AskStatement
type BlockStatementFor<OwnerT extends AST.BlockStatementOwner> = OwnerT extends
  AST.ActionDeclaration | AST.ActionExpression ? AST.ActionStatement
  : OwnerT extends AST.AppDeclaration ? AST.AppStatement | AST.Statement
  : OwnerT extends AST.ProjectDeclaration ? AST.ProjectStatement
  : AST.Statement
type BlockStatementPredicate<InputT extends AST.OwnedBlockStatement, OutputT extends InputT> = (
  statement: InputT,
) => statement is OutputT
type BlockStatementFilter<StatementT extends AST.OwnedBlockStatement> = (statement: StatementT) => boolean
type BlockStatementMap<StatementT extends AST.OwnedBlockStatement, ValueT> = (statement: StatementT) => ValueT
type NodePredicate<NodeT extends AST.Node> = (node: AST.Node) => node is NodeT
/** findRoot returns the root AST node that owns `node`. */
export function findRoot(node: AST.Node): AST.Node {
  let current = node
  while (current.$container) {
    current = current.$container
  }
  return current
}

/** streamAllContents returns every descendant of `node` in document order. */
export function streamAllContents(node: AST.Node): AST.Node[] {
  return Langium.AstUtils.streamAllContents(node).toArray()
}

/** streamReferences returns every cross-reference declared directly by `node`. */
export function streamReferences(node: AST.Node): ReturnType<typeof Langium.AstUtils.streamReferences> {
  return Langium.AstUtils.streamReferences(node)
}

/** getDocument returns the parser document containing `node`. */
export function getDocument(node: AST.Node): AST.Document {
  return Langium.AstUtils.getDocument(node) as AST.Document
}

/** isNode returns true when `value` is a Tao AST node. */
export function isNode(value: unknown): value is AST.Node {
  return Langium.isAstNode(value)
}

/** ancestorBlocks returns the innermost-to-outermost block ancestors for `node`. */
export function ancestorBlocks(node: AST.Node): AST.Block[] {
  const blocks: AST.Block[] = []
  let current = node.$container
  while (current) {
    if (AST.isBlock(current)) {
      blocks.push(current)
    }
    current = current.$container
  }
  return blocks
}

/** importableValueDeclarationsInFile returns file-level value declarations visible to other files. */
export function importableValueDeclarationsInFile(
  file: AST.TaoFile,
): Array<AST.AliasDeclaration | AST.ActionDeclaration | AST.UiDeclaration | AST.EnumCase> {
  return [
    ...file.statements.filter(isImportableValueDeclaration),
    ...file.statements.filter(AST.isEnumDeclaration).flatMap(declaration => declaration.block.cases),
  ]
}

/** valueDeclarationsOwnedByBlock returns value declarations owned directly by `block`. */
export function valueDeclarationsOwnedByBlock(
  block: AST.Block,
): Array<AST.AliasDeclaration | AST.StateDeclaration | AST.EntityQueryDeclaration | AST.ActionDeclaration> {
  return [
    ...block.statements.filter(AST.isAliasDeclaration),
    ...block.statements.filter(AST.isStateDeclaration),
    ...block.statements.filter(AST.isEntityQueryDeclaration),
    ...block.statements.filter(AST.isActionDeclaration),
  ]
}

/** askDeclarationsOwnedByActionBlock returns dialogue results introduced directly by one action block. */
export function askDeclarationsOwnedByActionBlock(block: AST.ActionBlock): AST.AskStatement[] {
  return block.statements.filter(AST.isAskStatement)
}

/** forBindingOwnedByBlock returns the iteration binding visible inside a `for` body. */
export function forBindingOwnedByBlock(block: AST.Block): AST.ForStatement | undefined {
  return AST.isForStatement(block.$container) ? block.$container : undefined
}

/** attachedTag returns the tag statement immediately preceding a render or loop in its block. */
export function attachedTag(node: AST.Render | AST.ForStatement): AST.TagStatement | undefined {
  const block = node.$container
  if (!AST.isBlock(block)) {
    return undefined
  }
  const index = block.statements.indexOf(node)
  const previous = index > 0 ? block.statements[index - 1] : undefined
  return AST.isTagStatement(previous) ? previous : undefined
}

/** taggedLoopRowRoot returns the sole unconditional direct row-root render required by tagged loops. */
export function taggedLoopRowRoot(loop: AST.ForStatement): AST.Render | undefined {
  const renderers = loop.block.statements.filter(statement =>
    AST.isRender(statement)
    || AST.isWhenRenderStatement(statement)
    || AST.isGuardRenderStatement(statement)
    || AST.isIfRenderStatement(statement)
    || AST.isForStatement(statement)
  )
  return renderers.length === 1 && AST.isRender(renderers[0]) ? renderers[0] : undefined
}

/** testTagForRender resolves every tag represented by one concrete render root. */
export function testTagForRender(render: AST.Render): string | undefined {
  const direct = attachedTag(render)
  const block = render.$container
  const loop = AST.isBlock(block) && AST.isForStatement(block.$container) ? block.$container : undefined
  const loopTag = loop ? attachedTag(loop) : undefined
  const rowTag = loop && loopTag && taggedLoopRowRoot(loop) === render ? loopTag : undefined
  const tags = [rowTag, direct]
    .filter((tag): tag is AST.TagStatement => tag !== undefined)
    .map(tag => tag.tag.slice(1))
  const distinctTags = [...new Set(tags)]
  return distinctTags.length > 0 ? distinctTags.join(' ') : undefined
}

/** isImportableValueDeclaration returns true for value declarations that can be imported. */
export function isImportableValueDeclaration(
  node: AST.Node,
): node is AST.AliasDeclaration | AST.ActionDeclaration | AST.UiDeclaration {
  return AST.isAliasDeclaration(node) || AST.isActionDeclaration(node) || AST.isUiDeclaration(node)
}

/** configurationPropertiesOf returns the ordinary public properties declared by one nav/datasource. */
export function configurationPropertiesOf(
  declaration: AST.ConfigurableDeclaration,
): AST.ConfigurationPropertyDeclaration[] {
  return declaration.block.entries.filter(AST.isConfigurationPropertyDeclaration)
}

/** configurationKeyOf returns the optional keyed-item contract declared by one nav. */
export function configurationKeyOf(
  declaration: AST.ConfigurableDeclaration,
): AST.ConfigurationKeyDeclaration | undefined {
  return declaration.block.entries.find(AST.isConfigurationKeyDeclaration)
}

/** configurationImplementationOf returns the declaration's package-scope runtime binding. */
export function configurationImplementationOf(
  declaration: AST.ConfigurableDeclaration,
): AST.ConfigurationImplementation | undefined {
  return declaration.block.entries.find(AST.isConfigurationImplementation)
}

/** configurationPropertyIsKey identifies the keyed-item selector role without reserving `key` globally. */
export function configurationPropertyIsKey(property: AST.ConfigurationPropertyDeclaration): boolean {
  return AST.isNamedTypeReference(property.type)
    && property.type.root === 'key'
    && property.type.members.length === 0
}

/** PatchedValueReference is a declaration-linked immutable `value with { ... }` expression. */
export type PatchedValueReference = AST.ValueReference & { patchBlock: AST.ConfigurationBlock }

/** isPatchedValueReference identifies a `with` patch without name-table lookup. */
export function isPatchedValueReference(node: AST.Node): node is PatchedValueReference {
  return AST.isValueReference(node) && node.patchBlock !== undefined
}

/** AppVariantDeclaration is an alias whose initializer patches an app declaration identity. */
export type AppVariantDeclaration = AST.AliasDeclaration & { value: PatchedValueReference }

/** isAppVariantDeclaration identifies an immutable `App with { ... }` value declaration. */
export function isAppVariantDeclaration(node: AST.Node): node is AppVariantDeclaration {
  return AST.isAliasDeclaration(node) && appDeclarationOf(node) !== undefined
}

/** appDeclarationOf resolves an app or chained app variant to its original declaration identity. */
export function appDeclarationOf(
  node: AST.AppValueDeclaration | undefined,
  seen: Set<AST.AliasDeclaration> = new Set(),
): AST.AppDeclaration | undefined {
  if (AST.isAppDeclaration(node)) {
    return node
  }
  if (!AST.isAliasDeclaration(node) || seen.has(node) || !isPatchedValueReference(node.value)) {
    return undefined
  }
  seen.add(node)
  const base = node.value.target.ref
  return AST.isAppValueDeclaration(base) ? appDeclarationOf(base, seen) : undefined
}

/** appValueDeclarationsInFile returns concrete apps followed by immutable app variants. */
export function appValueDeclarationsInFile(file: AST.TaoFile): AST.AppValueDeclaration[] {
  return file.statements.flatMap(statement =>
    AST.isAppDeclaration(statement) || isAppVariantDeclaration(statement) ? [statement] : []
  )
}

/** enumOwningCase returns the declaration whose runtime identity owns one enum case. */
export function enumOwningCase(enumCase: AST.EnumCase): AST.EnumDeclaration {
  return enumCase.$container.$container
}

/** parametersOf returns the parameters declared by a renderable or action declaration. */
export function parametersOf(declaration: AST.ParameterizedDeclaration): AST.ParameterDeclaration[] {
  return declaration.parameterList?.parameters ?? []
}

/** argumentsOf returns the arguments provided by a render or action invocation. */
export function argumentsOf(node: ArgumentListOwner): AST.Argument[] {
  return node.argumentList?.arguments ?? []
}

/** injectionArgumentsOf returns the arguments declared by an injection block. */
export function injectionArgumentsOf(injection: AST.Injection): AST.InjectionArgument[] {
  return injection.argumentList?.arguments ?? []
}

/** layoutEntriesOf returns layout entries declared by an optional layout clause. */
export function layoutEntriesOf(layoutClause: AST.LayoutClause | undefined): AST.LayoutEntry[] {
  return layoutClause?.entries ?? []
}

/** statementsOf returns a block's statements, or an empty list when no block exists. */
export function statementsOf(block: AST.Block | undefined): AST.Statement[] {
  return block?.statements || []
}

/**
 * blockStatementOf returns or derives statements from a node-owned block.
 * Index and find selectors require a match and throw when no statement is found.
 */
export function blockStatementOf<OwnerT extends AST.BlockStatementOwner>(
  owner: OwnerT,
  index: number,
): BlockStatementFor<OwnerT>
export function blockStatementOf<
  OwnerT extends AST.BlockStatementOwner,
  StatementT extends BlockStatementFor<OwnerT>,
>(
  owner: OwnerT,
  options: { find: BlockStatementPredicate<BlockStatementFor<OwnerT>, StatementT> },
): StatementT
export function blockStatementOf<OwnerT extends AST.BlockStatementOwner>(
  owner: OwnerT,
  options: { find: BlockStatementFilter<BlockStatementFor<OwnerT>> },
): BlockStatementFor<OwnerT>
export function blockStatementOf<
  OwnerT extends AST.BlockStatementOwner,
  StatementT extends BlockStatementFor<OwnerT>,
>(
  owner: OwnerT,
  options: { filter: BlockStatementPredicate<BlockStatementFor<OwnerT>, StatementT> },
): StatementT[]
export function blockStatementOf<OwnerT extends AST.BlockStatementOwner>(
  owner: OwnerT,
  options: { filter: BlockStatementFilter<BlockStatementFor<OwnerT>> },
): BlockStatementFor<OwnerT>[]
export function blockStatementOf<
  OwnerT extends AST.BlockStatementOwner,
  ValueT,
>(
  owner: OwnerT,
  options: { map: BlockStatementMap<BlockStatementFor<OwnerT>, ValueT> },
): ValueT[]
export function blockStatementOf<StatementT extends AST.OwnedBlockStatement, ValueT>(
  owner: AST.BlockStatementOwner,
  selector:
    | number
    | { filter: BlockStatementFilter<StatementT> }
    | { find: BlockStatementFilter<StatementT> }
    | { map: BlockStatementMap<StatementT, ValueT> },
): AST.OwnedBlockStatement | StatementT | StatementT[] | ValueT[] {
  const statements = blockStatements(owner) as StatementT[]
  if (typeof selector === 'number') {
    const statement = statements[selector]
    if (!statement) {
      throw new Error(`Expected block statement at index ${selector}.`)
    }
    return statement
  }
  if ('find' in selector) {
    const statement = statements.find(selector.find)
    if (!statement) {
      throw new Error('Expected matching block statement.')
    }
    return statement
  }
  if ('filter' in selector) {
    return statements.filter(selector.filter)
  }
  return statements.map(selector.map)
}

export function blockStatements(owner: AST.BlockStatementOwner): readonly AST.OwnedBlockStatement[] {
  return (owner.block?.statements || []) as readonly AST.OwnedBlockStatement[]
}

/** findOwningView returns the renderable declaration that owns `node`, if any. */
export function findOwningView(node: AST.Node): AST.VisualDeclaration | undefined {
  return findAncestor(node, AST.isVisualDeclaration)
}

/** findOwningAction returns the action declaration that owns `node`, if any. */
export function findOwningAction(node: AST.Node): AST.ActionDeclaration | undefined {
  return findAncestor(node, AST.isActionDeclaration)
}

/** findOwningFunction returns the pure function declaration that owns `node`, if any. */
export function findOwningFunction(node: AST.Node): AST.FunctionDeclaration | undefined {
  return findAncestor(node, AST.isFunctionDeclaration)
}

/** findOwningActionBlock returns the named or inline action block that owns `node`, if any. */
export function findOwningActionBlock(node: AST.Node): AST.ActionBlock | undefined {
  return findAncestor(node, AST.isActionBlock)
}

/** findOwningAlias returns the alias declaration that owns `node`, if any. */
export function findOwningAlias(node: AST.Node): AST.AliasDeclaration | undefined {
  return findAncestor(node, AST.isAliasDeclaration)
}

/** findOwningState returns the state declaration that owns `node`, if any. */
export function findOwningState(node: AST.Node): AST.StateDeclaration | undefined {
  return findAncestor(node, AST.isStateDeclaration)
}

function findAncestor<NodeT extends AST.Node>(node: AST.Node, predicate: NodePredicate<NodeT>): NodeT | undefined {
  let current = node.$container
  while (current) {
    if (predicate(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

import { Langium } from './langium-exports'
import * as AST from './parserASTExport'

/** DeclarationNamespace identifies the independent declaration table a name occupies. */
export type DeclarationNamespace = 'type' | 'value'

const resolvedUseTargets = new WeakMap<AST.UseStatement, readonly AST.Declaration[]>()

/** declarationNamespace classifies declarations by the reference contexts that can resolve them. */
export function declarationNamespace(declaration: AST.Declaration): DeclarationNamespace {
  return AST.isPrimitiveDeclaration(declaration)
      || AST.isTypeDeclaration(declaration)
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
): Array<
  | AST.AliasDeclaration
  | AST.ActionDeclaration
  | AST.AppDeclaration
  | AST.NavDeclaration
  | AST.DatasourceDeclaration
  | AST.DesignDeclaration
  | AST.UiDeclaration
  | AST.EnumCase
> {
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

/** loopSelectHandlers returns the direct row-selection handlers declared by one loop. */
export function loopSelectHandlers(loop: AST.ForStatement): AST.LoopSelectHandler[] {
  return loop.block.statements.filter(AST.isLoopSelectHandler)
}

/** directLoopForSelectHandler returns the loop that directly owns `handler`, if any. */
export function directLoopForSelectHandler(handler: AST.LoopSelectHandler): AST.ForStatement | undefined {
  const block = handler.$container
  return AST.isBlock(block) && AST.isForStatement(block.$container) && block.$container.block === block
    ? block.$container
    : undefined
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

/** slotFillRootTag returns a leading tag that configures the visual root filling one frame slot. */
export function slotFillRootTag(render: AST.Render): AST.TagStatement | undefined {
  const use = render.$container
  const block = render.block
  if (!AST.isRenderSlotUse(use) || use.render !== render || !block) {
    return undefined
  }
  const first = block.statements[0]
  return AST.isTagStatement(first) ? first : undefined
}

/** isSlotFillRootTag identifies a tag consumed as metadata by its enclosing filled visual. */
export function isSlotFillRootTag(tag: AST.TagStatement): boolean {
  const block = tag.$container
  return AST.isBlock(block)
    && AST.isViewRender(block.$container)
    && slotFillRootTag(block.$container) === tag
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
  const slotFill = slotFillRootTag(render)
  const block = render.$container
  const loop = AST.isBlock(block) && AST.isForStatement(block.$container) ? block.$container : undefined
  const loopTag = loop ? attachedTag(loop) : undefined
  const rowTag = loop && loopTag && taggedLoopRowRoot(loop) === render ? loopTag : undefined
  const tags = [rowTag, direct, slotFill]
    .filter((tag): tag is AST.TagStatement => tag !== undefined)
    .map(tag => tag.tag.slice(1))
  const distinctTags = [...new Set(tags)]
  return distinctTags.length > 0 ? distinctTags.join(' ') : undefined
}

/** isImportableValueDeclaration returns true for value declarations that can be imported. */
export function isImportableValueDeclaration(
  node: AST.Node,
): node is
  | AST.AliasDeclaration
  | AST.ActionDeclaration
  | AST.AppDeclaration
  | AST.NavDeclaration
  | AST.DatasourceDeclaration
  | AST.DesignDeclaration
  | AST.UiDeclaration
{
  return AST.isAliasDeclaration(node)
    || AST.isActionDeclaration(node)
    || AST.isAppDeclaration(node)
    || AST.isNavDeclaration(node)
    || AST.isDatasourceDeclaration(node)
    || AST.isDesignDeclaration(node)
    || AST.isUiDeclaration(node)
}

/** ConfigurableDeclaration is an ordinary type whose primitive family is app, nav, or datasource. */
export type ConfigurableDeclaration = AST.TypeDeclaration

/** ConfigurationProperty is one ordinary type slot or one keyed-item property. */
export type ConfigurationProperty = AST.TypeProperty | AST.ConfigurationPropertyDeclaration

/** isConfigurableDeclaration identifies a reusable primitive-family type contract. */
export function isConfigurableDeclaration(node: AST.Node): node is ConfigurableDeclaration {
  return AST.isTypeDeclaration(node) && configurationPrimitiveOf(node) !== undefined
}

/** configurationPrimitiveOf returns the primitive family preserved by a reusable type. */
export function configurationPrimitiveOf(
  declaration: AST.TypeDeclaration,
  seen: Set<AST.TypeDeclaration> = new Set(),
): AST.ConfigurationPrimitive | undefined {
  if (seen.has(declaration)) {
    return undefined
  }
  seen.add(declaration)
  return configurationPrimitiveOfTypeExpression(declaration.type, seen)
}

/** configurationPropertiesOf returns the effective ordinary slots of one reusable configuration type. */
export function configurationPropertiesOf(
  declaration: ConfigurableDeclaration,
): AST.TypeProperty[] {
  return effectiveConfigurationProperties(declaration, new Set())
}

/** configurationKeyOf returns the optional keyed-item contract declared by one nav. */
export function configurationKeyOf(
  declaration: ConfigurableDeclaration,
): AST.ConfigurationKeyDeclaration | undefined {
  return configurationMetadataOf(declaration, 'keys', new Set())
}

/** configurationImplementationOf returns the declaration's package-scope runtime binding. */
export function configurationImplementationOf(
  declaration: ConfigurableDeclaration,
): AST.ConfigurationImplementation | undefined {
  return configurationMetadataOf(declaration, 'implementations', new Set())
}

/** configurationPropertyIsKey identifies the keyed-item selector role without reserving `key` globally. */
export function configurationPropertyIsKey(property: ConfigurationProperty): boolean {
  return property.type !== undefined
    && AST.isNamedTypeReference(property.type)
    && property.type.root === 'key'
    && property.type.members.length === 0
}

function configurationPrimitiveOfTypeExpression(
  type: AST.TypeExpression,
  seen: Set<AST.TypeDeclaration>,
): AST.ConfigurationPrimitive | undefined {
  const base = AST.isDerivedTypeExpression(type) ? type.base : type
  if (AST.isPrimitiveTypeReference(base)) {
    return AST.isConfigurationPrimitive(base.primitive) ? base.primitive : undefined
  }
  if (!AST.isNamedTypeReference(base)) {
    return undefined
  }
  const parent = base.members.length === 0 ? visibleTypeDeclaration(base, base.root) : undefined
  return parent ? configurationPrimitiveOf(parent, seen) : undefined
}

function visibleTypeDeclaration(node: AST.Node, name: string): AST.TypeDeclaration | undefined {
  const root = findRoot(node)
  if (!AST.isTaoFile(root)) {
    return undefined
  }
  return [
    ...root.statements.filter(AST.isTypeDeclaration),
    ...root.statements
      .filter(AST.isUseStatement)
      .flatMap(resolvedImportedDeclarations)
      .filter(AST.isTypeDeclaration),
  ].find(declaration => declaration.name === name)
}

function effectiveConfigurationProperties(
  declaration: AST.TypeDeclaration,
  seen: Set<AST.TypeDeclaration>,
): AST.TypeProperty[] {
  if (seen.has(declaration)) {
    return []
  }
  seen.add(declaration)
  const base = baseTypeDeclarationOf(declaration)
  const properties = base ? [...effectiveConfigurationProperties(base, seen)] : []
  for (const property of itemTypeExpressionOf(declaration)?.properties ?? []) {
    const previous = properties.findIndex(candidate => candidate.name === property.name)
    if (previous === -1) {
      properties.push(property)
    } else {
      properties[previous] = property
    }
  }
  return properties
}

function configurationMetadataOf<KeyT extends 'keys' | 'implementations'>(
  declaration: AST.TypeDeclaration,
  key: KeyT,
  seen: Set<AST.TypeDeclaration>,
): KeyT extends 'keys' ? AST.ConfigurationKeyDeclaration | undefined
  : AST.ConfigurationImplementation | undefined
{
  if (seen.has(declaration)) {
    return undefined as never
  }
  seen.add(declaration)
  const own = itemTypeExpressionOf(declaration)?.[key][0]
  if (own) {
    return own as never
  }
  const base = baseTypeDeclarationOf(declaration)
  return (base ? configurationMetadataOf(base, key, seen) : undefined) as never
}

function itemTypeExpressionOf(declaration: AST.TypeDeclaration): AST.ItemTypeExpression | undefined {
  return AST.isDerivedTypeExpression(declaration.type)
    ? declaration.type.slots
    : AST.isItemTypeExpression(declaration.type)
    ? declaration.type
    : undefined
}

function baseTypeDeclarationOf(declaration: AST.TypeDeclaration): AST.TypeDeclaration | undefined {
  const type = declaration.type
  const base = AST.isDerivedTypeExpression(type) ? type.base : type
  if (!AST.isNamedTypeReference(base) || base.members.length > 0) {
    return undefined
  }
  return visibleTypeDeclaration(base, base.root)
}

/** PatchedValueReference is a declaration-linked immutable `value with { ... }` expression. */
export type PatchedValueReference = AST.RefinementExpression

/** isPatchedValueReference identifies a `with` patch without name-table lookup. */
export function isPatchedValueReference(node: AST.Node): node is PatchedValueReference {
  return AST.isRefinementExpression(node)
}

/** AppVariantDeclaration is an alias whose initializer patches an app declaration identity. */
export type AppVariantDeclaration = AST.AliasDeclaration & { value: PatchedValueReference }

/** isAppVariantDeclaration identifies an immutable `App with { ... }` value declaration. */
export function isAppVariantDeclaration(node: AST.Node): node is AppVariantDeclaration {
  return AST.isAliasDeclaration(node)
    && isPatchedValueReference(node.value)
    && configuredPrimitiveOfValueDeclaration(node.value.target.ref) === 'app'
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
  return AST.isAppDeclaration(base)
    ? base
    : AST.isAliasDeclaration(base) && isConcreteAppValueDeclaration(base)
    ? appDeclarationOf(base, seen)
    : undefined
}

/** isConcreteAppValueDeclaration identifies every declaration whose inferred value family is app. */
export function isConcreteAppValueDeclaration(
  node: AST.Node | undefined,
): node is AST.AppDeclaration | AST.AliasDeclaration {
  return AST.isAppDeclaration(node)
    || (AST.isAliasDeclaration(node) && configuredPrimitiveOfExpression(node.value) === 'app')
}

/** configuredPrimitiveOfValueDeclaration returns a value head's preserved primitive family. */
export function configuredPrimitiveOfValueDeclaration(
  declaration: AST.RefinementBaseDeclaration | undefined,
  seen: Set<AST.AliasDeclaration> = new Set(),
): AST.ConfigurationPrimitive | undefined {
  if (AST.isAppDeclaration(declaration)) {
    return declaration.value ? configuredPrimitiveOfExpression(declaration.value, seen) : 'app'
  }
  if (AST.isNavDeclaration(declaration)) {
    return declaration.value ? configuredPrimitiveOfExpression(declaration.value, seen) : 'nav'
  }
  if (AST.isDatasourceDeclaration(declaration)) {
    return declaration.value ? configuredPrimitiveOfExpression(declaration.value, seen) : 'datasource'
  }
  if (AST.isTypeDeclaration(declaration)) {
    return configurationPrimitiveOf(declaration)
  }
  if (!AST.isAliasDeclaration(declaration) || seen.has(declaration)) {
    return undefined
  }
  seen.add(declaration)
  return configuredPrimitiveOfExpression(declaration.value, seen)
}

/** configuredPrimitiveOfExpression returns the app/nav/datasource family carried by an expression. */
export function configuredPrimitiveOfExpression(
  expression: AST.Expression,
  seen: Set<AST.AliasDeclaration> = new Set(),
): AST.ConfigurationPrimitive | undefined {
  if (AST.isPrimitiveConfigurationConstructor(expression)) {
    return expression.primitive
  }
  if (AST.isConfigurationConstructor(expression)) {
    return AST.isTypeDeclaration(expression.type.ref)
      ? configurationPrimitiveOf(expression.type.ref)
      : undefined
  }
  if (AST.isRefinementExpression(expression)) {
    return configuredPrimitiveOfValueDeclaration(expression.target.ref, seen)
  }
  if (AST.isValueReference(expression)) {
    return configuredPrimitiveOfValueDeclaration(expression.target.ref, seen)
  }
  return undefined
}

/** appValueDeclarationsInFile returns every complete app-headed or app-inferred value declaration. */
export function appValueDeclarationsInFile(file: AST.TaoFile): AST.AppValueDeclaration[] {
  return file.statements.flatMap(statement => isConcreteAppValueDeclaration(statement) ? [statement] : [])
}

/** enumOwningCase returns the declaration whose runtime identity owns one enum case. */
export function enumOwningCase(enumCase: AST.EnumCase): AST.EnumDeclaration {
  return enumCase.$container.$container
}

/** parametersOf returns the parameters declared by a parameterized declaration. */
export function parametersOf(declaration: AST.ParameterizedDeclaration): AST.ParameterDeclaration[] {
  return declaration.parameterList?.parameters ?? []
}

/** returnStatementsOf returns every function return in source order, including early returns. */
export function returnStatementsOf(declaration: AST.FunctionDeclaration): AST.ReturnStatement[] {
  return returnsInFunctionBlock(declaration.block)
}

/** functionHasFallthroughReturn reports whether every one-sided early-return path has a final fallback. */
export function functionHasFallthroughReturn(declaration: AST.FunctionDeclaration): boolean {
  return AST.isReturnStatement(declaration.block.statements.at(-1))
}

function returnsInFunctionBlock(block: AST.FunctionBlock): AST.ReturnStatement[] {
  return block.statements.flatMap(statement =>
    AST.isReturnStatement(statement) ? [statement] : returnsInFunctionBlock(statement.block)
  )
}

/** argumentsOf returns the arguments provided by a render or action invocation. */
export function argumentsOf(node: ArgumentListOwner): AST.Argument[] {
  return node.argumentList?.arguments ?? []
}

/** injectionArgumentsOf returns the arguments declared by a statement, render, or typed-value injection. */
export function injectionArgumentsOf(
  injection: AST.Injection | AST.TypedInjectionExpression,
): AST.InjectionArgument[] {
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

/** renderSlotDeclarationsOf returns the direct named visual slots owned by one frame. */
export function renderSlotDeclarationsOf(frame: AST.FrameDeclaration): AST.RenderSlotDeclaration[] {
  return frame.block.statements.filter(AST.isRenderSlotDeclaration)
}

/** renderSlotUsesOf returns direct slot placements or fills from one render block. */
export function renderSlotUsesOf(block: AST.Block | undefined): AST.RenderSlotUse[] {
  return statementsOf(block).filter(AST.isRenderSlotUse)
}

/** RenderFragment is one statement that contributes a React child in a render block. */
export type RenderFragment =
  | AST.Render
  | AST.WhenRenderStatement
  | AST.GuardRenderStatement
  | AST.IfRenderStatement
  | AST.ForStatement
  | AST.CallerContentStatement
  | AST.RenderSlotUse

/** isRenderFragment identifies rendered statements while excluding named slot fills. */
export function isRenderFragment(statement: AST.Statement): statement is RenderFragment {
  return AST.isRender(statement)
    || AST.isCallerContentStatement(statement)
    || (AST.isRenderSlotUse(statement) && !statement.render)
    || AST.isWhenRenderStatement(statement)
    || AST.isGuardRenderStatement(statement)
    || AST.isIfRenderStatement(statement)
    || AST.isForStatement(statement)
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

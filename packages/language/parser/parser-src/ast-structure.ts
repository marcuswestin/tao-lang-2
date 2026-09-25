import { Assert } from '@shared'
import { Langium } from './langium-exports'
import * as AST from './parserASTExport'

/** DeclarationNamespace identifies the independent declaration table a name occupies. */
export type DeclarationNamespace = 'type' | 'value'

/** RenderablePrimitive is a type family whose value may be named at a render site. */
export type RenderablePrimitive = 'view' | 'scene' | 'nav'

const resolvedUseTargets = new WeakMap<AST.UseStatement | AST.UsePackageStatement, readonly AST.Declaration[]>()
const visibleWorkspaceFiles = new WeakMap<AST.TaoFile, readonly AST.TaoFile[]>()

/**
 * isTestSidecarPath says whether a path names a `.test.tao` sidecar. An app file's graph never holds
 * one: the loader leaves them out of a folder's siblings, and folder scope leaves them out too, so
 * what an app file sees does not change when a command happens to have its tests loaded beside it.
 */
export function isTestSidecarPath(path: string): boolean {
  return path.endsWith('.test.tao')
}

/** rememberVisibleWorkspaceFiles binds every parsed root to the complete workspace loaded with it. */
export function rememberVisibleWorkspaceFiles(files: readonly AST.TaoFile[]): void {
  for (const file of files) {
    visibleWorkspaceFiles.set(file, files)
  }
}

/** declarationNamespace classifies declarations by the reference contexts that can resolve them. */
export function declarationNamespace(declaration: AST.Declaration): DeclarationNamespace {
  return AST.isPrimitiveDeclaration(declaration)
      || AST.isTypeDeclaration(declaration)
    ? 'type'
    : 'value'
}

/** primitiveDeclaration finds one parsed intrinsic primitive in the loaded workspace. */
function primitiveDeclaration(
  files: readonly AST.TaoFile[],
  name: AST.PrimitiveType,
): AST.PrimitiveDeclaration | undefined {
  return files.flatMap(file => file.statements.filter(AST.isPrimitiveDeclaration))
    .find(declaration => declaration.name === name)
}

/** primitiveOwnSlots returns only the slots written directly on one parsed primitive. */
export function primitiveOwnSlots(
  files: readonly AST.TaoFile[],
  name: AST.PrimitiveType,
): readonly AST.TypeProperty[] {
  return primitiveDeclaration(files, name)?.slots?.properties ?? []
}

/** primitiveSlots returns the effective inherited supplied-slot contract for one parsed primitive. */
export function primitiveSlots(
  files: readonly AST.TaoFile[],
  name: AST.PrimitiveType,
  seen: Set<AST.PrimitiveType> = new Set(),
): readonly AST.TypeProperty[] {
  if (seen.has(name)) {
    return []
  }
  seen.add(name)
  const declaration = primitiveDeclaration(files, name)
  if (!declaration) {
    return []
  }
  const inherited = declaration.base ? [...primitiveSlots(files, declaration.base, seen)] : []
  for (const property of declaration.slots?.properties ?? []) {
    const previous = inherited.findIndex(candidate => candidate.name === property.name)
    if (previous === -1) {
      inherited.push(property)
    } else {
      inherited[previous] = property
    }
  }
  return inherited
}

/** declarationKey returns a namespace-qualified key suitable for collision checks. */
export function declarationKey(declaration: AST.Declaration): string {
  return `${declarationNamespace(declaration)}:${declaration.name}`
}

/** rememberUseTargets records every declaration visible through a use target before one Langium ref is chosen. */
export function rememberUseTargets(
  useStatement: AST.UseStatement | AST.UsePackageStatement,
  declarations: readonly AST.Declaration[],
): void {
  resolvedUseTargets.set(useStatement, declarations)
}

/** testDisplayName returns a test's sentence, falling back to the dependencies it declares. */
export function testDisplayName(test: AST.TestDeclaration): string {
  if (test.name) {
    return test.name
  }
  const dependencies = test.dependencies.map(reference => reference.$refText).filter(name => name.length > 0)
  return dependencies.join(', ')
}

/** packageNamespaceName returns the name a use-package statement binds, derived from its path. */
export function packageNamespaceName(statement: AST.UsePackageStatement): string | undefined {
  if (statement.name) {
    return statement.name
  }
  const segments = (statement.importPath ?? '').split('/').filter(segment =>
    segment.length > 0 && segment !== '.' && segment !== '..'
  )
  const last = segments[segments.length - 1]
  if (!last) {
    return undefined
  }
  const name = last.startsWith('@') ? last.slice(1) : last
  return /^[_a-zA-Z][a-zA-Z0-9_]*$/.test(name) ? name : undefined
}

/** viewAliasTarget resolves a view alias to its eventual non-alias target, guarding against cycles. */
export function viewAliasTarget(declaration: AST.ViewDeclaration): AST.Declaration | undefined {
  const seen = new Set<AST.ViewDeclaration>()
  let current: AST.Declaration | undefined = declaration
  while (AST.isViewDeclaration(current) && current.aliasTarget) {
    if (seen.has(current)) {
      return undefined
    }
    seen.add(current)
    current = current.aliasTarget.member.ref
  }
  return current === declaration ? undefined : current
}

export type ConfigurableTypeAliasResolution =
  | { kind: 'target'; target: AST.TypeDeclaration }
  | { kind: 'invalid'; target: AST.Declaration }
  | { kind: 'cycle' }
  | { kind: 'unresolved' }

/** configurableTypeAliasResolution follows a transparent alias while preserving its terminal state. */
export function configurableTypeAliasResolution(
  declaration: AST.TypeDeclaration,
): ConfigurableTypeAliasResolution {
  const seen = new Set<AST.TypeDeclaration>()
  let current: AST.Declaration | undefined = declaration
  while (AST.isTypeDeclaration(current) && current.aliasTarget) {
    if (seen.has(current)) {
      return { kind: 'cycle' }
    }
    seen.add(current)
    current = current.aliasTarget.member.ref
    if (!current) {
      return { kind: 'unresolved' }
    }
  }
  return AST.isTypeDeclaration(current)
    ? { kind: 'target', target: current }
    : { kind: 'invalid', target: current }
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
  | AST.AppView
  | AST.DoStatement
  | AST.CommandDoClause
  | AST.FunctionCallExpression
  | AST.ContextualPresentStatement
  | AST.ViewBinding
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

/** findOwningFixture returns the fixture containing `node`, if any. */
export function findOwningFixture(node: AST.Node): AST.FixtureDeclaration | undefined {
  return findAncestor(node, AST.isFixtureDeclaration, true)
}

/** findOwningScenario returns the scenario containing `node`, if any. */
export function findOwningScenario(node: AST.Node): AST.ScenarioDeclaration | undefined {
  return findAncestor(node, AST.isScenarioDeclaration, true)
}

/** findOwningScenarioGroup returns the scenario group containing `node`, if any. */
export function findOwningScenarioGroup(node: AST.Node): AST.ScenarioGroupDeclaration | undefined {
  return findAncestor(node, AST.isScenarioGroupDeclaration, true)
}

/** scenarioDeclarations returns the authored entries in one scenario group. */
export function scenarioDeclarations(group: AST.ScenarioGroupDeclaration): AST.ScenarioDeclaration[] {
  return group.block.entries.filter(AST.isScenarioDeclaration)
}

/** scenarioGroupClauses returns the defaults authored directly in one scenario group. */
export function scenarioGroupClauses(group: AST.ScenarioGroupDeclaration): AST.ScenarioClause[] {
  return group.block.entries.filter(AST.isScenarioClause)
}

/** scenarioSteps returns one entry's interaction prefix in authored replay order. */
export function scenarioSteps(scenario: AST.ScenarioDeclaration): AST.ScenarioStep[] {
  return scenario.block.steps
}

/** effectiveScenarioClause resolves one entry clause over the matching group default. */
export function effectiveScenarioClause<ClauseT extends AST.ScenarioClause>(
  scenario: AST.ScenarioDeclaration,
  predicate: (clause: AST.ScenarioClause) => clause is ClauseT,
): ClauseT | undefined {
  const ownClause = scenario.block.entries.find(predicate)
  const group = findOwningScenarioGroup(scenario)
  return ownClause ?? (group ? scenarioGroupClauses(group).find(predicate) : undefined)
}

/** effectiveScenarioSubjectClause resolves the mutually-exclusive run/render clause for one entry. */
export function effectiveScenarioSubjectClause(
  scenario: AST.ScenarioDeclaration,
): AST.ScenarioRenderClause | AST.ScenarioRunClause | undefined {
  return effectiveScenarioClause(
    scenario,
    (clause): clause is AST.ScenarioRenderClause | AST.ScenarioRunClause =>
      AST.isScenarioRenderClause(clause) || AST.isScenarioRunClause(clause),
  )
}

/** scenarioSubjectDeclaration resolves an entry's explicit subject or its group-header default. */
export function scenarioSubjectDeclaration(
  scenario: AST.ScenarioDeclaration,
): AST.ScenarioSubjectDeclaration | undefined {
  const clause = effectiveScenarioSubjectClause(scenario)
  if (AST.isScenarioRenderClause(clause) && clause.view?.ref) {
    return clause.view.ref
  }
  if (AST.isScenarioRunClause(clause) && clause.app?.ref) {
    return clause.app.ref
  }
  return findOwningScenarioGroup(scenario)?.subject?.ref
}

/** fixtureValueDeclarations returns the account and created-row handles owned by a fixture. */
export function fixtureValueDeclarations(fixture: AST.FixtureDeclaration): AST.FixtureValueDeclaration[] {
  return fixture.block.entries.filter(AST.isFixtureValueDeclaration)
}

/** streamAllContents returns every descendant of `node` in document order. */
export function streamAllContents(node: AST.Node): AST.Node[] {
  return Langium.AstUtils.streamAllContents(node).toArray()
}

/** streamContents returns the direct AST children of `node` in property order. */
export function streamContents(node: AST.Node): AST.Node[] {
  return Langium.AstUtils.streamContents(node).toArray()
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

/** ImportableValueDeclaration is a file-level value declaration another file can import by name. */
export type ImportableValueDeclaration =
  | AST.AliasDeclaration
  | AST.ActionDeclaration
  | AST.AppDeclaration
  | AST.CommandDeclaration
  | AST.NavDeclaration
  | AST.DatasourceDeclaration
  | AST.DesignDeclaration
  | AST.ViewDeclaration

/** importableValueDeclarationsInFile returns file-level value declarations visible to other files. */
export function importableValueDeclarationsInFile(
  file: AST.TaoFile,
): Array<ImportableValueDeclaration | AST.CaseSetCase> {
  return [
    ...file.statements.filter(isImportableValueDeclaration),
    ...file.statements.filter(AST.isTypeDeclaration).flatMap(caseSetCasesOf),
  ]
}

/** valueDeclarationsOwnedByBlock returns value declarations owned directly by `block`. */
export function valueDeclarationsOwnedByBlock(
  block: AST.Block,
): Array<
  | AST.AliasDeclaration
  | AST.StateDeclaration
  | AST.EntityQueryDeclaration
  | AST.ActionDeclaration
  | AST.CommandDeclaration
> {
  return [
    ...block.statements.filter(AST.isAliasDeclaration),
    ...block.statements.filter(AST.isStateDeclaration),
    ...block.statements.filter(AST.isEntityQueryDeclaration),
    ...block.statements.filter(AST.isActionDeclaration),
    ...block.statements.filter(AST.isCommandDeclaration),
  ]
}

/** declarationSlotFillsOf returns the supplied-slot fills written directly in a declaration body. */
export function declarationSlotFillsOf(
  declaration: AST.ViewDeclaration | AST.ActionDeclaration,
): AST.DeclarationSlotFill[] {
  return declaration.block?.statements.filter(AST.isDeclarationSlotFill) ?? []
}

/** declarationSlotFillNamed returns a declaration's direct fill for one supplied slot. */
export function declarationSlotFillNamed(
  declaration: AST.ViewDeclaration | AST.ActionDeclaration,
  name: string,
): AST.DeclarationSlotFill | undefined {
  return declarationSlotFillsOf(declaration).find(fill => fill.name === name)
}

/** commandsOf returns the commands declared directly by one view occurrence shape. */
export function commandsOf(view: AST.ViewDeclaration): AST.CommandDeclaration[] {
  return view.block?.statements.filter(AST.isCommandDeclaration) ?? []
}

/** commandOwningView returns the view whose direct body declares a command. */
export function commandOwningView(command: AST.CommandDeclaration): AST.ViewDeclaration | undefined {
  const block = command.$container
  return AST.isBlock(block) && AST.isViewDeclaration(block.$container) && block.$container.block === block
    ? block.$container
    : undefined
}

/** commandFillsOf returns the member fills written in one command body, in source order. */
export function commandFillsOf(command: AST.CommandDeclaration): AST.CommandFill[] {
  return command.block.members.filter(AST.isCommandFill)
}

/** commandDoClausesOf returns every `do` clause written in one command body. */
export function commandDoClausesOf(command: AST.CommandDeclaration): AST.CommandDoClause[] {
  return command.block.members.filter(AST.isCommandDoClause)
}

/** commandDoClauseOf returns the single invocation one validated command binds. */
export function commandDoClauseOf(command: AST.CommandDeclaration): AST.CommandDoClause | undefined {
  return commandDoClausesOf(command)[0]
}

/** entityCommandPoliciesOf returns one entity's ordered default or hidden command mentions. */
export function entityCommandPoliciesOf(entity: AST.EntityDataDeclaration): AST.EntityCommandPolicy[] {
  return entity.block.entries.filter(AST.isEntityCommandPolicy)
}

/** viewCommandExclusionsOf returns every command directly excluded by one view occurrence shape. */
export function viewCommandExclusionsOf(view: AST.ViewDeclaration): AST.ViewCommandExclusion[] {
  return view.block?.statements.filter(AST.isViewCommandExclusion) ?? []
}

/** configurationEntryName returns the member, slot or reference one configuration entry names. */
export function configurationEntryName(entry: AST.ConfigurationEntry): string | undefined {
  return entry.name ?? entry.label ?? entry.reference?.$refText
}

/** owningCommand returns the command declaration containing `node`, if any. */
export function owningCommand(node: AST.Node): AST.CommandDeclaration | undefined {
  return findAncestor(node, AST.isCommandDeclaration, true)
}

/** askDeclarationsOwnedByActionBlock returns dialogue results introduced directly by one action block. */
export function askDeclarationsOwnedByActionBlock(block: AST.ActionBlock): AST.AskStatement[] {
  return block.statements.filter(AST.isAskStatement)
}

/** forBindingOwnedByBlock returns the iteration binding visible inside a `for` body. */
export function forBindingOwnedByBlock(block: AST.Block): AST.ForStatement | undefined {
  return AST.isForStatement(block.$container) ? block.$container : undefined
}

/** The traits spelled as a plain word rather than a keyword, so each word stays usable as a name. */
export const wordTraitNames: readonly string[] = ['title']

/** traitIsTitle identifies the `(title)` trait: the one text field that names a row to a person. */
export function traitIsTitle(trait: AST.Trait): boolean {
  return trait.word === 'title'
}

/** traitIsRequired identifies `required "<sentence>"`: completeness that never blocks a write. */
export function traitIsRequired(trait: AST.Trait): trait is AST.Trait & { sentence: string } {
  return trait.sentence !== undefined
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

/** slotFillRootTag returns a leading tag that configures the visual root filling one named render slot. */
function slotFillRootTag(render: AST.Render): AST.TagStatement | undefined {
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

/**
 * loopRowRoot returns the sole unconditional direct render of a loop row: the one native root a
 * tag or a row-level accessibility label can land on. A conditional, repeated, or multi-render row
 * has none.
 */
export function loopRowRoot(loop: AST.ForStatement): AST.Render | undefined {
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
  const rowTag = loop && loopTag && loopRowRoot(loop) === render ? loopTag : undefined
  const tags = [rowTag, direct, slotFill]
    .filter((tag): tag is AST.TagStatement => tag !== undefined)
    .map(tag => tag.tag.slice(1))
  const distinctTags = [...new Set(tags)]
  return distinctTags.length > 0 ? distinctTags.join(' ') : undefined
}

/** isImportableValueDeclaration returns true for value declarations that can be imported. */
export function isImportableValueDeclaration(node: AST.Node): node is ImportableValueDeclaration {
  return AST.isAliasDeclaration(node)
    || AST.isActionDeclaration(node)
    || AST.isAppDeclaration(node)
    // A module-level command is an ordinary named value: it is the verb other modules reach for.
    || (AST.isCommandDeclaration(node) && AST.isTaoFile(node.$container))
    || AST.isNavDeclaration(node)
    || AST.isDatasourceDeclaration(node)
    || AST.isDesignDeclaration(node)
    || AST.isViewDeclaration(node)
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
  if (declaration.aliasTarget) {
    const target = declaration.aliasTarget.member.ref
    return AST.isTypeDeclaration(target) ? configurationPrimitiveOf(target, seen) : undefined
  }
  if (!declaration.type) {
    return undefined
  }
  return configurationPrimitiveOfTypeExpression(declaration.type, seen)
}

/** renderablePrimitiveOfParameter resolves a parameter's effective view-family type. */
export function renderablePrimitiveOfParameter(
  parameter: AST.ParameterDeclaration,
): RenderablePrimitive | undefined {
  const type = parameter.inlineType?.type ?? parameter.type
  return type ? renderablePrimitiveOfTypeExpression(type, new Set()) : undefined
}

function renderablePrimitiveOfTypeExpression(
  type: AST.TypeExpression,
  seen: Set<AST.TypeDeclaration>,
): RenderablePrimitive | undefined {
  const base = AST.isDerivedTypeExpression(type) ? type.base : type
  if (AST.isPrimitiveTypeReference(base)) {
    return base.primitive === 'view' || base.primitive === 'scene' || base.primitive === 'nav'
      ? base.primitive
      : undefined
  }
  if (!AST.isNamedTypeReference(base) || base.members.length > 0) {
    return undefined
  }
  const declaration = visibleTypeDeclaration(base, base.root)
  return declaration ? renderablePrimitiveOfTypeDeclaration(declaration, seen) : undefined
}

function renderablePrimitiveOfTypeDeclaration(
  declaration: AST.TypeDeclaration,
  seen: Set<AST.TypeDeclaration>,
): RenderablePrimitive | undefined {
  if (seen.has(declaration)) {
    return undefined
  }
  seen.add(declaration)
  const aliasTarget = declaration.aliasTarget?.member.ref
  if (AST.isTypeDeclaration(aliasTarget)) {
    return renderablePrimitiveOfTypeDeclaration(aliasTarget, seen)
  }
  return declaration.type ? renderablePrimitiveOfTypeExpression(declaration.type, seen) : undefined
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
  return visibleFileDeclarations(node, AST.isTypeDeclaration).find(declaration => declaration.name === name)
}

/** visibleFileDeclarations returns a file's own and use-imported declarations matching `guard`. */
export function visibleFileDeclarations<DeclarationT extends AST.Node>(
  node: AST.Node,
  guard: (candidate: unknown) => candidate is DeclarationT,
): DeclarationT[] {
  const root = findRoot(node)
  if (!AST.isTaoFile(root)) {
    return []
  }
  const declarations: DeclarationT[] = []
  for (const statement of root.statements) {
    if (guard(statement)) {
      declarations.push(statement)
    }
  }
  for (const statement of root.statements) {
    if (!AST.isUseStatement(statement)) {
      continue
    }
    for (const declaration of resolvedImportedDeclarations(statement)) {
      if (guard(declaration)) {
        declarations.push(declaration)
      }
    }
  }
  return declarations
}

/**
 * visibleValueDeclarations returns the effective file-level value table used by ordinary value
 * references. The order deliberately matches ValueScopeProvider: `folder` siblings and explicit
 * imports occupy its inner imported scope, while declarations in this file are the outer fallback.
 * The guard is applied before names are claimed so the type and value namespaces remain distinct.
 */
export function visibleValueDeclarations<DeclarationT extends AST.Declaration>(
  node: AST.Node,
  guard: (candidate: unknown) => candidate is DeclarationT,
): readonly DeclarationT[] {
  const root = findRoot(node)
  if (!AST.isTaoFile(root)) {
    return []
  }
  const visible: DeclarationT[] = []
  const names = new Set<string>()
  const add = (declaration: AST.Node) => {
    if (
      AST.isDeclaration(declaration)
      && declarationNamespace(declaration) === 'value'
      && guard(declaration)
      && !names.has(declaration.name)
    ) {
      names.add(declaration.name)
      visible.push(declaration)
    }
  }
  const currentPath = AST.getDocument(root).uri.path
  const currentDirectory = currentPath.slice(0, currentPath.lastIndexOf('/'))
  for (const file of visibleWorkspaceFiles.get(root) ?? []) {
    const path = AST.getDocument(file).uri.path
    if (file === root || isTestSidecarPath(path) || path.slice(0, path.lastIndexOf('/')) !== currentDirectory) {
      continue
    }
    for (const declaration of file.statements) {
      if (
        AST.isDeclaration(declaration)
        && 'visibility' in declaration
        && declaration.visibility === 'folder'
      ) {
        add(declaration)
      }
    }
  }
  for (const statement of root.statements) {
    if (AST.isUseStatement(statement)) {
      for (const declaration of resolvedImportedDeclarations(statement)) {
        add(declaration)
      }
    }
  }
  for (const declaration of importableValueDeclarationsInFile(root)) {
    add(declaration)
  }
  return visible
}

function effectiveConfigurationProperties(
  declaration: AST.TypeDeclaration,
  seen: Set<AST.TypeDeclaration>,
): AST.TypeProperty[] {
  if (seen.has(declaration)) {
    return []
  }
  seen.add(declaration)
  if (declaration.aliasTarget) {
    const target = declaration.aliasTarget.member.ref
    return AST.isTypeDeclaration(target) ? effectiveConfigurationProperties(target, seen) : []
  }
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
  if (declaration.aliasTarget) {
    const target = declaration.aliasTarget.member.ref
    return (AST.isTypeDeclaration(target)
      ? configurationMetadataOf(target, key, seen)
      : undefined) as never
  }
  const own = itemTypeExpressionOf(declaration)?.[key][0]
  if (own) {
    return own as never
  }
  const base = baseTypeDeclarationOf(declaration)
  return (base ? configurationMetadataOf(base, key, seen) : undefined) as never
}

function itemTypeExpressionOf(declaration: AST.TypeDeclaration): AST.ItemTypeExpression | undefined {
  return declaration.type && AST.isDerivedTypeExpression(declaration.type)
    ? declaration.type.slots
    : declaration.type && AST.isItemTypeExpression(declaration.type)
    ? declaration.type
    : undefined
}

function baseTypeDeclarationOf(declaration: AST.TypeDeclaration): AST.TypeDeclaration | undefined {
  const type = declaration.type
  if (!type) {
    return declaration.aliasTarget?.member.ref && AST.isTypeDeclaration(declaration.aliasTarget.member.ref)
      ? declaration.aliasTarget.member.ref
      : undefined
  }
  const base = AST.isDerivedTypeExpression(type) ? type.base : type
  if (!AST.isNamedTypeReference(base) || base.members.length > 0) {
    return undefined
  }
  return visibleTypeDeclaration(base, base.root)
}

/** isConcreteAppValueDeclaration identifies every declaration whose inferred value family is app. */
export function isConcreteAppValueDeclaration(
  node: AST.Node | undefined,
): node is AST.AppDeclaration | AST.AliasDeclaration {
  return AST.isAppDeclaration(node)
    || (AST.isAliasDeclaration(node) && configuredPrimitiveOfExpression(node.value) === 'app')
}

/** configuredPrimitiveOfValueDeclaration returns a value head's preserved primitive family. */
function configuredPrimitiveOfValueDeclaration(
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

/** caseSetCasesOf returns the cases a type declaration introduces, when it heads a closed case set. */
export function caseSetCasesOf(declaration: AST.TypeDeclaration): AST.CaseSetCase[] {
  return declaration.type && AST.isCaseSetTypeExpression(declaration.type) ? declaration.type.cases : []
}

/** caseSetCaseName returns a case's source-facing name, whether written bare or as a text literal. */
export function caseSetCaseName(caseSetCase: AST.CaseSetCase): string {
  return caseSetCase.name ?? (caseSetCase.literal ?? '').replace(/^"|"$/g, '')
}

/** caseSetOwningCase returns the type declaration whose runtime identity owns one case. */
export function caseSetOwningCase(caseSetCase: AST.CaseSetCase): AST.TypeDeclaration {
  return caseSetCase.$container.$container as AST.TypeDeclaration
}

/** parametersOf returns the parameters declared by a parameterized declaration. */
export function parametersOf(declaration: AST.ParameterizedDeclaration): AST.ParameterDeclaration[] {
  // A view alias has no parameter list of its own; its interface is its target's.
  if (AST.isViewDeclaration(declaration) && declaration.aliasTarget) {
    const target = viewAliasTarget(declaration)
    return target && AST.isParameterizedDeclaration(target) ? parametersOf(target as AST.ParameterizedDeclaration) : []
  }
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
  injection: AST.Injection,
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

/** renderSlotDeclarationsOf returns the direct named visual slots owned by one view. */
export function renderSlotDeclarationsOf(
  view: AST.ViewDeclaration,
): Array<AST.RenderSlotDeclaration | AST.ForeignViewSlotDeclaration> {
  return view.block?.statements.filter(AST.isRenderSlotDeclaration) ?? view.foreign?.slots ?? []
}

/**
 * viewPlacesCallerContent reports whether a view's body places `@@content` — in its render tree or
 * by naming the channel in a render injection — which is the placement that makes the view accept
 * unnamed caller content. Content acceptance is inferred from the body, never declared.
 */
export function viewPlacesCallerContent(view: AST.ViewDeclaration): boolean {
  if (view.foreign) {
    return view.foreign.content === 'content'
  }
  if (!view.block) {
    const target = viewAliasTarget(view)
    return AST.isViewDeclaration(target) ? viewPlacesCallerContent(target) : false
  }
  for (const node of streamAllContents(view.block)) {
    if (AST.isCallerContentStatement(node)) {
      return true
    }
    if (AST.isRenderAmbientChannel(node) && node.channel === '@@content') {
      return true
    }
  }
  return false
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
    Assert.defined(statement, `block statement at index ${selector}`)
    return statement
  }
  if ('find' in selector) {
    const statement = statements.find(selector.find)
    Assert.defined(statement, 'a matching block statement')
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

/**
 * whenExpressionOutcomes returns the values a `when` can produce and whether they cover the subject.
 * The block form is total by construction; the compact form covers both poles only when it declares
 * a negative branch, and otherwise contributes absence (Decisions §8).
 */
export function whenExpressionOutcomes(
  expression: AST.WhenExpression,
): { values: AST.Expression[]; total: boolean } {
  if (expression.positive) {
    const negative = expression.negative
    return {
      values: negative ? [expression.positive, negative] : [expression.positive],
      total: negative !== undefined,
    }
  }
  const otherwise = expression.otherwise
  return {
    values: [...expression.branches.map(branch => branch.value), ...(otherwise ? [otherwise.value] : [])],
    total: true,
  }
}

/** findOwningView returns the renderable declaration that owns `node`, if any. */
export function findOwningView(node: AST.Node): AST.ViewDeclaration | undefined {
  return findAncestor(node, AST.isViewDeclaration)
}

/** findOwningAction returns the action declaration that owns `node`, if any. */
export function findOwningAction(node: AST.Node): AST.ActionDeclaration | undefined {
  return findAncestor(node, AST.isActionDeclaration)
}

/** actionFailuresOf infers a native action's failure contract from its own `fail` statements. */
export function actionFailuresOf(action: AST.ActionDeclaration): AST.FailStatement[] {
  if (!action.block) {
    return []
  }
  return streamAllContents(action.block)
    .filter(AST.isFailStatement)
    .filter(failure => findOwningAction(failure) === action)
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

/** findOwningFromExpression returns the bridge expression whose names denote module exports. */
export function findOwningFromExpression(node: AST.Node): AST.FromExpression | undefined {
  return findAncestor(node, AST.isFromExpression)
}

/** findAncestor walks `node`'s containers for the nearest match, optionally testing `node` itself first. */
function findAncestor<NodeT extends AST.Node>(
  node: AST.Node,
  predicate: NodePredicate<NodeT>,
  includeSelf = false,
): NodeT | undefined {
  let current: AST.Node | undefined = includeSelf ? node : node.$container
  while (current) {
    if (predicate(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

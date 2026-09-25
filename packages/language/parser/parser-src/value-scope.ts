import { Langium } from './langium-exports'
import type { PackageResolver } from './package-resolver'
import * as AST from './parserASTExport'

type BuildCacheResolver = PackageResolver & {
  clearPhysicalPathCache?: () => void
}

/** ValueScopeProvider resolves value references through Tao binding and parameter visibility. */
export class ValueScopeProvider extends Langium.DefaultScopeProvider {
  /**
   * What each use statement resolves to. Every reference in a file asks again for every use
   * statement above it, and each answer filters the whole workspace, so without this the link phase
   * costs references times imports times documents.
   *
   * These answers and package boundary paths depend on the current documents and file system.
   * `Parser.parse` replaces every document it builds, which retires use statements; that is why
   * their keys are held weakly. The editor instead updates documents in place and relinks the ones
   * a change may have moved, so these caches are dropped when an update starts and again when any
   * build finishes parsing, which is after the last syntax tree is replaced and before the first
   * reference is linked against it.
   */
  private useTargets = new WeakMap<AST.UseStatement | AST.UsePackageStatement, AST.Declaration[]>()

  /**
   * The design colors each file's project mounts, the outer layer of every design color name in that
   * file. It reads every project file's apps, so without this each lowercase argument and default paid
   * for the project walk again. It depends on the same documents a use target does and is forgotten
   * at the same moments.
   */
  private mountedColors = new WeakMap<AST.TaoFile, readonly AST.DesignColor[]>()

  constructor(
    private readonly coreServices: Langium.LangiumCoreServices,
    private readonly packages: PackageResolver,
  ) {
    super(coreServices)
    const forgetBuildCaches = (): void => {
      this.useTargets = new WeakMap()
      this.mountedColors = new WeakMap()
      const packages = this.packages as BuildCacheResolver
      packages.clearPhysicalPathCache?.()
    }
    const builder = coreServices.shared.workspace.DocumentBuilder
    builder.onUpdate(forgetBuildCaches)
    builder.onBuildPhase(Langium.DocumentState.Parsed, forgetBuildCaches)
  }

  /** getScope returns Tao values visible to a value reference. */
  override getScope(context: Langium.ReferenceInfo): Langium.Scope {
    const container = context.container
    const isStateTargetReference = context.property === 'target'
      && (AST.isSetStatement(container) || AST.isToggleStatement(container))
    if (isStateTargetReference) {
      return this.createMutableScope(container)
    }
    if (context.property === 'target' && AST.isValueReference(context.container)) {
      if (AST.isDataWriteField(context.container.$container)) {
        return this.createDataWriteValueScope(context.container)
      }
      return this.createValueScope(context.container, this.createDesignColorScope(context))
    }
    if (context.property === 'target' && AST.isRefinementExpression(context.container)) {
      return this.createPatchBaseScope(context.container)
    }
    if (context.property === 'reference' && AST.isConfigurationEntry(context.container)) {
      return this.createConfigurationReferenceScope(context.container)
    }
    if (context.property === 'target' && AST.isMemberAccessExpression(context.container)) {
      return this.createValueScope(context.container, this.createDesignColorScope(context))
    }
    if (context.property === 'case' && AST.isBooleanWhereClause(context.container)) {
      return this.createBooleanWhereScope(context.container)
    }
    if (context.property === 'declaredCase' && AST.isCaseTestExpression(context.container)) {
      return this.createCaseTestScope(context.container)
    }
    if (context.property === 'type' && AST.isConfiguredValue(context.container)) {
      return this.createConstructorDeclarationScope(context.container)
    }
    const isConfigurationTargetReference = context.property === 'target'
      && AST.isConfigurationReference(container)
    if (isConfigurationTargetReference) {
      return this.createConfigurationDeclarationScope(container)
    }
    if (context.property === 'view' && AST.isContextualPresentStatement(context.container)) {
      return this.createPresentedViewScope(context.container)
    }
    if (context.property === 'view' && AST.isViewBinding(context.container)) {
      return this.createDeclarationScope(context.container, AST.isViewDeclaration)
    }
    if (context.property === 'view' && AST.isAskStatement(context.container)) {
      return this.createAskedViewScope(context.container)
    }
    if (context.property === 'case' && AST.isRespondStatement(context.container)) {
      return this.createResponseCaseScope(context.container)
    }
    if (
      context.property === 'case'
      && (AST.isFailStatement(context.container) || AST.isActionFailureDeclaration(context.container))
    ) {
      return this.createFailureCaseScope(context.container)
    }
    if (context.property === 'function' && AST.isFunctionCallExpression(context.container)) {
      return this.createFunctionScope(context.container)
    }
    if (context.property === 'references' && AST.isDeclarationSlotReferenceBlock(context.container)) {
      return this.createCommandReferenceScope(context.container)
    }
    if (
      context.property === 'commands'
      && (AST.isEntityCommandPolicy(context.container) || AST.isViewCommandExclusion(context.container))
    ) {
      return this.createCommandReferenceScope(context.container)
    }
    if (context.property === 'importedDeclarations' && AST.isUseStatement(context.container)) {
      return this.createUseImportScope(context.container)
    }
    if (context.property === 'namespace' && AST.isPackageMemberReference(context.container)) {
      return this.createPackageNamespaceScope(context.container)
    }
    if (context.property === 'member' && AST.isPackageMemberReference(context.container)) {
      return this.createPackageMemberScope(context.container)
    }
    if (context.property === 'view' && AST.isRender(context.container)) {
      return this.createViewScope(context.container)
    }
    if (context.property === 'view' && AST.isScenarioRenderClause(container)) {
      return this.createDeclarationScope(container, AST.isViewDeclaration)
    }
    if (context.property === 'subject' && AST.isScenarioGroupDeclaration(container)) {
      return this.createScenarioSubjectScope(container)
    }
    if (context.property === 'slot' && AST.isRenderSlotUse(context.container)) {
      return this.createRenderSlotScope(context.container)
    }
    if (context.property === 'view' && AST.isAppView(context.container)) {
      return this.createAppViewScope(context.container)
    }
    if (context.property === 'entity' && AST.isCreateStatement(context.container)) {
      return this.createEntityDataScope(context.container)
    }
    if (context.property === 'entity' && AST.isFixtureCreateBinding(container)) {
      return this.createEntityDataScope(container)
    }
    if (context.property === 'action' && AST.isFixtureThroughClause(container)) {
      return this.createDeclarationScope(container, AST.isActionDeclaration)
    }
    if (context.property === 'account' && AST.isFixtureCreateBinding(container)) {
      return this.createFixtureAccountScope(container)
    }
    if (context.property === 'target' && AST.isFixtureValueReference(container)) {
      return this.createFixtureValueScope(container)
    }
    if (context.property === 'fixture' && AST.isScenarioFixtureClause(container)) {
      return this.createFixtureDeclarationScope(container)
    }
    if (context.property === 'target' && AST.isScenarioPrepareUpdate(container)) {
      return this.createScenarioFixtureValueScope(container)
    }
    const isAppReference = context.property === 'app'
      && (AST.isRunStep(container)
        || AST.isNavigationTarget(container)
        || AST.isSelectionActivateStatement(container)
        || AST.isReplaceStatement(container)
        || AST.isScenarioRunClause(container))
    if (isAppReference) {
      return this.createRunAppScope(container)
    }
    if (context.property === 'app' && AST.isProjectDefaultApp(container)) {
      return this.createProjectDefaultAppScope(container)
    }
    if (context.property === 'response' && AST.isViewDeclaration(container)) {
      return this.createDeclarationScope(container, AST.isTypeDeclaration)
    }
    if (context.property === 'dependencies' && AST.isTestDeclaration(container)) {
      return this.createDeclarationScope(container, AST.isDeclaration)
    }
    // No reference is left to Langium's default scope, which offers every top-level declaration of
    // every loaded document, imports and visibility ignored, and so resolves differently depending
    // on which files a command happened to load. A reference the grammar gains without a rule above
    // resolves to nothing and says so, rather than to whatever is loaded.
    return this.createScopeForNodes([])
  }

  /**
   * `DefaultApp Name` names one app declaration from this project, wherever in the project it is
   * declared; a project declaration imports nothing. The declaring file goes first so that its own
   * app wins over a same-named one elsewhere in the project.
   */
  private createProjectDefaultAppScope(node: AST.ProjectDefaultApp): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const workspaceFiles = Array.from(this.coreServices.shared.workspace.LangiumDocuments.all)
      .map(document => document.parseResult.value)
      .filter(AST.isTaoFile)
    const projectFiles = this.packages.projectSourceFiles({
      fromFilePath: AST.getDocument(root).uri.path,
      workspaceFiles,
    })
    return this.createScopeForNodes(
      [root, ...projectFiles.filter(file => file !== root)]
        .flatMap(file => file.statements.filter(AST.isAppDeclaration)),
    )
  }

  /**
   * A design color name is a value only as an argument or a parameter default, where a `color` may be
   * expected (Decisions §13). It is resolved against the designs this project's apps mount, as the
   * outermost layer, so any Tao value of the same name shadows it; the argument binding and the
   * default's declared type then decide whether a `color` was expected there. Design names are
   * lowercase and values are Capitalized, so only a lowercase name pays for the project walk.
   *
   * A name links when any mounted design declares it; the validator then requires every mounted
   * design to declare it. A shade (`accent.20`) links to a color whose family declares that shade
   * wherever one exists, so whether it types as a `color` never depends on which design came first.
   */
  private createDesignColorScope(context: Langium.ReferenceInfo): Langium.Scope | undefined {
    if (!/^[a-z]/.test(context.reference.$refText) || !AST.isDesignColorPosition(context.container)) {
      return undefined
    }
    const root = AST.findRoot(context.container)
    if (!AST.isTaoFile(root)) {
      return undefined
    }
    const colors = this.mountedDesignColors(root)
    const shade = AST.isMemberAccessExpression(context.container) ? context.container.shade : undefined
    if (shade === undefined) {
      return this.createScopeForNodes(colors)
    }
    const shaded = colors.filter(color => AST.isDesignColorEntry(color) && AST.designColorShade(color, shade))
    return this.createScopeForNodes([...shaded, ...colors])
  }

  private mountedDesignColors(root: AST.TaoFile): readonly AST.DesignColor[] {
    const known = this.mountedColors.get(root)
    if (known !== undefined) {
      return known
    }
    const workspaceFiles = Array.from(this.coreServices.shared.workspace.LangiumDocuments.all)
      .map(document => document.parseResult.value)
      .filter(AST.isTaoFile)
    const projectFiles = this.packages.projectSourceFiles({
      fromFilePath: AST.getDocument(root).uri.path,
      workspaceFiles,
    })
    const colors = AST.mountedDesigns(projectFiles).flatMap(AST.designColorsOf)
    this.mountedColors.set(root, colors)
    return colors
  }

  private createValueScope(reference: AST.Node, outer?: Langium.Scope): Langium.Scope {
    const root = AST.findRoot(reference)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }

    // A command is not a value inside its own body: leaving its name out is what lets a command
    // carry the same name as the action it runs, which is the natural spelling for a private
    // procedure and the verb in front of it.
    const owner = AST.owningCommand(reference)
    const visible = (declaration: AST.Node) => declaration !== owner
    let scope = this.createScopeForNodes(AST.importableValueDeclarationsInFile(root).filter(visible), outer)
    scope = this.createScopeForNodes(
      this.importedDeclarations(reference, AST.isImportableValueDeclaration),
      scope,
    )
    scope = this.createScopeForNodes(this.importedCaseSetCases(reference), scope)

    const app = owningAppDeclaration(reference)
    if (app?.block) {
      scope = this.createScopeForNodes(
        app.block.statements.filter(statement =>
          AST.isStateDeclaration(statement) || AST.isActionDeclaration(statement)
        ),
        scope,
      )
    }

    const owningView = AST.findOwningView(reference)
    if (owningView) {
      scope = this.createScopeForParameters(owningView, scope, reference)
    }

    const owningFunction = AST.findOwningFunction(reference)
    if (owningFunction) {
      scope = this.createScopeForParameters(owningFunction, scope, reference)
    }

    const owningPhrase = AST.findOwningPhrase(reference)
    if (owningPhrase) {
      scope = this.createScopeForParameters(owningPhrase, scope, reference)
    }

    const owningAction = AST.findOwningAction(reference)
    if (owningAction) {
      scope = this.createScopeForParameters(owningAction, scope, reference)
    }

    // Blocks and case payloads layer together at their lexical depth, so a handler payload wins
    // over outer bindings while bindings declared inside the handler shadow the payload.
    for (const carrier of scopeCarriersContaining(reference).reverse()) {
      if (carrier.kind === 'payload') {
        scope = this.createScopeForNodes([carrier.payload], scope)
        continue
      }
      if (carrier.kind === 'action-block') {
        scope = this.createScopeForNodes(AST.askDeclarationsOwnedByActionBlock(carrier.block), scope)
        continue
      }
      const forBinding = AST.forBindingOwnedByBlock(carrier.block)
      if (forBinding) {
        scope = this.createScopeForNodes([forBinding], scope)
      }
      scope = this.createScopeForNodes(AST.valueDeclarationsOwnedByBlock(carrier.block).filter(visible), scope)
    }

    // A command's own slots are the innermost values in its body: they are what its metadata reads
    // and what its `do` clause hands to the action it runs.
    if (owner) {
      scope = this.createScopeForParameters(owner, scope, reference)
    }

    return scope
  }

  /** A command surface sees file-local, folder/imported, then occurrence-local commands. */
  private createCommandReferenceScope(
    node: AST.DeclarationSlotReferenceBlock | AST.EntityCommandPolicy | AST.ViewCommandExclusion,
  ): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isCommandDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(node, AST.isCommandDeclaration), scope)
    const view = AST.findOwningView(node)
    if (AST.isViewDeclaration(view)) {
      scope = this.createScopeForNodes(AST.commandsOf(view), scope)
    }
    return scope
  }

  private createConstructorDeclarationScope(node: AST.ConfiguredValue): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const local = preferredConstructorDeclarations(node, root.statements.filter(AST.isConstructorDeclaration))
    const imported = preferredConstructorDeclarations(
      node,
      this.importedDeclarations(node, AST.isConstructorDeclaration),
    )
    let scope = this.createScopeForNodes(local)
    scope = this.createScopeForNodes(imported, scope)
    return scope
  }

  private createConfigurationDeclarationScope(node: AST.Node): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const configurable = (candidate: AST.Node): candidate is AST.Declaration =>
      AST.isImportableValueDeclaration(candidate)
      || AST.isConfigurableDeclaration(candidate)
    let scope = this.createScopeForNodes(root.statements.filter(configurable))
    scope = this.createScopeForNodes(this.importedDeclarations(node, configurable), scope)
    const app = owningAppDeclaration(node)
    if (app?.block) {
      scope = this.createScopeForNodes(
        app.block.statements.filter(statement =>
          AST.isStateDeclaration(statement) || AST.isActionDeclaration(statement)
        ),
        scope,
      )
    }
    return scope
  }

  private createPatchBaseScope(node: AST.RefinementExpression): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const value = (candidate: AST.Node): candidate is AST.Declaration & AST.ValueDeclaration =>
      AST.isDeclaration(candidate) && AST.isValueDeclaration(candidate)
    const type = (candidate: AST.Node): candidate is AST.TypeDeclaration => AST.isTypeDeclaration(candidate)
    // A refinement name resolves the value namespace first, then falls back to the type namespace.
    // Keeping them as nested scopes also permits same-name peers without creating an ambiguous ref.
    let scope = this.createScopeForNodes(this.importedDeclarations(node, type))
    scope = this.createScopeForNodes(root.statements.filter(type), scope)
    scope = this.createScopeForNodes(this.importedDeclarations(node, value), scope)
    scope = this.createScopeForNodes(root.statements.filter(value), scope)
    return scope
  }

  private createPresentedViewScope(node: AST.ContextualPresentStatement): Langium.Scope {
    return this.createDeclarationScope(node, AST.isViewDeclaration)
  }

  private createAskedViewScope(node: AST.AskStatement): Langium.Scope {
    return this.createDeclarationScope(node, AST.isViewDeclaration)
  }

  private createResponseCaseScope(node: AST.RespondStatement): Langium.Scope {
    // `respond` answers with a case of the owning view's `responds` type.
    const owner = AST.findOwningView(node)
    const response = AST.isViewDeclaration(owner) ? owner.response?.ref : undefined
    return this.createScopeForNodes(response ? AST.caseSetCasesOf(response) : [])
  }

  private createMutableScope(statement: AST.SetStatement | AST.ToggleStatement): Langium.Scope {
    let scope = this.createScopeForNodes([])

    const app = owningAppDeclaration(statement)
    if (app?.block) {
      scope = this.createScopeForNodes(app.block.statements.filter(AST.isStateDeclaration), scope)
    }

    for (const block of AST.ancestorBlocks(statement).reverse()) {
      scope = this.createScopeForNodes(statesOwnedByBlock(block), scope)
    }

    const view = AST.findOwningView(statement)
    if (view) {
      scope = this.createScopeForParameters(view, scope, statement)
    }
    const action = AST.findOwningAction(statement)
    if (action) {
      scope = this.createScopeForParameters(action, scope, statement)
    }
    const fn = AST.findOwningFunction(statement)
    if (fn) {
      scope = this.createScopeForParameters(fn, scope, statement)
    }

    return scope
  }

  /**
   * A render site names a view or a nav — `nav is scene is view` — and the owning view's own view-,
   * scene-, or nav-typed parameters shadow both, the way any parameter shadows a declaration. That
   * is what lets a shell render the navigator it was handed rather than one it names.
   */
  private createViewScope(render: AST.Render): Langium.Scope {
    const root = AST.findRoot(render)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const isRenderable = (node: AST.Node): node is AST.ViewDeclaration | AST.NavDeclaration =>
      AST.isViewDeclaration(node) || AST.isNavDeclaration(node)
    let scope = this.createScopeForNodes(root.statements.filter(isRenderable))
    scope = this.createScopeForNodes(this.importedDeclarations(render, isRenderable), scope)
    const owner = AST.findOwningView(render)
    const parameters = owner ? AST.parametersOf(owner).filter(isRenderableParameter) : []
    const firstParameter = parameters[0]
    if (!firstParameter) {
      return scope
    }
    const document = AST.getDocument(firstParameter)
    const descriptions = parameters.flatMap(parameter => {
      const name = parameterValueName(parameter)
      return name ? [this.descriptions.createDescription(parameter, name, document)] : []
    })
    return this.createScope(descriptions, scope)
  }

  private createRenderSlotScope(use: AST.RenderSlotUse): Langium.Scope {
    if (!use.render) {
      const owner = AST.findOwningView(use)
      return this.createScopeForNodes(
        AST.isViewDeclaration(owner) ? AST.renderSlotDeclarationsOf(owner) : [],
      )
    }

    const block = use.$container
    const invocation = AST.isBlock(block) && AST.isRender(block.$container) ? block.$container : undefined
    const targetName = invocation?.view?.$refText
    const root = AST.findRoot(use)
    if (!targetName || !AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }

    // Resolve by the invocation's source name without touching its `.ref` while this slot itself
    // is linking. The ordinary render reference is linked independently by the same visible set.
    const views = [
      ...root.statements.filter(AST.isViewDeclaration),
      ...this.importedDeclarations(use, AST.isViewDeclaration),
    ]
    const target = views.find(candidate => candidate.name === targetName)
    return this.createScopeForNodes(target ? AST.renderSlotDeclarationsOf(target) : [])
  }

  /** A call resolves a pure function or named copy; both share the one call shape (Decisions §14). */
  private createFunctionScope(call: AST.FunctionCallExpression): Langium.Scope {
    return this.createDeclarationScope(call, AST.isCallableDeclaration)
  }

  private createAppViewScope(node: AST.AppView): Langium.Scope {
    return this.createDeclarationScope(node, AST.isViewDeclaration)
  }

  private createDeclarationScope<DeclarationT extends AST.Declaration>(
    node: AST.Node,
    isDeclaration: (node: AST.Node) => node is DeclarationT,
  ): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(isDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(node, isDeclaration), scope)
    return scope
  }

  /**
   * A reference block names declarations rather than values, and which declarations it may name is
   * the slot's element type: `Toolbar { Save }` lists commands, `Data { Stories }` lists data
   * collections. Both reach this one scope, so the slot contract decides what is legal rather than
   * the scope narrowing it by name. Collections layer under ordinary values because a plural
   * collection name and a value name occupy the same table for the reader.
   */
  private createConfigurationReferenceScope(entry: AST.ConfigurationEntry): Langium.Scope {
    return this.createValueScope(entry, this.createDataCollectionScope(entry))
  }

  private createDataCollectionScope(node: AST.Node): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const declarations = [
      ...root.statements.filter(AST.isEntityDataDeclaration),
      ...this.importedDeclarations(node, AST.isEntityDataDeclaration),
    ]
    return this.createScope(
      declarations.map(declaration =>
        this.descriptions.createDescription(declaration, declaration.name, AST.getDocument(declaration))
      ),
    )
  }

  private createEntityDataScope(node: AST.Node): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const declarations = [
      ...root.statements.filter(AST.isEntityDataDeclaration),
      ...this.importedDeclarations(node, AST.isEntityDataDeclaration),
    ]
    const descriptions = declarations.map(declaration =>
      this.descriptions.createDescription(declaration, declaration.singularName, AST.getDocument(declaration))
    )
    return this.createScope(descriptions)
  }

  private createFixtureDeclarationScope(node: AST.ScenarioFixtureClause): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    return this.createScopeForNodes([
      ...root.statements.filter(AST.isFixtureDeclaration),
      ...this.importedDeclarations(node, AST.isFixtureDeclaration),
    ])
  }

  private createScenarioSubjectScope(node: AST.ScenarioGroupDeclaration): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes([
      ...AST.appValueDeclarationsInFile(root),
      ...root.statements.filter(AST.isViewDeclaration),
    ])
    scope = this.createScopeForNodes(
      this.importedDeclarations(node, AST.isScenarioSubjectDeclaration),
      scope,
    )
    return scope
  }

  private createFixtureAccountScope(node: AST.FixtureCreateBinding): Langium.Scope {
    return this.createScopeForNodes(this.fixtureValuesBefore(node).filter(AST.isFixtureAccountDeclaration))
  }

  private createFixtureValueScope(reference: AST.FixtureValueReference): Langium.Scope {
    const fixture = AST.findOwningFixture(reference)
    if (fixture) {
      const entry = fixture.block.entries.find(candidate => containsNode(candidate, reference))
      if (entry) {
        return this.createScopeForNodes(this.fixtureValuesBefore(entry))
      }
      return this.createScopeForNodes(AST.fixtureValueDeclarations(fixture))
    }
    return this.createScopeForNodes(this.scenarioFixtureValues(reference))
  }

  private createScenarioFixtureValueScope(node: AST.ScenarioPrepareUpdate): Langium.Scope {
    return this.createScopeForNodes(this.scenarioFixtureValues(node))
  }

  private fixtureValuesBefore(entry: AST.FixtureEntry): AST.FixtureValueDeclaration[] {
    const fixture = AST.findOwningFixture(entry)
    if (!fixture) {
      return []
    }
    const index = fixture.block.entries.indexOf(entry)
    return fixture.block.entries.slice(0, index).filter(AST.isFixtureValueDeclaration)
  }

  private scenarioFixtureValues(node: AST.Node): AST.FixtureValueDeclaration[] {
    const scenario = AST.findOwningScenario(node)
    const group = AST.findOwningScenarioGroup(node)
    const fixture = scenario
      ? AST.effectiveScenarioClause(scenario, AST.isScenarioFixtureClause)?.fixture.ref
      : group?.block.entries.find(AST.isScenarioFixtureClause)?.fixture.ref
    return fixture ? AST.fixtureValueDeclarations(fixture) : []
  }

  private createDataWriteValueScope(reference: AST.ValueReference): Langium.Scope {
    const outer = this.createValueScope(reference)
    const write = reference.$container
    const block = AST.isDataWriteField(write) ? write.$container : undefined
    const operation = block?.$container
    const entity = entityDataForWrite(operation)
    if (!entity) {
      return outer
    }
    const descriptions = entity.block.entries
      .filter(AST.isEntityDataField)
      .flatMap(field => this.booleanFieldCaseDescriptions(field))
    return this.createScope(descriptions, outer)
  }

  private createBooleanWhereScope(where: AST.BooleanWhereClause): Langium.Scope {
    const query = where.$container.$container
    const entity = AST.isEntityQueryDeclaration(query) ? entityDataForQuery(query) : undefined
    if (!entity) {
      return this.createScopeForNodes([])
    }
    const descriptions = entity.block.entries
      .filter(AST.isEntityDataField)
      .flatMap(field => this.booleanFieldCaseDescriptions(field))
    return this.createScope(descriptions)
  }

  private createCaseTestScope(test: AST.CaseTestExpression): Langium.Scope {
    const root = AST.findRoot(test)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const caseSetCases = [
      ...root.statements.filter(AST.isTypeDeclaration).flatMap(AST.caseSetCasesOf),
      ...this.importedCaseSetCases(test),
    ]
    const exactField = booleanFieldForCaseTest(test)
    const fields = AST.visibleFileDeclarations(test, AST.isEntityDataDeclaration).flatMap(entity =>
      entity.block.entries.filter(AST.isEntityDataField).filter(field => field.boolean)
    )
    let scope = this.createScope(fields.flatMap(field => this.booleanFieldCaseDescriptions(field)))
    scope = this.createScopeForNodes(caseSetCases, scope)
    if (exactField) {
      scope = this.createScope(this.booleanFieldCaseDescriptions(exactField), scope)
    }
    return scope
  }

  private createFailureCaseScope(node: AST.FailStatement | AST.ActionFailureDeclaration): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(
      root.statements.filter(AST.isTypeDeclaration).flatMap(AST.caseSetCasesOf),
    )
    scope = this.createScopeForNodes(this.importedCaseSetCases(node), scope)
    return scope
  }

  private booleanFieldCaseDescriptions(field: AST.EntityDataField) {
    if (!field.boolean) {
      return []
    }
    const document = AST.getDocument(field)
    const cases = [this.descriptions.createDescription(field, field.name, document)]
    if (field.negativeName) {
      cases.push(this.descriptions.createDescription(field, field.negativeName, document))
    }
    return cases
  }

  private createRunAppScope(
    node:
      | AST.RunStep
      | AST.NavigationTarget
      | AST.SelectionActivateStatement
      | AST.ReplaceStatement
      | AST.ScenarioRunClause,
  ): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(AST.appValueDeclarationsInFile(root))
    scope = this.createScopeForNodes(
      this.importedDeclarations(
        node,
        AST.isConcreteAppValueDeclaration,
      ),
      scope,
    )
    return scope
  }

  private createUseImportScope(useStatement: AST.UseStatement): Langium.Scope {
    return this.createScopeForNodes(this.collectTargetDeclarations(useStatement))
  }

  /** A namespace name resolves only against this file's own use-package statements. */
  private createPackageNamespaceScope(reference: AST.PackageMemberReference): Langium.Scope {
    const root = AST.findRoot(reference)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const statements = root.statements.filter(AST.isUsePackageStatement)
    const descriptions = statements.flatMap(statement => {
      const name = AST.packageNamespaceName(statement)
      return name ? [this.descriptions.createDescription(statement, name, AST.getDocument(statement))] : []
    })
    return this.createScope(descriptions)
  }

  /** A member resolves against what the namespace's package exports to this file. */
  private createPackageMemberScope(reference: AST.PackageMemberReference): Langium.Scope {
    const statement = reference.namespace.ref
    if (!AST.isUsePackageStatement(statement)) {
      return this.createScopeForNodes([])
    }
    return this.createScopeForNodes(this.collectTargetDeclarations(statement))
  }

  private importedCaseSetCases(node: AST.Node): AST.CaseSetCase[] {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return []
    }
    return root.statements
      .filter(AST.isUseStatement)
      .flatMap(useStatement =>
        AST.resolvedImportedDeclarations(useStatement)
          .filter(AST.isTypeDeclaration)
          .flatMap(AST.caseSetCasesOf)
      )
  }

  private createScopeForParameters(
    declaration: AST.ParameterizedDeclaration,
    outerScope: Langium.Scope,
    reference?: AST.Node,
  ): Langium.Scope {
    const parameters = visibleParametersAtReference(declaration, reference)
    const firstParameter = parameters[0]
    if (!firstParameter) {
      return outerScope
    }
    const document = AST.getDocument(firstParameter)
    const descriptions = parameters.flatMap(parameter => {
      const name = parameterValueName(parameter)
      return name ? [this.descriptions.createDescription(parameter, name, document)] : []
    })
    return this.createScope(descriptions, outerScope)
  }

  private importedDeclarations<DeclarationT extends AST.Declaration>(
    node: AST.Node,
    isDeclaration: (node: AST.Node) => node is DeclarationT,
  ): DeclarationT[] {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return []
    }
    const document = AST.getDocument(node)
    const currentPath = document.uri.path

    const declarations: DeclarationT[] = [...this.folderDeclarations(currentPath, isDeclaration)]
    for (const useStatement of root.statements.filter(AST.isUseStatement)) {
      const importedNames = new Set(useStatement.importedDeclarations.map(reference => reference.$refText))
      for (const statement of this.collectTargetDeclarations(useStatement, currentPath)) {
        if (AST.isDeclaration(statement) && isDeclaration(statement) && importedNames.has(statement.name)) {
          declarations.push(statement)
        }
      }
    }
    return declarations
  }

  // A `folder` declaration joins its siblings' scopes with no `use` statement naming it. This sits
  // inside importedDeclarations so every scope layer picks it up in its own namespace.
  private folderDeclarations<DeclarationT extends AST.Declaration>(
    currentPath: string,
    isDeclaration: (node: AST.Node) => node is DeclarationT,
  ): DeclarationT[] {
    const currentDirectory = currentPath.slice(0, currentPath.lastIndexOf('/'))
    const declarations: DeclarationT[] = []
    for (const document of this.coreServices.shared.workspace.LangiumDocuments.all) {
      const path = document.uri.path
      if (
        path === currentPath
        || AST.isTestSidecarPath(path)
        || path.slice(0, path.lastIndexOf('/')) !== currentDirectory
      ) {
        continue
      }
      const file = document.parseResult.value
      if (!AST.isTaoFile(file)) {
        continue
      }
      for (const statement of file.statements) {
        if (isDeclaration(statement) && declaredVisibility(statement) === 'folder') {
          declarations.push(statement)
        }
      }
    }
    return declarations
  }

  private collectTargetDeclarations(
    useStatement: AST.UseStatement | AST.UsePackageStatement,
    currentPath?: string,
  ): AST.Declaration[] {
    const resolved = this.useTargets.get(useStatement)
    if (resolved !== undefined) {
      return resolved
    }
    const path = currentPath ?? AST.getDocument(useStatement).uri.path
    const allFiles = Array.from(this.coreServices.shared.workspace.LangiumDocuments.all)
      .map(document => document.parseResult.value)
      .filter(AST.isTaoFile)
    const declarations = [...this.packages.collectTargetDeclarations(useStatement, {
      fromFilePath: path,
      workspaceFiles: allFiles,
    })]
    AST.rememberUseTargets(useStatement, declarations)
    this.useTargets.set(useStatement, declarations)
    return declarations
  }
}

function entityDataForWrite(operation: AST.Node | undefined): AST.EntityDataDeclaration | undefined {
  if (AST.isCreateStatement(operation)) {
    return operation.entity?.ref
  }
  if (!AST.isUpdateStatement(operation) || !AST.isValueReference(operation.target)) {
    return undefined
  }
  const target = operation.target.target.ref
  return AST.isValueDeclaration(target) ? entityDataForValueDeclaration(target, operation) : undefined
}

function containsNode(ancestor: AST.Node, node: AST.Node): boolean {
  let current: AST.Node | undefined = node
  while (current) {
    if (current === ancestor) {
      return true
    }
    current = current.$container
  }
  return false
}

function entityDataForValueDeclaration(
  declaration: AST.ValueDeclaration | undefined,
  context: AST.Node,
): AST.EntityDataDeclaration | undefined {
  // A parameter reaches an entity whether it takes its same-named type (`Document`) or renames a
  // typed one (`Track Song`): the entity is what the type names, not what the parameter is called.
  if (AST.isParameterDeclaration(declaration)) {
    const type = declaration.inlineType ? declaration.inlineType.type : declaration.type
    if (AST.isNamedTypeReference(type) && type.members.length === 0) {
      return AST.visibleFileDeclarations(context, AST.isEntityDataDeclaration).find(entity =>
        entity.singularName === type.root
      )
    }
  }
  if (AST.isForStatement(declaration)) {
    return entityDataForCollection(declaration.collection, context)
  }
  return undefined
}

function booleanFieldForCaseTest(test: AST.CaseTestExpression): AST.EntityDataField | undefined {
  const subject = test.value
  if (!AST.isMemberAccessExpression(subject)) {
    return undefined
  }
  const target = subject.target.ref
  let entity = AST.isValueDeclaration(target) ? entityDataForValueDeclaration(target, test) : undefined
  for (const [index, member] of subject.members.entries()) {
    const field = entity?.block.entries
      .filter(AST.isEntityDataField)
      .find(candidate => candidate.name === member)
    if (!field) {
      return undefined
    }
    if (index === subject.members.length - 1) {
      return field.boolean ? field : undefined
    }
    entity = relationEntityForField(field, test)
  }
  return undefined
}

function relationEntityForField(
  field: AST.EntityDataField,
  context: AST.Node,
): AST.EntityDataDeclaration | undefined {
  if (field.primitive || field.boolean) {
    return undefined
  }
  const relationName = field.name
  return AST.visibleFileDeclarations(context, AST.isEntityDataDeclaration).find(entity =>
    entity.singularName === relationName || entity.name === relationName
  )
}

function entityDataForCollection(
  collection: AST.Expression,
  context: AST.Node,
): AST.EntityDataDeclaration | undefined {
  if (AST.isValueReference(collection) && AST.isEntityQueryDeclaration(collection.target.ref)) {
    return entityDataForQuery(collection.target.ref)
  }
  if (!AST.isMemberAccessExpression(collection)) {
    return undefined
  }
  const target = collection.target.ref
  const owner = AST.isValueDeclaration(target) ? entityDataForValueDeclaration(target, context) : undefined
  const fieldName = collection.members.at(-1)
  if (!owner || !fieldName) {
    return undefined
  }
  return AST.visibleFileDeclarations(context, AST.isEntityDataDeclaration).find(entity => entity.name === fieldName)
}

function entityDataForQuery(query: AST.EntityQueryDeclaration): AST.EntityDataDeclaration | undefined {
  if (query.source) {
    return entityDataForCollection(query.source, query)
  }
  const sourceName = query.sourceName ?? query.name
  return AST.visibleFileDeclarations(query, AST.isEntityDataDeclaration).find(entity => entity.name === sourceName)
}

type ScopeCarrier =
  | { kind: 'block'; block: AST.Block }
  | { kind: 'action-block'; block: AST.ActionBlock }
  | { kind: 'payload'; payload: AST.CasePayload }

/** scopeCarriersContaining returns blocks and case payloads from innermost to outermost. */
function scopeCarriersContaining(node: AST.Node): ScopeCarrier[] {
  const carriers: ScopeCarrier[] = []
  let current: AST.Node | undefined = node.$container
  while (current) {
    if (AST.isBlock(current)) {
      carriers.push({ kind: 'block', block: current })
    }
    if (AST.isActionBlock(current)) {
      carriers.push({ kind: 'action-block', block: current })
    }
    if (
      (AST.isGuardActionBranch(current) || AST.isGuardRenderBranch(current) || AST.isWhenRenderBranch(current)
        || AST.isWhenDoOutcome(current) || AST.isGuardDefaultBranch(current))
      && current.payload
    ) {
      carriers.push({ kind: 'payload', payload: current.payload })
    }
    if (AST.isEventHandler(current) && current.payload) {
      carriers.push({ kind: 'payload', payload: current.payload })
    }
    current = current.$container
  }
  return carriers
}

function statesOwnedByBlock(block: AST.Block): AST.StateDeclaration[] {
  return block.statements.filter(AST.isStateDeclaration)
}

function owningAppDeclaration(node: AST.Node): AST.AppDeclaration | undefined {
  let current: AST.Node | undefined = node
  while (current) {
    if (AST.isAppDeclaration(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

function visibleParametersAtReference(
  declaration: AST.ParameterizedDeclaration,
  reference: AST.Node | undefined,
): readonly AST.ParameterDeclaration[] {
  const parameters = AST.parametersOf(declaration)
  const defaultParameter = parameterOwningDefault(reference)
  const index = defaultParameter ? parameters.indexOf(defaultParameter) : -1
  return index >= 0 ? parameters.slice(0, index) : parameters
}

function parameterOwningDefault(node: AST.Node | undefined): AST.ParameterDeclaration | undefined {
  let current = node
  while (current) {
    if (AST.isParameterDeclaration(current)) {
      return current.defaultValue ? current : undefined
    }
    current = current.$container
  }
  return undefined
}

/** isRenderableParameter reports a parameter whose declared type a render site may name. */
function isRenderableParameter(parameter: AST.ParameterDeclaration): boolean {
  return AST.renderablePrimitiveOfParameter(parameter) !== undefined
}

function parameterValueName(parameter: AST.ParameterDeclaration): string | undefined {
  if (parameter.inlineType) {
    return parameter.inlineType.name
  }
  if (!parameter.type) {
    return undefined
  }
  const lastMember = parameter.type.members.at(-1)
  return lastMember ?? parameter.type.root
}

/** Selects a same-named constructor root by the qualified member it actually declares. */
function preferredConstructorDeclarations(
  node: AST.ConfiguredValue,
  candidates: readonly AST.ConstructorDeclaration[],
): AST.ConstructorDeclaration[] {
  const rootName = node.type.$refText
  const sameName = candidates.filter(candidate => candidate.name === rootName)
  if (sameName.length <= 1) {
    return [...candidates]
  }
  const firstMember = node.members?.[0]
  const parameterizedMatches = firstMember
    ? sameName.filter(candidate =>
      AST.isParameterizedDeclaration(candidate)
      && AST.parametersOf(candidate).some(parameter => parameter.inlineType?.name === firstMember)
    )
    : []
  const typeMatches = sameName.filter(AST.isTypeDeclaration)
  const preferred = parameterizedMatches.length > 0
    ? parameterizedMatches
    : typeMatches.length > 0
    ? typeMatches
    : sameName
  return [
    ...candidates.filter(candidate => candidate.name !== rootName),
    ...preferred,
  ]
}

/** declaredVisibility reads a declaration's visibility marker without depending on @ast-utils. */
function declaredVisibility(declaration: AST.Node): string | undefined {
  return 'visibility' in declaration ? (declaration as { visibility?: string }).visibility : undefined
}

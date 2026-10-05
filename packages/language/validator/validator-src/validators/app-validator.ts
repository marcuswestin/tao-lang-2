import { ASTUtils, Packages, Type } from '@ast-utils'
import { AST } from '@parser'
import type { AppValidationMemo, ValidationContext } from '../validation'
import { validateAgentCommands } from './agent-commands-validator'
import { validateReferenceBlock } from './configured-values-validator'
import { reportPresentationBindingDiagnostic } from './navigation-validator'
import { isValidSemverVersion } from './package-validator'
import { validateAppRequirementOwnership } from './requirement-ownership-validator'
import { primitiveSlots } from './workspace-index'

/** appValidationMessages declares structural diagnostics for Tao app placement and configuration. */
const appValidationMessages = {
  topLevel:
    'Only package, app, nav, datasource, ui, dialogue, view, layout, let, function, action, data, type, enum, test declarations, and use statements are allowed at file level.',
  appBlock: (name: string) => `App ${name} contains a statement that is not app configuration.`,
  appRootCount: (name: string, count: number) =>
    `App ${name} must declare exactly one Navigator (or root view), found ${count}.`,
  rootViewPlacement: 'A root view is declared in an app block or in an app variant.',
  identity: (name: string, field: string) => `App ${name} needs an effective ${field} text value.`,
  invalidIdentityVersion: (name: string, value: string) =>
    `App ${name} version '${value}' must be a valid SemVer version.`,
  duplicateIdentity: (id: string, version: string) =>
    `App id '${id}' and version '${version}' identify more than one app in this project.`,
  guardPlacement: 'An app guard is declared in an app block or in an app variant.',
  guardDuplicate: (name: string) => `App ${name} declares guard more than once.`,
  auxiliaryType: (name: string, key: string, actual: string) => `App ${name}@${key} expects nav, got ${actual}.`,
  duplicateAuxiliary: (name: string, key: string) => `App ${name} declares auxiliary navigator @${key} more than once.`,
  auxiliaryKey: (key: string) => `App auxiliary '${key}' must be a single @name key.`,
  variantProperty: (name: string, property: string) =>
    `App variant ${name} cannot patch unknown property '${property}'.`,
  missingProperty: (name: string, property: string) => `App ${name} must supply '${property}'.`,
  propertyDuplicate: (name: string, property: string) => `App ${name} supplies '${property}' more than once.`,
  propertyType: (name: string, property: string, expected: string, actual: string) =>
    `App ${name} ${property} expects ${expected}, got ${actual}.`,
  headType: (name: string, actual: string) => `App head ${name} expects app, got ${actual}.`,
  restorationDuplicate: (name: string) => `App ${name} declares Restore more than once.`,
  restorationFreshExclusions: () =>
    `Restore fresh cannot declare exclusions because it neither reads nor writes state.`,
  restorationExclusion: (value: string) =>
    `Unknown restoration exclusion '${value}'; expected sheets, menus, or toasts.`,
  restorationExclusionDuplicate: (value: string) => `Restoration exclusion '${value}' is declared more than once.`,
} as const

/** AppValidator validates Tao app placement and Prelude-owned supplied slots. */
export const AppValidator = {
  messages: appValidationMessages,
  createBatchMemo,
  validate,
}

/** createBatchMemo owns private app caches; callers discard them before any build or relink. */
function createBatchMemo(): AppValidationMemo {
  const values = new Map<AST.TaoFile, readonly AST.AppValueDeclaration[]>()
  const identities = new Map<Packages.Context, {
    files: readonly AST.TaoFile[]
    first: ReadonlyMap<string, AST.AppValueDeclaration>
  }[]>()
  return {
    values(file, compute) {
      let apps = values.get(file)
      if (!apps) {
        apps = Object.freeze([...compute()])
        values.set(file, apps)
      }
      return apps
    },
    identities(packagesContext, files, compute) {
      // App ordering sorts by document path and offset. Preserve input order for distinct
      // same-path ASTs because stable ties choose which app owns the first identity.
      const ordered = files.toSorted((left, right) =>
        AST.getDocument(left).uri.path.localeCompare(AST.getDocument(right).uri.path)
      )
      let entries = identities.get(packagesContext)
      if (!entries) {
        entries = []
        identities.set(packagesContext, entries)
      }
      const existing = entries.find(entry =>
        entry.files.length === ordered.length && entry.files.every((file, index) => file === ordered[index])
      )
      if (existing) {
        return existing.first
      }
      const first = compute()
      entries.push({ files: ordered, first })
      return first
    },
  }
}

function appValues(file: AST.TaoFile, ctx: ValidationContext): readonly AST.AppValueDeclaration[] {
  const compute = () => AST.appValueDeclarationsInFile(file)
  return ctx.appMemo ? ctx.appMemo.values(file, compute) : compute()
}

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  validateTopLevelStatements(file, ctx)
  const apps = [
    ...file.statements.filter(AST.isAppDeclaration),
    ...appValues(file, ctx).filter(app => !AST.isAppDeclaration(app)),
  ]
  for (const app of apps) {
    validateAgentCommands(app, ctx)
    if (AST.isAppDeclaration(app)) {
      validateAppDeclaration(app, ctx)
    }
    if (app.value && AST.isRefinementExpression(app.value)) {
      validateAppVariant(app, app.value, ctx)
    }
    validateAppIdentity(app, ctx)
    validateAppRequirementOwnership(app, ctx)
  }
  const nodes = ctx.nodesInFile?.(file) ?? AST.streamAllContents(file)
  for (const root of nodes.filter(AST.isAppView)) {
    validateRootViewPlacement(root, ctx)
  }
  for (const guard of nodes.filter(AST.isAppGuardStatement)) {
    validateAppGuardPlacement(guard, ctx)
  }
}

function validateAppGuardPlacement(guard: AST.AppGuardStatement, ctx: ValidationContext): void {
  if (AST.isAppBlock(guard.$container) && AST.isAppDeclaration(guard.$container.$container)) {
    return
  }
  const entry = guard.$container
  if (AST.isConfigurationEntry(entry)) {
    const owner = entry.$container.$container
    if (AST.isRefinementExpression(owner)) {
      const type = Type.ofExpression(owner)
      if (type.kind === 'primitive' && type.primitive === 'app') {
        return
      }
    }
  }
  ctx.error(guard, appValidationMessages.guardPlacement)
}

function validateAppIdentity(app: AST.AppValueDeclaration, ctx: ValidationContext): void {
  const configuration = ASTUtils.effectiveAppConfiguration(app)
  const values = new Map<string, string>()
  for (const field of ['id', 'version', 'name']) {
    const source = configuration.get(field)?.value
    if (!source || !AST.isStringLiteral(source) || source.value.trim() === '') {
      ctx.error(app, appValidationMessages.identity(app.name, field))
      continue
    }
    values.set(field, source.value)
  }
  const version = values.get('version')
  if (version && !isValidSemverVersion(version)) {
    ctx.error(app, appValidationMessages.invalidIdentityVersion(app.name, version))
  }
  const id = values.get('id')
  if (!id || !version || !isValidSemverVersion(version)) {
    return
  }
  const root = Packages.projectRootForPath(ctx.packagesContext.index, AST.getDocument(app).uri.path)
  const computeIdentities = () => {
    const first = new Map<string, AST.AppValueDeclaration>()
    const apps = ctx.workspaceFiles.flatMap(file => appValues(file, ctx))
      .toSorted((left, right) => {
        const pathOrder = AST.getDocument(left).uri.path.localeCompare(AST.getDocument(right).uri.path)
        return pathOrder || (left.$cstNode?.offset ?? 0) - (right.$cstNode?.offset ?? 0)
      })
    for (const candidate of apps) {
      const candidateRoot = Packages.projectRootForPath(ctx.packagesContext.index, AST.getDocument(candidate).uri.path)
      const candidateConfiguration = ASTUtils.effectiveAppConfiguration(candidate)
      const candidateId = candidateConfiguration.get('id')?.value
      const candidateVersion = candidateConfiguration.get('version')?.value
      if (!AST.isStringLiteral(candidateId) || !AST.isStringLiteral(candidateVersion)) {
        continue
      }
      const key = `${candidateRoot ?? ''}#${candidateId.value}@${candidateVersion.value}`
      if (!first.has(key)) {
        first.set(key, candidate)
      }
    }
    return first
  }
  const firstByIdentity = ctx.memo('app-validator.firstByIdentity', () =>
    ctx.appMemo
      ? ctx.appMemo.identities(ctx.packagesContext, ctx.workspaceFiles, computeIdentities)
      : computeIdentities())
  if (firstByIdentity.get(`${root ?? ''}#${id}@${version}`) !== app) {
    ctx.error(app, appValidationMessages.duplicateIdentity(id, version))
  }
}

// A root view statement parses inside any configuration block, because a variant's patch is one;
// only an app value has a root to rebind.
function validateRootViewPlacement(root: AST.AppView, ctx: ValidationContext): void {
  const entry = root.$container
  if (!AST.isConfigurationEntry(entry)) {
    return
  }
  const owner = entry.$container.$container
  const type = AST.isExpression(owner) ? Type.ofExpression(owner) : { kind: 'unresolved' as const }
  if (type.kind !== 'unresolved' && !Type.isAssignable(type, { kind: 'primitive', primitive: 'app' })) {
    ctx.error(root, appValidationMessages.rootViewPlacement)
  }
}

function validateAppDeclaration(app: AST.AppDeclaration, ctx: ValidationContext): void {
  if (app.value) {
    const actual = Type.ofExpression(app.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'app' })) {
      ctx.error(app.value, appValidationMessages.headType(app.name, Type.displayName(actual)))
    }
    return
  }
  const statements = AST.blockStatements(app)
  const properties = statements.filter(AST.isAppProperty)
  const roots = statements.filter(AST.isAppView)
  const restoration = statements.filter(AST.isRestorationPolicy)
  for (const guard of statements.filter(AST.isAppGuardStatement).slice(1)) {
    ctx.error(guard, appValidationMessages.guardDuplicate(app.name))
  }
  for (const statement of statements) {
    if (
      !AST.isAppProperty(statement)
      && !AST.isAppView(statement)
      && !AST.isAppAuxiliaryNavigator(statement)
      && !AST.isPackageRequires(statement)
      && !AST.isRestorationPolicy(statement)
      && !AST.isAppGuardStatement(statement)
      && !AST.isStateDeclaration(statement)
      && !AST.isActionDeclaration(statement)
    ) {
      ctx.error(statement, appValidationMessages.appBlock(app.name))
    }
  }
  const supplied = [...properties.map(suppliedSlotOfProperty), ...rootViewSlots(app, roots, ctx)]
  validateAppProperties(app.name, supplied, app, ctx, true)
  validateAppAuxiliaryNavigators(app, ctx)
  validateRestorationPolicies(app.name, restoration, ctx)
}

/** SuppliedSlot names one app slot supplied as an app property, a variant patch entry, or root-view sugar. */
type SuppliedSlot = {
  /** block is the reference block a list-typed slot supplies instead of a value. */
  readonly block?: AST.ConfigurationBlock
  readonly name: string
  readonly node: AST.Node
  readonly patched: boolean
  /** sugar marks a slot the language supplies itself, so it carries no source value to type-check. */
  readonly sugar?: boolean
  readonly value?: AST.Expression | AST.ConfigurationValue
}

// `app X { view Y }` supplies the Navigator slot with a generated slot navigator.
function rootViewSlots(
  app: AST.AppDeclaration,
  roots: readonly AST.AppView[],
  ctx: ValidationContext,
): SuppliedSlot[] {
  if (roots.length > 1) {
    ctx.error(app, appValidationMessages.appRootCount(app.name, roots.length))
  }
  const root = roots[0]
  if (!root) {
    return []
  }
  validateRootViewArguments(root, ctx)
  return [
    { name: 'Navigator', node: root, patched: false, sugar: true },
  ]
}

function validateAppProperties(
  appName: string,
  supplied: readonly SuppliedSlot[],
  owner: AST.Node,
  ctx: ValidationContext,
  requireComplete: boolean,
): void {
  const contract = primitiveSlots(ctx, 'app')
  const contractByName = new Map(contract.map(slot => [slot.name, slot]))
  const seen = new Set<string>()
  for (const slot of supplied) {
    const expected = contractByName.get(slot.name)
    if (!expected) {
      ctx.error(slot.node, appValidationMessages.variantProperty(appName, slot.name))
      continue
    }
    if (seen.has(slot.name)) {
      ctx.error(slot.node, appValidationMessages.propertyDuplicate(appName, slot.name))
    }
    seen.add(slot.name)
    if (slot.sugar || slot.name === 'AgentCommands') {
      continue
    }
    if (slot.block) {
      validateReferenceBlock(slot.block, expected, slot.name, appName, ctx)
      continue
    }
    if (!slot.value) {
      if (slot.patched && !requireComplete) {
        continue
      }
      ctx.error(
        slot.node,
        appValidationMessages.propertyType(
          appName,
          slot.name,
          Type.displayName(Type.ofProperty(expected)),
          'patch',
        ),
      )
      continue
    }
    // A slot whose declared default is `none` is optional, so `none` is one of its legal fills.
    if (AST.isExpression(slot.value) && AST.isNoneLiteral(slot.value) && !Type.propertyRequiresValue(expected)) {
      continue
    }
    // Configuration-only nodes carry no expression type; the owning configuration validator checks those.
    const actual = AST.isExpression(slot.value) ? Type.ofExpression(slot.value) : { kind: 'unresolved' as const }
    const expectedType = Type.ofProperty(expected)
    if (
      actual.kind !== 'unresolved' && expectedType.kind !== 'unresolved'
      && !Type.isAssignableToSlot(actual, expectedType)
    ) {
      ctx.error(
        slot.value,
        appValidationMessages.propertyType(
          appName,
          slot.name,
          Type.displayName(expectedType),
          Type.displayName(actual),
        ),
      )
    }
  }
  if (!requireComplete) {
    return
  }
  for (const required of contract.filter(Type.propertyRequiresValue)) {
    if (required.name === 'id' || required.name === 'version' || required.name === 'name') {
      continue
    }
    if (seen.has(required.name)) {
      continue
    }
    const node = supplied[0]?.node ?? owner
    if (required.name === 'Navigator') {
      ctx.error(node, appValidationMessages.appRootCount(appName, 0))
    } else {
      ctx.error(node, appValidationMessages.missingProperty(appName, required.name))
    }
  }
}

// The synthesized navigator presents the root view exactly as `Initial Shell(args)` would, so its
// arguments bind by the ordinary presentation rules and carry the same diagnostics.
function validateRootViewArguments(root: AST.AppView, ctx: ValidationContext): void {
  const view = root.view.ref
  if (!view) {
    return
  }
  for (const diagnostic of ASTUtils.resolveArgumentBindings(view, root).diagnostics) {
    reportPresentationBindingDiagnostic(view, diagnostic, root, ctx)
  }
}

function suppliedSlotOfProperty(property: AST.AppProperty): SuppliedSlot {
  const references = property.value ? ASTUtils.referenceBlockOf(property.value) : undefined
  return {
    block: references,
    name: property.name,
    node: property,
    patched: property.patch !== undefined,
    value: references ? undefined : property.value,
  }
}

function validateAppVariant(
  variant: AST.AppValueDeclaration,
  refinement: AST.RefinementExpression,
  ctx: ValidationContext,
): void {
  const supplied = refinement.patchBlock.entries.flatMap<SuppliedSlot>(entry => {
    if (entry.restoration || entry.requirement || entry.appGuard) {
      return []
    }
    if (entry.rootView) {
      validateRootViewArguments(entry.rootView, ctx)
      return [{ name: 'Navigator', node: entry, patched: false, sugar: true }]
    }
    if (!entry.name) {
      ctx.error(entry, appValidationMessages.variantProperty(variant.name, entry.key ?? ''))
      return []
    }
    const patched = entry.value !== undefined && AST.isPropertyConfigurationPatch(entry.value)
    return [{
      block: entry.block,
      name: entry.name,
      node: entry,
      patched,
      value: patched ? undefined : entry.value,
    }]
  })
  validateAppProperties(variant.name, supplied, variant, ctx, false)
  const restoration = refinement.patchBlock.entries.flatMap(entry => entry.restoration ? [entry.restoration] : [])
  for (const guard of refinement.patchBlock.entries.flatMap(entry => entry.appGuard ? [entry.appGuard] : []).slice(1)) {
    ctx.error(guard, appValidationMessages.guardDuplicate(variant.name))
  }
  validateRestorationPolicies(variant.name, restoration, ctx)
}

function validateRestorationPolicies(
  appName: string,
  policies: readonly AST.RestorationPolicy[],
  ctx: ValidationContext,
): void {
  for (const policy of policies.slice(1)) {
    ctx.error(policy, appValidationMessages.restorationDuplicate(appName))
  }
  const policy = policies[0]
  if (!policy) {
    return
  }
  if (policy.mode === 'fresh' && policy.exclusions) {
    ctx.error(policy.exclusions, appValidationMessages.restorationFreshExclusions())
  }
  const seen = new Set<string>()
  for (const exclusion of policy.exclusions?.exclusions ?? []) {
    if (!['sheets', 'menus', 'toasts'].includes(exclusion)) {
      ctx.error(policy.exclusions!, appValidationMessages.restorationExclusion(exclusion))
    } else if (seen.has(exclusion)) {
      ctx.error(policy.exclusions!, appValidationMessages.restorationExclusionDuplicate(exclusion))
    }
    seen.add(exclusion)
  }
}

function validateAppAuxiliaryNavigators(app: AST.AppDeclaration, ctx: ValidationContext): void {
  const auxiliaryKeys = new Set<string>()
  for (const auxiliary of AST.blockStatements(app).filter(AST.isAppAuxiliaryNavigator)) {
    const key = auxiliary.name.slice(1)
    if (!/^@[A-Za-z_][A-Za-z0-9_]*$/.test(auxiliary.name)) {
      ctx.error(auxiliary, appValidationMessages.auxiliaryKey(auxiliary.name))
    }
    if (auxiliaryKeys.has(key)) {
      ctx.error(auxiliary, appValidationMessages.duplicateAuxiliary(app.name, key))
    }
    auxiliaryKeys.add(key)
    const actual = Type.ofExpression(auxiliary.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
      ctx.error(auxiliary, appValidationMessages.auxiliaryType(app.name, key, Type.displayName(actual)))
    }
  }
}

function validateTopLevelStatements(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const statement of file.statements) {
    // A bare module query is intentionally parsed as diagnostic recovery; DataValidator owns its
    // single, language-specific explanation.
    if (AST.isEntityQueryDeclaration(statement)) {
      continue
    }
    if (!AST.isTopLevelStatement(statement)) {
      ctx.error(statement, appValidationMessages.topLevel)
    }
  }
}

import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { type ProjectDataScope, projectDataScope } from './datasource-membership-validator'

type PairingBlock = 'accepts' | 'issues' | 'supports'

const proofKindList = orList(ASTUtils.authProofKinds)
const capabilityList = orList(ASTUtils.dataCapabilities.map(capability => capability.name))

/**
 * pairingValidationMessages describes provider pairing mistakes. A provider type states what it
 * issues, accepts, and supports; an app is rejected when its Auth and Datasource cannot pair, or when
 * its data relies on a capability its datasource does not guarantee.
 */
export const pairingValidationMessages = {
  misplacedBlock: (block: PairingBlock, name: string | undefined) =>
    `'${block}' is only valid on ${block === 'issues' ? 'an auth provider type' : 'a datasource type'}${
      name ? `, and ${name} is not one` : ''
    }.`,
  duplicateBlock: (block: PairingBlock, name: string) =>
    `${name} declares '${block}' more than once; write one '${block} { … }' block.`,
  missingIssues: (name: string) =>
    `Auth provider ${name} must declare the sign-in proofs it issues with 'issues { … }'.`,
  missingSupports: (name: string) =>
    `Datasource ${name} must declare the data capabilities it guarantees with 'supports { … }'; nothing is implied, so write 'supports { }' when it guarantees none.`,
  unknownProofKind: (kind: string) => `Unknown sign-in proof kind '${kind}'; a proof kind is ${proofKindList}.`,
  duplicateProof: (proof: string) => `Sign-in proof '${proof}' is listed more than once.`,
  unknownCapability: (name: string) => `Unknown data capability '${name}'; a capability is ${capabilityList}.`,
  duplicateCapability: (name: string) => `Data capability '${name}' is listed more than once.`,
  capabilityLevelMissing: (name: string, levels: readonly string[]) =>
    `Data capability '${name}' needs a level: ${orList(levels)}.`,
  capabilityLevelUnexpected: (name: string) => `Data capability '${name}' takes no level.`,
  capabilityLevelUnknown: (name: string, level: string, levels: readonly string[]) =>
    `Data capability '${name}' has no level '${level}'; its level is ${orList(levels)}.`,
  issuerNotAuth: (name: string) => `'from ${name}' must name an auth provider type.`,
  issuerDoesNotIssue: (issuer: string, kind: string) =>
    `Auth provider ${issuer} does not issue ${kind}, so no ${kind} can come from it.`,
  noProofsAccepted: (app: string, datasource: string, auth: string) =>
    `Datasource ${datasource} accepts no sign-in proofs, so it cannot pair with Auth ${auth}; app ${app} binds both.`,
  noProofInCommon: (app: string, datasource: string, auth: string, accepted: readonly string[]) =>
    `Datasource ${datasource} accepts ${
      orList(accepted)
    }, which Auth ${auth} does not issue, so they cannot pair; app ${app} binds both.`,
  proofFromOtherAuth: (app: string, datasource: string, auth: string, kind: string, issuer: string) =>
    `Datasource ${datasource} accepts ${kind} only from ${issuer}, so it cannot pair with Auth ${auth}; app ${app} binds both.`,
  unsupportedCapability: (app: string, datasource: string, capability: string, use: string) =>
    `Datasource ${datasource} does not support ${capability}, used by ${use}; app ${app} binds it.`,
  accessWithoutAuth: (app: string, entity: string) =>
    `Access rules on ${entity} need an Auth to enforce them, but app ${app} has no Auth; bind one with 'Auth', or remove the rules.`,
} as const

/** pairingValidationChecks validates each provider type's own pairing blocks. */
export const pairingValidationChecks = {
  [AST.TypeDeclaration.$type]: (declaration, ctx) => {
    if (AST.isConfigurableDeclaration(declaration)) {
      validateRequiredBlocks(declaration, ctx)
    }
  },
  [AST.ItemTypeExpression.$type]: validateBlockPlacement,
  [AST.ConfigurationIssues.$type]: validateIssues,
  [AST.ConfigurationAccepts.$type]: validateAccepts,
  [AST.ConfigurationSupports.$type]: validateSupports,
} satisfies NodeValidationChecks

/**
 * A provider type states its pairing rather than inheriting a guess: a datasource type with no
 * `supports` guarantees nothing it could be checked against, and an auth provider type with no
 * `issues` could pair with nothing. A derived type inherits its base's blocks, and a transparent
 * alias reads its target's, so only the type that introduces a provider must write them.
 */
function validateRequiredBlocks(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
  if (declaration.aliasTarget) {
    return
  }
  const primitive = AST.configurationPrimitiveOf(declaration)
  if (primitive === 'auth' && !AST.isAuthLibraryDeclaration(declaration, 'AuthProvider')) {
    if (!AST.configurationPairingOf(declaration, 'issues')) {
      ctx.error(declaration, pairingValidationMessages.missingIssues(declaration.name))
    }
  }
  if (primitive === 'datasource' && !AST.configurationPairingOf(declaration, 'supports')) {
    ctx.error(declaration, pairingValidationMessages.missingSupports(declaration.name))
  }
}

/** Each block belongs to its primitive family, at most once per type. */
function validateBlockPlacement(slots: AST.ItemTypeExpression, ctx: ValidationContext): void {
  const owner = ownerTypeDeclaration(slots)
  const primitive = owner && AST.isConfigurableDeclaration(owner) ? AST.configurationPrimitiveOf(owner) : undefined
  const isAuthProvider = primitive === 'auth' && owner !== undefined
    && !AST.isAuthLibraryDeclaration(owner, 'AuthProvider')
  const blocks: readonly [PairingBlock, readonly AST.Node[], boolean][] = [
    ['issues', slots.issues, isAuthProvider],
    ['accepts', slots.accepts, primitive === 'datasource'],
    ['supports', slots.supports, primitive === 'datasource'],
  ]
  for (const [block, nodes, allowed] of blocks) {
    if (!allowed) {
      for (const node of nodes) {
        ctx.error(node, pairingValidationMessages.misplacedBlock(block, owner?.name))
      }
      continue
    }
    for (const node of nodes.slice(1)) {
      ctx.error(node, pairingValidationMessages.duplicateBlock(block, owner!.name))
    }
  }
}

function ownerTypeDeclaration(slots: AST.ItemTypeExpression): AST.TypeDeclaration | undefined {
  const container = AST.isDerivedTypeExpression(slots.$container) ? slots.$container.$container : slots.$container
  return AST.isTypeDeclaration(container) ? container : undefined
}

function validateIssues(block: AST.ConfigurationIssues, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const proof of block.proofs) {
    if (!ASTUtils.isAuthProofKind(proof.kind)) {
      ctx.error(proof, pairingValidationMessages.unknownProofKind(proof.kind))
    } else if (seen.has(proof.kind)) {
      ctx.error(proof, pairingValidationMessages.duplicateProof(proof.kind))
    }
    seen.add(proof.kind)
  }
}

function validateAccepts(block: AST.ConfigurationAccepts, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const proof of block.proofs) {
    const written = proof.issuer ? `${proof.kind} from ${namedTypeText(proof.issuer)}` : proof.kind
    if (!ASTUtils.isAuthProofKind(proof.kind)) {
      ctx.error(proof, pairingValidationMessages.unknownProofKind(proof.kind))
    } else if (seen.has(written)) {
      ctx.error(proof, pairingValidationMessages.duplicateProof(written))
    }
    seen.add(written)
    if (!proof.issuer) {
      continue
    }
    const issuer = ASTUtils.pairingIssuerOf(proof)
    if (!issuer) {
      ctx.error(proof.issuer, pairingValidationMessages.issuerNotAuth(namedTypeText(proof.issuer)))
      continue
    }
    const issued = AST.configurationPairingOf(issuer, 'issues')
    if (
      issued && ASTUtils.isAuthProofKind(proof.kind) && !issued.proofs.some(candidate => candidate.kind === proof.kind)
    ) {
      ctx.error(proof, pairingValidationMessages.issuerDoesNotIssue(issuer.name, proof.kind))
    }
  }
}

function validateSupports(block: AST.ConfigurationSupports, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const entry of block.capabilities) {
    const capability = ASTUtils.dataCapabilityNamed(entry.capability)
    if (!capability) {
      ctx.error(entry, pairingValidationMessages.unknownCapability(entry.capability))
      continue
    }
    if (seen.has(capability.name)) {
      ctx.error(entry, pairingValidationMessages.duplicateCapability(capability.name))
    }
    seen.add(capability.name)
    if (capability.levels.length === 0 && entry.level !== undefined) {
      ctx.error(entry, pairingValidationMessages.capabilityLevelUnexpected(capability.name))
    } else if (capability.levels.length > 0 && entry.level === undefined) {
      ctx.error(entry, pairingValidationMessages.capabilityLevelMissing(capability.name, capability.levels))
    } else if (entry.level !== undefined && !capability.levels.includes(entry.level)) {
      ctx.error(
        entry,
        pairingValidationMessages.capabilityLevelUnknown(capability.name, entry.level, capability.levels),
      )
    }
  }
}

type PairingFinding = { readonly message: string; readonly node: AST.Node }

/**
 * validateAppPairing checks every app and variant in the file's project against the providers it
 * binds. The findings are computed once per project, because an app, the datasource it binds, and the
 * data that relies on a capability routinely live in different modules; each file reports the ones on
 * nodes it owns, so a mistake is reported where the use is written and where the app binds it.
 */
export function validateAppPairing(file: AST.TaoFile, ctx: ValidationContext): void {
  const scope = projectDataScope(file, ctx)
  const findings = ctx.memo(`pairing.findings.${scope.key}`, () => projectPairingFindings(scope))
  for (const finding of findings) {
    if (AST.findRoot(finding.node) === file) {
      ctx.error(finding.node, finding.message)
    }
  }
}

function projectPairingFindings(scope: ProjectDataScope): readonly PairingFinding[] {
  const findings: PairingFinding[] = []
  const reported = new Set<string>()
  const report = (node: AST.Node, message: string) => {
    const key = `${node.$cstNode?.offset ?? -1}:${AST.getDocument(node).uri.path}:${message}`
    if (!reported.has(key)) {
      reported.add(key)
      findings.push({ message, node })
    }
  }
  const access = scope.files.flatMap(file => file.statements.filter(AST.isAccessDeclaration))
  for (const app of scope.files.flatMap(AST.appValueDeclarationsInFile)) {
    const auth = ASTUtils.appAuthBinding(app)
    if (!auth) {
      for (const declaration of access) {
        const message = pairingValidationMessages.accessWithoutAuth(app.name, declaration.entity.$refText)
        report(declaration, message)
        report(app, message)
      }
    }
    for (const binding of ASTUtils.appBoundDatasources(app)) {
      const datasource = ASTUtils.datasourceTypeOfBinding(binding)
      if (!datasource) {
        continue
      }
      const bindingSite = nodeWithin(app, binding.node) ? binding.node : app
      if (auth?.declaration) {
        const message = unpairedMessage(app.name, datasource, auth.declaration)
        if (message) {
          report(nodeWithin(app, auth.node) ? auth.node : app, message)
          report(bindingSite, message)
        }
      }
      const supports = AST.configurationPairingOf(datasource, 'supports')
      if (!supports) {
        continue
      }
      const supported = new Set(supports.capabilities.map(entry => entry.capability))
      const held = heldData(scope, binding, access)
      for (const capability of ASTUtils.dataCapabilities) {
        if (!capability.detect || supported.has(capability.name)) {
          continue
        }
        for (const use of capability.detect(held)) {
          const message = pairingValidationMessages.unsupportedCapability(
            app.name,
            datasource.name,
            capability.name,
            use.description,
          )
          report(use.node, message)
          report(bindingSite, message)
        }
      }
    }
  }
  return findings
}

/**
 * A datasource pairs with an Auth when it accepts some proof kind the Auth issues, from that Auth
 * when the acceptance names one. The message says why the best candidate failed.
 */
function unpairedMessage(
  app: string,
  datasource: AST.TypeDeclaration,
  auth: AST.TypeDeclaration,
): string | undefined {
  const accepted = AST.configurationPairingOf(datasource, 'accepts')?.proofs ?? []
  const issued = new Set((AST.configurationPairingOf(auth, 'issues')?.proofs ?? []).map(proof => proof.kind))
  const kindMatches = accepted.filter(proof => issued.has(proof.kind))
  if (kindMatches.some(proof => !proof.issuer || ASTUtils.pairingIssuerOf(proof) === auth)) {
    return undefined
  }
  if (accepted.length === 0) {
    return pairingValidationMessages.noProofsAccepted(app, datasource.name, auth.name)
  }
  const mismatched = kindMatches[0]
  if (mismatched?.issuer) {
    return pairingValidationMessages.proofFromOtherAuth(
      app,
      datasource.name,
      auth.name,
      mismatched.kind,
      namedTypeText(mismatched.issuer),
    )
  }
  return pairingValidationMessages.noProofInCommon(
    app,
    datasource.name,
    auth.name,
    [...new Set(accepted.map(proof => proof.kind))],
  )
}

/**
 * A bound datasource holds its store: the collections its `Data` names, or, when it names none, the
 * collections no other datasource claims. `local only` collections live in the device store, which no
 * datasource provides.
 */
function heldData(
  scope: ProjectDataScope,
  binding: ASTUtils.AppDatasourceBinding,
  access: readonly AST.AccessDeclaration[],
): ASTUtils.DataCapabilityScope {
  const names = binding.declaration ? ASTUtils.datasourceCollectionNames(binding.declaration) : undefined
  const collections = names
    ? scope.collections.filter(collection => names.includes(collection.name) && !Type.dataEntityIsLocalOnly(collection))
    : scope.plan.defaultStore?.collections ?? []
  return {
    access: access.filter(declaration => declaration.entity.ref && collections.includes(declaration.entity.ref)),
    collections,
  }
}

function nodeWithin(container: AST.Node, node: AST.Node): boolean {
  for (let current: AST.Node | undefined = node; current; current = current.$container) {
    if (current === container) {
      return true
    }
  }
  return false
}

function namedTypeText(reference: AST.NamedTypeReference): string {
  return [reference.root, ...reference.members].join('.')
}

function orList(items: readonly string[]): string {
  return items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')}${items.length > 2 ? ',' : ''} or ${items.at(-1)}`
}

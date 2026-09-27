import { AST } from '@parser'
import { type AppDatasourceBinding, type AppPropertySource, effectiveAppConfiguration } from './app-configuration'
import { Type } from './Type'

/**
 * Pairing is what lets the compiler reject an app whose Auth and Datasource cannot work together.
 * An auth provider type `issues` sign-in proofs; a datasource type `accepts` proofs, optionally only
 * from one auth provider type, and `supports` the data capabilities it guarantees for every writer.
 * Proof kinds and capabilities are closed vocabularies owned here, so the validator, the formatter,
 * and the compiler read one table, and a new capability is one entry with its detector.
 */

/** authProofKinds mirrors the runtime's `TaoAuthProofKind`: the sign-in proofs a provider can issue. */
export const authProofKinds = ['IdentityToken', 'Session', 'TestIdentity'] as const

export type AuthProofKind = typeof authProofKinds[number]

/** isAuthProofKind recognizes one member of the closed proof vocabulary. */
export function isAuthProofKind(kind: string): kind is AuthProofKind {
  return (authProofKinds as readonly string[]).includes(kind)
}

/** DataCapabilityScope is the data one bound datasource holds: its collections and their access rules. */
export type DataCapabilityScope = {
  readonly access: readonly AST.AccessDeclaration[]
  readonly collections: readonly AST.EntityDataDeclaration[]
}

/** DataCapabilityUse is one place the app's data relies on a capability, described for a diagnostic. */
export type DataCapabilityUse = {
  /** description names the use as the author wrote it, such as "`unique A + B` on Note". */
  readonly description: string
  readonly node: AST.Node
}

/** DataCapability is one entry of the closed capability vocabulary. */
export type DataCapability = {
  /**
   * detect finds every use of the capability in the data a datasource holds. A capability without a
   * detector is declared for the runtime only: nothing in app source can show it is needed.
   */
  readonly detect?: (scope: DataCapabilityScope) => readonly DataCapabilityUse[]
  /** levels are the capability's closed levels; a capability with levels must name one. */
  readonly levels: readonly string[]
  readonly name: string
}

/**
 * dataCapabilities is the closed capability vocabulary, one entry per capability. Offline is not
 * here: it is a configuration property the Reference provider reads, not a fact about app source,
 * so a detector for it could only read back the datasource's own configuration.
 */
export const dataCapabilities: readonly DataCapability[] = [
  {
    // A stored relationship resolves inside the store's rows. An inverse collection is the same
    // relationship read from the other end, and a `reference` crosses stores by its unique value.
    name: 'Relations',
    levels: [],
    detect: scope =>
      scope.collections.flatMap(entity =>
        Type.dataFields(entity).flatMap(field =>
          !Type.dataFieldIsReference(field) && !Type.dataFieldIsInverseRelation(field)
            && Type.dataFieldRelationEntity(field)
            ? [{ description: `relation \`${field.name}\` on ${entity.singularName}`, node: field }]
            : []
        )
      ),
  },
  {
    name: 'UniqueFields',
    levels: [],
    detect: scope =>
      scope.collections.flatMap(entity => [
        ...Type.dataFields(entity).flatMap(field =>
          (field.traits?.traits ?? []).some(trait => trait.unique)
            ? [{ description: `\`${field.name} (unique)\` on ${entity.singularName}`, node: field }]
            : []
        ),
        ...entity.block.entries.filter(AST.isDataUnique).flatMap(unique =>
          unique.fieldNames.length === 1
            ? [{ description: `\`unique ${unique.fieldNames[0]}\` on ${entity.singularName}`, node: unique }]
            : []
        ),
      ]),
  },
  {
    name: 'UniqueTogether',
    levels: [],
    detect: scope =>
      scope.collections.flatMap(entity =>
        entity.block.entries.filter(AST.isDataUnique).flatMap(unique =>
          unique.fieldNames.length > 1
            ? [{
              description: `\`unique ${unique.fieldNames.join(' + ')}\` on ${entity.singularName}`,
              node: unique,
            }]
            : []
        )
      ),
  },
  {
    name: 'AccessRules',
    levels: [],
    detect: scope =>
      scope.access.map(declaration => ({
        description: `\`access ${declaration.entity.$refText}\``,
        node: declaration,
      })),
  },
  {
    // Update grants always name the fields they permit, so any update grant is a field-level rule.
    name: 'FieldUpdates',
    levels: [],
    detect: scope =>
      scope.access.flatMap(declaration =>
        declaration.rules.flatMap(rule =>
          rule.grants.flatMap(grant =>
            grant.operation === 'update'
              ? [{
                description: `\`update ${grant.fields.join(', ')}\` in access ${declaration.entity.$refText}`,
                node: grant,
              }]
              : []
          )
        )
      ),
  },
  {
    // A membership rule reaches its Account through more than one hop, or through a collection.
    name: 'MembershipRules',
    levels: [],
    detect: scope =>
      scope.access.flatMap(declaration =>
        declaration.rules.flatMap(rule =>
          accessRuleIsMembership(declaration, rule)
            ? [{
              description: `\`${rule.actorPath.join('.')}\` in access ${declaration.entity.$refText}`,
              node: rule,
            }]
            : []
        )
      ),
  },
  {
    // Which schema changes a store can apply to data it already holds is a deployment fact; no
    // single compile can see the previous schema, so this capability has no detector.
    name: 'Migrations',
    levels: ['Additive', 'Renames', 'Destructive'],
  },
]

/** dataCapabilityNamed returns one vocabulary entry. */
export function dataCapabilityNamed(name: string): DataCapability | undefined {
  return dataCapabilities.find(capability => capability.name === name)
}

function accessRuleIsMembership(declaration: AST.AccessDeclaration, rule: AST.AccessRule): boolean {
  const entity = declaration.entity.ref
  if (!entity) {
    return false
  }
  const path = rule.actorPath[0] === entity.singularName ? rule.actorPath.slice(1) : rule.actorPath
  if (path.length > 1) {
    return true
  }
  const field = path[0] === undefined ? undefined : Type.dataFields(entity).find(field => field.name === path[0])
  return field !== undefined && Type.dataFieldIsInverseRelation(field)
}

/**
 * concreteConfigurableDeclaration follows a transparent `type X = pkg.Member` alias to the declaration
 * that owns the runtime identity, which is the name pairing compares and the runtime stamps.
 */
export function concreteConfigurableDeclaration(
  declaration: AST.TypeDeclaration,
  seen: Set<AST.TypeDeclaration> = new Set(),
): AST.TypeDeclaration | undefined {
  if (seen.has(declaration)) {
    return undefined
  }
  seen.add(declaration)
  const target = declaration.aliasTarget?.member.ref
  if (declaration.aliasTarget) {
    return AST.isTypeDeclaration(target) ? concreteConfigurableDeclaration(target, seen) : undefined
  }
  return declaration
}

/**
 * pairingIssuerOf resolves the auth provider type a `from` names, or returns undefined when it names
 * nothing, or names something other than a concrete auth provider type.
 */
export function pairingIssuerOf(proof: AST.ConfigurationAcceptedProof): AST.TypeDeclaration | undefined {
  if (!proof.issuer) {
    return undefined
  }
  const definition = Type.definitionOfReference(proof.issuer)
  const declaration = AST.isTypeDeclaration(definition) ? concreteConfigurableDeclaration(definition) : undefined
  return declaration
      && AST.configurationPrimitiveOf(declaration) === 'auth'
      && !AST.isAuthLibraryDeclaration(declaration, 'AuthProvider')
    ? declaration
    : undefined
}

/** AppAuthBinding is the auth provider type an app resolves to, with the node that supplies it. */
export type AppAuthBinding = {
  /** declaration is the concrete auth provider type, absent when the value names none. */
  readonly declaration: AST.TypeDeclaration | undefined
  readonly node: AST.Node
}

/**
 * appAuthBinding resolves an app's effective Auth slot, following variants. `Auth none` and an absent
 * slot both mean the app has no Auth.
 */
export function appAuthBinding(app: AST.AppValueDeclaration): AppAuthBinding | undefined {
  const value = effectiveAppConfiguration(app).get('Auth')?.value
  if (!value || (AST.isExpression(value) && AST.isNoneLiteral(value))) {
    return undefined
  }
  return { declaration: configurableTypeOfValue(value, new Set()), node: value }
}

/** datasourceTypeOfBinding resolves the concrete datasource type one app binding mounts. */
export function datasourceTypeOfBinding(binding: AppDatasourceBinding): AST.TypeDeclaration | undefined {
  if (binding.declaration) {
    return configurableTypeOfDeclaration(binding.declaration, new Set())
  }
  return binding.value ? configurableTypeOfValue(binding.value, new Set()) : undefined
}

function configurableTypeOfValue(
  value: AppPropertySource | AST.ConfigurationValue,
  seen: Set<AST.Node>,
): AST.TypeDeclaration | undefined {
  if (AST.isAppView(value)) {
    return undefined
  }
  if (AST.isConfigurationReference(value)) {
    return configurableTypeOfDeclaration(value.target.ref, seen)
  }
  if (!AST.isExpression(value)) {
    return undefined
  }
  if (AST.isConfigurationConstructor(value)) {
    return value.members.length === 0 ? configurableTypeOfDeclaration(value.type.ref, seen) : undefined
  }
  if (AST.isValueReference(value) || AST.isRefinementExpression(value)) {
    return configurableTypeOfDeclaration(value.target.ref, seen)
  }
  if (AST.isInferredConfigurationConstructor(value) && AST.isAliasDeclaration(value.$container)) {
    return configurableTypeOfDeclaration(Type.visibleDeclaration(value.$container, value.$container.name), seen)
  }
  return undefined
}

function configurableTypeOfDeclaration(
  declaration: AST.Node | undefined,
  seen: Set<AST.Node>,
): AST.TypeDeclaration | undefined {
  if (!declaration || seen.has(declaration)) {
    return undefined
  }
  seen.add(declaration)
  if (AST.isTypeDeclaration(declaration)) {
    return AST.isConfigurableDeclaration(declaration) ? concreteConfigurableDeclaration(declaration) : undefined
  }
  if (AST.isDatasourceDeclaration(declaration) || AST.isAliasDeclaration(declaration)) {
    return declaration.value ? configurableTypeOfValue(declaration.value, seen) : undefined
  }
  return undefined
}

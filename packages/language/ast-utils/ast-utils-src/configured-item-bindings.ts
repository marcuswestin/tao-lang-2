import { AST } from '@parser'
import { capabilityRequirements, ownAssociatedMethods, ownAssociatedViews } from './associated-methods'
import { type ItemShapeField, type TaoType, Type } from './Type'
import { type BindingDiagnostic, resolveBindings } from './type-binding-matches'

export type ConfiguredItemOperand = Readonly<{
  field: ItemShapeField
  node: AST.Expression | AST.ConfigurationEntry
  origin: 'supplied' | 'default' | 'filled'
}>

export type ConfiguredItemConstruction = Readonly<{
  kind: 'complete' | 'unresolved' | 'invalid'
  site: AST.ConfigurationConstructor | AST.ConfigurationEntry
  result: TaoType
  fields: readonly ItemShapeField[]
  pairs: readonly Readonly<
    { entry: AST.ConfigurationEntry; field: ItemShapeField; actual: TaoType; expected: TaoType }
  >[]
  operands: readonly ConfiguredItemOperand[]
  diagnostics: readonly (
    | BindingDiagnostic<AST.ConfigurationEntry, ItemShapeField>
    | Readonly<{ kind: 'unsupported' | 'unresolved'; entry?: AST.ConfigurationEntry }>
  )[]
}>

type ConstructionResolution = Pick<
  ReturnType<typeof Type.correspondenceResolver>,
  'ofExpression' | 'ofDefinition' | 'ofTypeExpression' | 'compare'
>

/** Retain actual configured field correspondence before effect-dependent capability admission. */
export function resolveConfiguredItemConstruction(
  site: AST.ConfigurationConstructor | AST.ConfigurationEntry,
  resolution: ConstructionResolution = constructionResolution(site),
  expected?: TaoType,
): ConfiguredItemConstruction {
  const result = expected ?? (AST.isConfigurationConstructor(site)
    ? resolution.ofExpression(site)
    : site.name && Type.visibleDeclaration(site, site.name)
    ? resolution.ofDefinition(Type.visibleDeclaration(site, site.name)!)
    : { kind: 'unresolved' } as const)
  const block = site.block
  const fields = result.kind === 'item' && result.item ? Type.itemFields(result.item) : []
  const diagnostics: Array<ConfiguredItemConstruction['diagnostics'][number]> = []
  if (
    !block || result.kind !== 'item' || !result.item || result.item.projectedEntity
    || Type.isAbstractDomain(result) || ('members' in site && site.members.length > 0)
    || ('nameMembers' in site && (site.nameMembers?.length ?? 0) > 0)
    || fields.some(field => !AST.isTypeProperty(field))
  ) {
    return seal({
      kind: 'unresolved',
      site,
      result,
      fields,
      pairs: [],
      operands: [],
      diagnostics: [{ kind: 'unsupported' }],
    })
  }
  const candidateTypes = new Map<AST.ConfigurationEntry, TaoType>()
  const payloadTypes = new Map<AST.ConfigurationEntry, TaoType>()
  const fieldType = (field: ItemShapeField): TaoType => {
    if (!AST.isTypeProperty(field)) {
      return Type.itemFieldType(field)
    }
    if (field.type) {
      return resolution.ofTypeExpression(field.type)
    }
    if (field.value) {
      return resolution.ofExpression(field.value)
    }
    const shorthandType = Type.shorthandPropertyDefinition(field)
    return shorthandType ? resolution.ofDefinition(shorthandType) : Type.itemFieldType(field)
  }
  for (const entry of block.entries) {
    let actual: TaoType | undefined
    if (entry.label && entry.expression) {
      actual = resolution.ofExpression(entry.expression)
    } else if (entry.expression) {
      actual = resolution.ofExpression(entry.expression)
    } else if (entry.reference) {
      actual = AST.isValueDeclaration(entry.reference.ref)
        ? Type.ofValueDeclaration(entry.reference.ref)
        : { kind: 'unresolved' }
    } else if (entry.memberReference) {
      actual = resolution.ofExpression(entry.memberReference)
    } else if (entry.name && !(entry.nameMembers?.length)) {
      const field = fields.find(field => field.name === entry.name)
      const declaration = Type.visibleDeclaration(entry, entry.name)
      const named = field ? fieldType(field) : declaration && AST.isTypeDefinition(declaration)
        ? resolution.ofDefinition(declaration)
        : undefined
      if (named && Type.quantityOwner(named)) {
        diagnostics.push({ kind: 'unsupported', entry })
        actual = named
      } else if (named && entry.block) {
        const nested = resolveConfiguredItemConstruction(entry, resolution, named)
        actual = named
        if (nested.kind !== 'complete') {
          diagnostics.push({ kind: nested.kind === 'invalid' ? 'unsupported' : 'unresolved', entry })
        }
      } else if (named && entry.value && AST.isExpression(entry.value)) {
        const value = resolution.ofExpression(entry.value)
        payloadTypes.set(entry, value)
        const comparison = resolution.compare(value, named)
        if (comparison !== 'compatible') {
          diagnostics.push({ kind: comparison === 'pending' ? 'unresolved' : 'unsupported', entry })
        }
        actual = field ? value : named
      }
    }
    if (!actual) {
      diagnostics.push({ kind: 'unsupported', entry })
    } else if (actual.kind === 'unresolved') {
      diagnostics.push({ kind: 'unresolved', entry })
    }
    candidateTypes.set(entry, actual ?? { kind: 'unresolved' })
  }
  const comparisons = new Map<
    AST.ConfigurationEntry,
    Map<ItemShapeField, ReturnType<ConstructionResolution['compare']>>
  >()
  for (const entry of block.entries) {
    const row = new Map<ItemShapeField, ReturnType<ConstructionResolution['compare']>>()
    for (const field of fields) {
      const comparison = resolution.compare(candidateTypes.get(entry)!, fieldType(field))
      row.set(field, comparison)
      if (comparison === 'pending') {
        diagnostics.push({ kind: 'unresolved', entry })
      }
    }
    comparisons.set(entry, row)
  }
  const binding = resolveBindings<AST.ConfigurationEntry, ItemShapeField>({
    candidates: block.entries,
    targets: fields.filter(field => !Type.itemFieldIsFilled(field)),
    targetOrder: fields,
    candidateLabel: entry => entry.label,
    targetName: field => field.name,
    candidateType: entry => candidateTypes.get(entry)!,
    targetType: fieldType,
    namedTypeAccepts: (actual, expected) => resolution.compare(actual, expected) === 'compatible',
    compatibleTypeAccepts: (actual, expected) => resolution.compare(actual, expected) === 'compatible',
    pairAccepts: (entry, field) => comparisons.get(entry)?.get(field) === 'compatible',
    targetRequiresValue: Type.itemFieldRequiresValue,
    duplicateTargetTypesOnlyWithCandidates: true,
    unresolvedCandidatesExcuseMissing: false,
  })
  diagnostics.push(...binding.diagnostics)
  const pairs = binding.pairs.map(([entry, field]) => ({
    entry,
    field,
    actual: payloadTypes.get(entry) ?? candidateTypes.get(entry)!,
    expected: fieldType(field),
  }))
  const operands: ConfiguredItemOperand[] = []
  for (const field of fields) {
    const pair = pairs.find(pair => pair.field === field)
    if (pair) {
      operands.push({ field, node: pair.entry, origin: 'supplied' })
    } else if (AST.isTypeProperty(field) && field.value) {
      operands.push({ field, node: field.value, origin: Type.itemFieldIsFilled(field) ? 'filled' : 'default' })
    }
  }
  return seal({
    kind: diagnostics.some(diagnostic => diagnostic.kind === 'unresolved')
      ? 'unresolved'
      : diagnostics.length > 0
      ? 'invalid'
      : 'complete',
    site,
    result,
    fields,
    pairs,
    operands,
    diagnostics,
  })
}

function seal(plan: ConfiguredItemConstruction): ConfiguredItemConstruction {
  return Object.freeze({
    ...plan,
    fields: Object.freeze([...plan.fields]),
    pairs: Object.freeze(plan.pairs.map(pair => Object.freeze(pair))),
    operands: Object.freeze(plan.operands.map(operand => Object.freeze(operand))),
    diagnostics: Object.freeze(plan.diagnostics.map(diagnostic => Object.freeze(diagnostic))),
  })
}

function constructionResolution(site: AST.Node): ConstructionResolution {
  const owners = [
    ...AST.visibleFileDeclarations(site, AST.isTypeDeclaration, declaration => declaration.name),
    // Resolved imports retain both the authored singular and collection names of a real entity.
    ...AST.visibleFileDeclarations(site, AST.isEntityDataDeclaration),
  ]
  const descriptors = new Map(
    owners.flatMap(owner =>
      [
        ...ownAssociatedMethods(owner),
        ...ownAssociatedViews(owner),
        ...(AST.isTypeDeclaration(owner) ? capabilityRequirements(owner) : []),
      ]
        .map(declaration => [declaration, Type.associatedCallable(declaration, owner)] as const)
    ),
  )
  return Type.correspondenceResolver(descriptors)
}

import { AST } from '@parser'
import { Switch } from '@shared'
import type { CallableSignature } from './callable-signatures'
import type { TaoType } from './Type'
import { Type } from './Type'

/** Conversion contracts retain the real body, source receiver and implicit target result. */
export type AssociatedConverterDescriptor = Readonly<{
  declaration: AST.AssociatedConverterDeclaration
  owner: AST.TypeDeclaration
  receiver: TaoType
  result: TaoType
  signature: CallableSignature
}>

export type ConverterResolution = Readonly<{
  source: TaoType
  target: TaoType
  descriptor?: AssociatedConverterDescriptor
  candidates: readonly AssociatedConverterDescriptor[]
  problem?: 'unresolved-contract' | 'missing-converter' | 'ambiguous-converter'
}>

type ConverterTypeResolution = Readonly<{
  ofExpression(expression: AST.Expression): TaoType
  ofTypeExpression(expression: AST.TypeExpression): TaoType
}>

/** Enumerate the converters attached to one concrete owner. */
export function ownAssociatedConverters(owner: AST.TypeDeclaration): readonly AST.AssociatedConverterDeclaration[] {
  const type = owner.type
  const body = AST.isDerivedTypeExpression(type) ? type.slots : AST.isItemTypeExpression(type) ? type : undefined
  return [...(body?.converters ?? []), ...(owner.associated?.converters ?? [])]
}

export function associatedConverterDescriptor(
  declaration: AST.AssociatedConverterDeclaration,
  resolution: ConverterTypeResolution = Type,
): AssociatedConverterDescriptor | undefined {
  const owner = AST.associatedConverterOwner(declaration)
  if (!AST.isTypeDeclaration(owner)) {
    return undefined
  }
  const receiver = resolution.ofTypeExpression(declaration.conversionSource)
  const result = resolution.ofTypeExpression(declaration.conversionTarget)
  const bounds = declaration.failureBounds
  return Object.freeze({
    declaration,
    owner,
    receiver,
    result,
    signature: Object.freeze({
      inputs: Object.freeze([]),
      failures: Object.freeze({
        cases: Object.freeze(bounds.filter(bound => bound !== 'never')),
        open: bounds.length === 0,
      }),
    }),
  })
}

/** Resolve one authored conversion, without operand fabrication or converter graph search. */
export function resolveAssociatedConversion(
  expression: AST.ConversionExpression,
  resolution: ConverterTypeResolution = Type,
): ConverterResolution {
  const source = resolution.ofExpression(expression.value)
  const target = resolution.ofTypeExpression(expression.target)
  if (source.kind === 'unresolved' || target.kind === 'unresolved') {
    return { source, target, candidates: [], problem: 'unresolved-contract' }
  }
  const ancestors = sourceDomains(source, resolution)
  const applicable: { descriptor: AssociatedConverterDescriptor; distance: number }[] = []
  const owners = new Set(
    AST.visibleFileDeclarations(expression, AST.isTypeDeclaration, declaration => declaration.name),
  )
  // A public field or signature can expose a nominal value without importing its owner's name.
  // Its attached converters are still members of that concrete type, not unrelated global candidates.
  for (const domain of [...ancestors, target]) {
    if ('nominal' in domain && AST.isTypeDeclaration(domain.nominal)) {
      owners.add(domain.nominal)
    }
  }
  for (const owner of owners) {
    for (const declaration of ownAssociatedConverters(owner)) {
      const descriptor = associatedConverterDescriptor(declaration, resolution)!
      if (descriptor.receiver.kind === 'unresolved' || descriptor.result.kind === 'unresolved') {
        continue
      }
      if (!sameDomain(descriptor.result, target)) {
        continue
      }
      const distance = ancestors.findIndex(ancestor => sameDomain(ancestor, descriptor.receiver))
      if (distance >= 0) {
        applicable.push({ descriptor, distance })
      }
    }
  }
  const nearest = Math.min(...applicable.map(candidate => candidate.distance))
  const candidates = applicable.filter(candidate => candidate.distance === nearest).map(candidate =>
    candidate.descriptor
  )
  return candidates.length === 1
    ? { source, target, candidates, descriptor: candidates[0] }
    : { source, target, candidates, problem: candidates.length === 0 ? 'missing-converter' : 'ambiguous-converter' }
}

/** Matching uses declared nominal ancestry; shared storage and structural shape do not add edges. */
function sourceDomains(source: TaoType, resolution: ConverterTypeResolution): TaoType[] {
  const domains: TaoType[] = []
  const seen = new Set<AST.TypeDefinition>()
  let current: TaoType | undefined = source
  while (current) {
    domains.push(current)
    const nominal: AST.TypeDefinition | undefined = 'nominal' in current ? current.nominal : undefined
    if (!nominal || !AST.isTypeDeclaration(nominal) || seen.has(nominal)) {
      break
    }
    seen.add(nominal)
    const expression: AST.TypeDefinition['type'] = nominal.type
    const base: AST.TypeReference | undefined = AST.isDerivedTypeExpression(expression)
      ? expression.base
      : AST.isNamedTypeReference(expression)
          || AST.isPrimitiveTypeReference(expression)
      ? expression
      : undefined
    current = base ? resolution.ofTypeExpression(base) : undefined
  }
  return domains
}

function sameDomain(left: TaoType, right: TaoType): boolean {
  if (left.kind !== right.kind) {
    return false
  }
  if ('nominal' in left || 'nominal' in right) {
    const leftNominal = 'nominal' in left ? left.nominal : undefined
    const rightNominal = 'nominal' in right ? right.nominal : undefined
    if (leftNominal || rightNominal) {
      return leftNominal !== undefined && leftNominal === rightNominal
    }
  }
  return Switch.on(left, 'kind', {
    primitive: left => right.kind === 'primitive' && left.primitive === right.primitive,
    entity: left => right.kind === 'entity' && left.entity === right.entity,
    capability: left => right.kind === 'capability' && left.declaration === right.declaration,
    enum: left => right.kind === 'enum' && left.declaration === right.declaration,
    list: () => left === right,
    item: () => left === right,
    union: () => left === right,
    unresolved: () => left === right,
  })
}

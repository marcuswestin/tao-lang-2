import { AST } from '@parser'
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

/** Only converters attached to an actually visible owner participate in selection. */
export function ownAssociatedConverters(owner: AST.TypeDeclaration): readonly AST.AssociatedConverterDeclaration[] {
  const type = owner.type
  const body = AST.isDerivedTypeExpression(type) ? type.slots : AST.isItemTypeExpression(type) ? type : undefined
  return body?.converters ?? []
}

export function associatedConverterDescriptor(
  declaration: AST.AssociatedConverterDeclaration,
  resolution: ConverterTypeResolution = Type,
): AssociatedConverterDescriptor | undefined {
  const owner = AST.associatedConverterOwner(declaration)
  if (!owner) {
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
  for (const owner of AST.visibleFileDeclarations(expression, AST.isTypeDeclaration, declaration => declaration.name)) {
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
    const nominal = 'nominal' in current ? current.nominal : undefined
    if (!nominal || !AST.isTypeDeclaration(nominal) || seen.has(nominal)) {
      break
    }
    seen.add(nominal)
    const expression = nominal.type
    const base = AST.isDerivedTypeExpression(expression) ? expression.base : AST.isNamedTypeReference(expression)
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
  if (left.kind === 'primitive' && right.kind === 'primitive') {
    return left.primitive === right.primitive
  }
  if (left.kind === 'entity' && right.kind === 'entity') {
    return left.entity === right.entity
  }
  if (left.kind === 'capability' && right.kind === 'capability' || left.kind === 'enum' && right.kind === 'enum') {
    return left.declaration === right.declaration
  }
  return left === right
}

export type TaoDeclarationIdentityTuple = readonly [
  'tao.declaration',
  1,
  projectId: string,
  packageId: string,
  modulePath: string,
  declarationKind: string,
  declarationName: string,
]

export type TaoDeclarationIdentity = Readonly<{
  canonical: string
  hash: number
  tuple: TaoDeclarationIdentityTuple
}>

export type TaoCanonicalDescriptor = Readonly<{
  canonical: string
  declaration: TaoDeclarationIdentity
  hash: number
  value: CanonicalValue
}>

type CanonicalValue = ReadonlyArray<unknown>

type CanonicalizableDeclaration = {
  canonicalIdentity?: TaoDeclarationIdentity
}

/** declarationIdentity validates and freezes the persisted, owner-relative declaration tuple. */
export function declarationIdentity(tuple: TaoDeclarationIdentityTuple): TaoDeclarationIdentity {
  if (
    tuple.length !== 7
    || tuple[0] !== 'tao.declaration'
    || tuple[1] !== 1
    || tuple.slice(2).some(part => typeof part !== 'string' || part.length === 0)
  ) {
    throw new Error('Invalid Tao declaration identity tuple.')
  }
  const frozenTuple = Object.freeze([...tuple]) as unknown as TaoDeclarationIdentityTuple
  const canonical = JSON.stringify(frozenTuple)
  return Object.freeze({ canonical, hash: fnv1a(canonical), tuple: frozenTuple })
}

/** canonicalDescriptor materializes a configured value into stable structural identity. */
export function canonicalDescriptor(
  declaration: TaoDeclarationIdentity,
  configuration: Readonly<Record<string, unknown>>,
): TaoCanonicalDescriptor {
  const value = canonicalValue(configuration, new Set())
  const canonical = JSON.stringify(['tao.descriptor', 1, declaration.canonical, value])
  return Object.freeze({ canonical, declaration, hash: fnv1a(canonical), value })
}

/** fnv1a is an index-only 32-bit hash; callers must always confirm structural equality. */
export function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  const bytes = new TextEncoder().encode(value)
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

function canonicalValue(value: unknown, seen: Set<object>): CanonicalValue {
  if (value === null || value === undefined) {
    return Object.freeze(['none'])
  }
  if (typeof value === 'string') {
    return Object.freeze(['text', value])
  }
  if (typeof value === 'boolean') {
    return Object.freeze(['boolean', value])
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('A restorable descriptor cannot contain a non-finite number.')
    }
    return Object.freeze(['number', Object.is(value, -0) ? '0' : String(value)])
  }
  if (typeof value !== 'object') {
    throw new Error(`A restorable descriptor cannot contain ${typeof value}.`)
  }
  if (seen.has(value)) {
    throw new Error('A restorable descriptor cannot contain a cycle.')
  }

  const evaluable = value as { evaluate?: () => { jsValue: unknown } }
  if (typeof evaluable.evaluate === 'function') {
    const evaluated = evaluable.evaluate()
    if (evaluated !== value) {
      return canonicalValue(evaluated.jsValue, seen)
    }
    if ('jsValue' in evaluated) {
      return canonicalValue(evaluated.jsValue, seen)
    }
  }

  const presentable = value as { definition?: { identity?: TaoDeclarationIdentity } }
  const canonicalIdentity = presentable.definition?.identity
    ?? (value as CanonicalizableDeclaration).canonicalIdentity
    ?? (value as { declaration?: CanonicalizableDeclaration }).declaration?.canonicalIdentity
  if (canonicalIdentity) {
    return Object.freeze(['declaration', canonicalIdentity.canonical])
  }

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return Object.freeze(['list', ...value.map(item => canonicalValue(item, seen))])
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error('A restorable descriptor cannot contain an opaque host object.')
    }
    const fields = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => Object.freeze([name, canonicalValue(item, seen)] as const))
    return Object.freeze(['item', ...fields])
  } finally {
    seen.delete(value)
  }
}

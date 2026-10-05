import { Assert } from '@shared'
import type { nativeOriginEmitter } from './emit-origin'
import { nativeMember, nativePath } from './emit-targets'
import type { NativeApiCatalog, NativeApiReference } from './native-api'

export function referencePredicate(reference: NativeApiReference, value: string): string {
  const checks = [`${value} !== null`, `(typeof ${value} === 'object' || typeof ${value} === 'function')`]
  if (reference.runtimeConstructor) {
    const constructor = nativePath(reference.runtimeConstructor.path, reference.runtimeConstructor.global)
    checks.push(
      reference.runtimeConstructor.inheritedPrototype
        ? `(${value} instanceof ${constructor} || acceptsImmediateNativeBase(${value}, ${constructor}))`
        : `${value} instanceof ${constructor}`,
    )
  }
  for (const member of reference.methods) {
    checks.push(`hasNativeMethod(${value}, ${nativeMember(member)})`)
  }
  return checks.join(' && ')
}

/** Definitions remain private, sharing identity only inside this generated module. */
export function emitReferences(
  catalog: NativeApiCatalog,
  implementationImport = './Bindings.ts',
  origins?: ReturnType<typeof nativeOriginEmitter>,
  associatedActions: ReadonlyMap<string, readonly string[]> = new Map(),
): { tao: string[]; sidecar: string[] } {
  const references = catalog.references ?? []
  const tao: string[] = []
  const sidecar: string[] = references.length ? ['const nativeReferences = TR.NativeReferenceGroup()', ''] : []
  if (references.some(reference => reference.runtimeConstructor?.inheritedPrototype)) {
    sidecar.push(
      'function acceptsImmediateNativeBase(value: object, constructor: { prototype: object }): boolean {',
      '  const prototype: object | null = Object.getPrototypeOf(constructor.prototype)',
      '  if (prototype === null) return false',
      '  const base = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value',
      '  return typeof base === "function" && base !== Object && base !== Function',
      '    && base.prototype === prototype && value instanceof base',
      '}',
      '',
    )
  }
  if (references.some(reference => reference.methods.length > 0)) {
    sidecar.push(
      'function hasNativeMethod(value: object, member: string | symbol): boolean {',
      '  let prototype: object | null = value',
      '  while (prototype !== null) {',
      '    const descriptor = Object.getOwnPropertyDescriptor(prototype, member)',
      '    if (descriptor) return Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function"',
      '    prototype = Object.getPrototypeOf(prototype)',
      '  }',
      '  return false',
      '}',
      '',
    )
  }
  const emitted = new Set<string>()
  const visiting = new Set<string>()
  function define(reference: NativeApiReference): void {
    if (emitted.has(reference.name)) {
      return
    }
    Assert.input(!visiting.has(reference.name), `Native reference ancestry contains a cycle at '${reference.name}'.`)
    visiting.add(reference.name)
    const origin =
      `// Source: ${reference.provenance.packageName}/${reference.provenance.declaration}:${reference.provenance.line}:${reference.provenance.column}`
    const physical = origins?.comments(reference.provenance) ?? { tao: [], sidecar: [] }
    const parents = [...new Set([...(reference.base ? [reference.base] : []), ...(reference.protocols ?? [])])]
    for (const parent of parents) {
      const definition = references.find(candidate => candidate.name === parent)
      Assert.defined(definition, `native parent '${parent}' is declared`)
      define(definition)
    }
    const actions = associatedActions.get(reference.name) ?? []
    tao.push(
      origin,
      ...physical.tao,
      `public type ${reference.name} is ${reference.base ?? 'item'}${
        actions.length > 0 ? ` with { ${actions.join('\n   ')}\n}` : ''
      }`,
      '',
    )
    sidecar.push(
      origin,
      ...physical.sidecar,
      `type Native${reference.name} = ${reference.typescript}`,
      `const ${reference.name}Reference = nativeReferences.define(${JSON.stringify(reference.name)},`,
      `  (value: unknown): value is Native${reference.name} => ${referencePredicate(reference, 'value')},`,
      `  [${parents.map(parent => `${parent}Reference`).join(', ')}])`,
      '',
    )
    tao.push(
      ...physical.tao,
      `public action Release${reference.name}(Value ${reference.name}) from ${implementationImport}`,
      '',
    )
    sidecar.push(
      ...physical.sidecar,
      `export function Release${reference.name}(value: unknown): void { ${
        catalog.operations.some(operation =>
            operation.callbackOwnership?.some(owner =>
              owner.lifetime.kind === 'resource' || owner.lifetime.kind === 'receiver'
            ) || operation.callbackEffect
          )
          ? `if (${reference.name}Reference.is(value)) TR.NativeReceiverCallbacks.cancel(${reference.name}Reference.unwrap(value)); `
          : ''
      }${reference.name}Reference.release(value) }`,
      '',
    )
    for (const protocol of reference.protocols ?? []) {
      tao.push(
        ...physical.tao,
        `public action ${reference.name}As${protocol}(Value ${reference.name}) returns ${protocol} from ${implementationImport}`,
        '',
      )
      sidecar.push(
        ...physical.sidecar,
        `export function ${reference.name}As${protocol}(value: unknown): TR.NativeReference<Native${protocol}> {`,
        `  ${reference.name}Reference.unwrap(value)`,
        `  ${protocol}Reference.unwrap(value)`,
        `  return value as TR.NativeReference<Native${protocol}>`,
        '}',
        '',
      )
    }
    visiting.delete(reference.name)
    emitted.add(reference.name)
  }
  references.forEach(define)
  return { tao, sidecar }
}

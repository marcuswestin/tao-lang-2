import type { nativeValueEmitter } from './emit-values'
import type { NativeApiCatalog } from './native-api'

/** Opaque Tao families name checked descriptor types; structural records remain independently checked. */
export function emitNativeBridgeTypes(catalog: NativeApiCatalog, values: ReturnType<typeof nativeValueEmitter>) {
  const types = new Map<string, string>()
  for (const reference of catalog.references ?? []) {
    types.set(reference.name, `TR.NativeReference<Native${reference.name}>`)
  }
  if (values.needsDynamic()) {
    types.set('NativeValue', 'TR.NativeReference<unknown>')
  }
  for (const listener of catalog.listeners ?? []) {
    types.set(listener.name, `ReturnType<typeof ${listener.name}Listener.create>`)
  }
  for (const operation of catalog.operations) {
    if (operation.pending) {
      types.set(operation.pending.name, `ReturnType<typeof ${operation.pending.name}Pending.start>`)
    }
  }
  const names = [...types.keys()].sort()
  return {
    names,
    sidecar: names.length
      ? [
        'export type NativeTypes = {',
        ...names.map(name => `  ${JSON.stringify(name)}: ${types.get(name)}`),
        '}',
        '',
      ]
      : [],
  }
}

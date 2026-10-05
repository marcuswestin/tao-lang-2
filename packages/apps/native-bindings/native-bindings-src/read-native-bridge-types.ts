import { Assert, FS, Json, Platform, TaoStdlib } from '@shared'
import { inspectMaintainedNativeBindings, type MaintainedBindingOptions } from './maintained-native-bindings'
import { maintainedNativeSources } from './maintained-native-sources'

export type NativeBridgeTypeOrigin = {
  sourcePath: string
  name: string
  implementationPath: string
  exportName: 'NativeTypes'
  memberName: string
}

export type NativeBridgeTypeOriginOptions = MaintainedBindingOptions & {
  /** Reuse the caller's checked inspection; the caller still owns final publication reinspection. */
  inspection?: Awaited<ReturnType<typeof inspectMaintainedNativeBindings>>
}

/** Read descriptive type origins only from verified maintained outputs, without loading native code. */
export async function readMaintainedNativeBridgeTypeOrigins(
  options: NativeBridgeTypeOriginOptions = {},
): Promise<NativeBridgeTypeOrigin[]> {
  const inspection = options.inspection ?? await inspectMaintainedNativeBindings(options)
  Assert.input(
    inspection.status === 'fresh',
    'Maintained native bridge types are stale. Regenerate with tao bindings generate --maintained.',
  )
  const root = FS.resolvePath(
    options.stdlibRoot ?? TaoStdlib.declaredRoot() ?? FS.resolvePath('../../stdlib', import.meta.dir),
  )
  const verified = new Set(inspection.outputPaths.map(path => FS.resolvePath(path)))
  const origins: NativeBridgeTypeOrigin[] = []
  for (const source of maintainedNativeSources) {
    const sourcePath = FS.resolvePath(`@tao/device/${source.capability}/Bindings.tao`, root)
    const directory = FS.resolvePath(`.tao-ts/native-bindings/${source.capability}`, root)
    const implementationPath = FS.resolvePath('Bindings.ts', directory)
    const path = FS.resolvePath('bindings.json', directory)
    const manifestPath = FS.resolvePath('maintained.json', directory)
    Assert.input(
      [sourcePath, implementationPath, path, manifestPath].every(path => verified.has(path)),
      `Maintained native bridge metadata is not verified at '${path}'.`,
    )
    const contents = await FS.readText(path)
    const manifest = Json.tryParse(await FS.readText(manifestPath))
    Assert.input(
      Json.isRecord(manifest) && Array.isArray(manifest['outputs']),
      `Invalid maintained native manifest at '${manifestPath}'.`,
    )
    const entry = manifest['outputs'].find(entry =>
      Json.isRecord(entry) && entry['path'] === 'typescript/bindings.json'
    )
    Assert.input(
      Json.isRecord(entry) && entry['hash'] === Platform.sha256Hex(contents),
      `Maintained native bridge metadata changed after inspection at '${path}'.`,
    )
    const metadata = Json.tryParse(contents)
    Assert.input(
      Json.isRecord(metadata) && metadata['schemaVersion'] === 1 && Array.isArray(metadata['bridgeTypes']),
      `Missing native bridge type metadata at '${path}'.`,
    )
    const names = metadata['bridgeTypes']
    Assert.input(
      names.every(name => typeof name === 'string' && /^[A-Z][A-Za-z0-9_]*$/.test(name))
        && new Set(names).size === names.length,
      `Invalid native bridge type names at '${path}'.`,
    )
    for (const name of names) {
      Assert.input(typeof name === 'string', `Invalid native bridge type name at '${path}'.`)
      origins.push({ sourcePath, name, implementationPath, exportName: 'NativeTypes', memberName: name })
    }
  }
  return origins
}

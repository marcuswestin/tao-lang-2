import { Assert, FS, Json } from '@shared'
import { NativeBindings } from './generate'
import { ExpoApiSource, ReactNativeApiSource } from './native-binding-sources'

/** generateNativeBindingFiles regenerates a complete supported import in a wholly generated directory. */
export async function generateNativeBindingFiles(
  packageName: string,
  options: { source: string; from: string; out: string; export?: string },
): Promise<string[]> {
  const source = [ExpoApiSource, ReactNativeApiSource].find(source => source.name === options.source)
  Assert.input(source !== undefined, `Unknown native API source '${options.source}'. Choose expo or react-native.`)
  const directory = FS.resolvePath(options.out)
  Assert.input(!await FS.isSymbolicLink(directory), `Binding output '${directory}' must not be a symlink.`)
  const generated = await NativeBindings.generate({
    source,
    packageName,
    fromDirectory: FS.resolvePath(options.from),
    ...(options.export === undefined ? {} : { exportName: options.export }),
  })
  Assert.input(
    generated.diagnostics.length === 0,
    `Cannot generate the complete binding:\n${
      generated.diagnostics.map(diagnostic => `${diagnostic.symbol}: ${diagnostic.reason}`).join('\n')
    }`,
  )
  Assert.input(generated.catalog.operations.length > 0, 'The selected native API has no supported actions.')
  const parent = FS.dirname(directory)
  await FS.mkdir(parent)
  const staging = await FS.mkTmpDir(`${directory}.staging-`)
  try {
    for (const [name, contents] of Object.entries(generated.files)) {
      await FS.writeText(FS.resolvePath(name, staging), contents)
    }
    await FS.synchronizeDirectoryFiles(staging, directory, {
      boundaryPath: parent,
      validateDestination: () => assertGeneratedDirectory(directory),
    })
  } finally {
    await FS.remove(staging)
  }
  return Object.keys(generated.files).map(name => FS.resolvePath(name, directory))
}

/** The existing catalog marks the whole directory as disposable, including any added or edited files. */
async function assertGeneratedDirectory(directory: string): Promise<void> {
  if (!await FS.exists(directory) || await FS.isEmptyDirectory(directory)) {
    return
  }
  const catalogPath = FS.resolvePath('bindings.json', directory)
  const manifest = !await FS.isSymbolicLink(catalogPath) && await FS.isFile(catalogPath)
    ? Json.tryParse(await FS.readText(catalogPath))
    : undefined
  const catalog = Json.isRecord(manifest) ? manifest['catalog'] : undefined
  const target = Json.isRecord(manifest) ? manifest['target'] : undefined
  Assert.input(
    Json.isRecord(manifest) && manifest['schemaVersion'] === 1
      && Json.isRecord(catalog) && Json.isRecord(target)
      && typeof catalog['packageName'] === 'string' && target['module'] === catalog['packageName']
      && typeof catalog['source'] === 'string' && typeof catalog['declarationHash'] === 'string'
      && Array.isArray(catalog['operations']) && Array.isArray(catalog['enums']),
    `Binding output '${directory}' is not a generated binding directory. Choose an empty directory or one containing its generated bindings.json catalog. Keep custom files outside it.`,
  )
}

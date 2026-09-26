import { ExpoApiSource, NativeBindings, ReactNativeApiSource } from '@compiler/native-bindings'
import { Assert, FS } from '@shared'

/** generateNativeBindingFiles writes a complete supported import into a new, caller-selected directory. */
export async function generateNativeBindingFiles(
  packageName: string,
  options: { source: string; from: string; out: string; export?: string },
): Promise<string[]> {
  const source = [ExpoApiSource, ReactNativeApiSource].find(source => source.name === options.source)
  Assert.input(source !== undefined, `Unknown native API source '${options.source}'. Choose expo or react-native.`)
  const directory = FS.resolvePath(options.out)
  Assert.input(!await FS.exists(directory), `Binding output '${directory}' already exists. Choose a new directory.`)
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
  Assert.input(
    await FS.mkdirExclusive(directory),
    `Binding output '${directory}' already exists. Choose a new directory.`,
  )
  const paths: string[] = []
  for (const [name, contents] of Object.entries(generated.files)) {
    const path = FS.resolvePath(name, directory)
    await FS.writeText(path, contents)
    paths.push(path)
  }
  return paths
}

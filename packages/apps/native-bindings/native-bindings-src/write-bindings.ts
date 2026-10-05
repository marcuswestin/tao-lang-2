import { Assert, FS, Json } from '@shared'
import { NativeBindings } from './generate'
import type { NativeApiImport } from './native-api'
import { ExpoApiSource, ReactNativeApiSource } from './native-binding-sources'

type NativeBindingWriteOptions = {
  source: string
  from: string
  out: string
  /** A separate, wholly owned subtree under .tao-ts; never the entire contract output root. */
  typescriptOut?: string
  mode?: 'write' | 'check'
  export?: string
  exclude?: string[]
  defer?: NativeApiImport['defer']
}

/** generateNativeBindingFiles regenerates a complete supported import in a wholly generated directory. */
export async function generateNativeBindingFiles(
  packageName: string,
  options: NativeBindingWriteOptions,
): Promise<string[]> {
  const source = [ExpoApiSource, ReactNativeApiSource].find(source => source.name === options.source)
  Assert.input(source !== undefined, `Unknown native API source '${options.source}'. Choose expo or react-native.`)
  const directory = FS.resolvePath(options.out)
  Assert.input(!await FS.isSymbolicLink(directory), `Binding output '${directory}' must not be a symlink.`)
  const typescriptDirectory = options.typescriptOut === undefined ? directory : FS.resolvePath(options.typescriptOut)
  Assert.input(
    typescriptDirectory === directory
      || !FS.pathIsWithin(directory, typescriptDirectory) && !FS.pathIsWithin(typescriptDirectory, directory),
    'Tao binding and TypeScript output directories must be separate, non-overlapping generated roots.',
  )
  Assert.input(
    !await FS.isSymbolicLink(typescriptDirectory),
    `Binding output '${typescriptDirectory}' must not be a symlink.`,
  )
  const moduleImport = (from: string, to: string): string => {
    const relative = FS.relativePath(from, to)
    return relative.startsWith('.') ? relative : `./${relative}`
  }
  const generated = await NativeBindings.generate({
    source,
    packageName,
    fromDirectory: FS.resolvePath(options.from),
    taoOriginDirectory: directory,
    typescriptOriginDirectory: typescriptDirectory,
    ...(options.export === undefined ? {} : { exportName: options.export }),
    ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
    ...(options.defer === undefined ? {} : { defer: options.defer }),
    ...(typescriptDirectory === directory ? {} : {
      implementationImport: moduleImport(directory, FS.resolvePath('Bindings.ts', typescriptDirectory)),
      taoTypeImport: moduleImport(typescriptDirectory, FS.resolvePath('Bindings.tao', directory)),
    }),
  })
  Assert.input(
    generated.diagnostics.length === 0,
    `Cannot generate the complete binding:\n${
      generated.diagnostics.map(diagnostic => `${diagnostic.symbol}: ${diagnostic.reason}`).join('\n')
    }`,
  )
  Assert.input(generated.catalog.operations.length > 0, 'The selected native API has no supported actions.')
  const fileSets = [{ directory, files: generated.files }]
  if (typescriptDirectory !== directory) {
    fileSets[0]!.files = Object.fromEntries(Object.entries(generated.files).filter(([name]) => !name.endsWith('.ts')))
    fileSets.push({
      directory: typescriptDirectory,
      files: {
        ...Object.fromEntries(Object.entries(generated.files).filter(([name]) => name.endsWith('.ts'))),
        'bindings.json': generated.files['bindings.json']!,
      },
    })
  }
  const paths = fileSets.flatMap(set => Object.keys(set.files).map(name => FS.resolvePath(name, set.directory)))
  await publishNativeBindingFileSets(fileSets, options.mode ?? 'write')
  return paths
}

/** Publish every generated root together, or check every root under the same publication lock. */
export async function publishNativeBindingFileSets(
  fileSets: readonly { directory: string; files: Record<string, string> }[],
  mode: 'write' | 'check',
  validateInputs?: () => Promise<void>,
  stagingDirectory?: string,
): Promise<void> {
  const directory = fileSets[0]!.directory
  const parent = FS.dirname(directory)
  if (mode === 'check') {
    await FS.withFileMutationLock(directory, parent, async () => {
      await validateInputs?.()
      for (const set of fileSets) {
        await assertGeneratedDirectory(set.directory)
        Assert.input(await FS.isDirectory(set.directory), `Native bindings are missing at '${set.directory}'.`)
        const expected = new Set(Object.keys(set.files))
        for await (const path of FS.walk(set.directory, { includeHidden: true, includeDirectories: true })) {
          Assert.input(!await FS.isSymbolicLink(path), `Native binding output '${path}' must not be a symlink.`)
          if (await FS.isDirectory(path)) {
            continue
          }
          Assert.input(
            expected.has(FS.relativePath(set.directory, path)),
            `Native binding output '${set.directory}' contains stale generated files. Regenerate bindings before checking or building.`,
          )
        }
        for (const [name, contents] of Object.entries(set.files)) {
          const path = FS.resolvePath(name, set.directory)
          Assert.input(
            await FS.isFile(path) && await FS.readText(path) === contents,
            `Native bindings are stale or missing at '${path}'. Regenerate bindings before checking or building.`,
          )
        }
      }
    })
    return
  }
  await FS.mkdir(parent)
  const stagingRoot = stagingDirectory === undefined ? undefined : FS.resolvePath(stagingDirectory)
  if (stagingRoot !== undefined) {
    Assert.input(
      fileSets.every(set => !FS.pathIsWithin(stagingRoot, set.directory)),
      'Native binding staging must stay outside every published output root.',
    )
    await FS.mkdir(stagingRoot)
  }
  const staging = await FS.mkTmpDir(
    stagingRoot === undefined ? `${directory}.staging-` : FS.resolvePath('publication-', stagingRoot),
  )
  try {
    for (const [index, set] of fileSets.entries()) {
      for (const [name, contents] of Object.entries(set.files)) {
        await FS.writeText(FS.resolvePath(`${index}/${name}`, staging), contents)
      }
    }
    await FS.synchronizeDirectoryFileSets(
      fileSets.map((set, index) => ({
        fromPath: FS.resolvePath(String(index), staging),
        toPath: set.directory,
      })),
      {
        sourceBoundaryPath: staging,
        validateDestination: async () => {
          await validateInputs?.()
          for (const set of fileSets) {
            await assertGeneratedDirectory(set.directory)
          }
        },
      },
    )
  } finally {
    await FS.remove(staging)
  }
}

/** The existing catalog marks the whole directory as disposable, including any added or edited files. */
async function assertGeneratedDirectory(directory: string): Promise<void> {
  Assert.input(!await FS.isSymbolicLink(directory), `Binding output '${directory}' must not be a symlink.`)
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

import { Assert, type Diagnostic, Errors, FS, Json, Platform, TaoResources, TaoStdlib } from '@shared'
import { NativeBindings } from './generate'
import { type MaintainedNativeSource, maintainedNativeSources } from './maintained-native-sources'
import type { NativeApiResolvedInput, NativeApiSource } from './native-api'
import { ExpoApiSource } from './native-binding-sources'
import { resolveTypeScriptApiEngineInput, resolveTypeScriptApiInput } from './typescript-api-source'
import { publishNativeBindingFileSets } from './write-bindings'

export type MaintainedBindingOptions = { stdlibRoot?: string; sourceRoots?: readonly string[] }
type Inspection = {
  status: 'fresh' | 'stale'
  diagnostics: readonly Diagnostic[]
  inputPaths: readonly string[]
  outputPaths: readonly string[]
  identity: string
}
type Entry = { path: string; hash: string }
type PackageInput = { name: string; version: string; files: Entry[] }
type Manifest = {
  schemaVersion: 1
  registry: string
  generator: string
  engine: string
  packages: PackageInput[]
  outputs: Entry[]
}
type Locations = { root: string; sourceRoots: string[]; explicitSources: boolean }
const manifestName = 'maintained.json'
const regenerate = 'Regenerate maintained native bindings with tao bindings generate --maintained.'

function locations(options: MaintainedBindingOptions): Locations {
  return {
    root: FS.resolvePath(
      options.stdlibRoot ?? TaoStdlib.declaredRoot() ?? FS.resolvePath('../../stdlib', import.meta.dir),
    ),
    sourceRoots: (options.sourceRoots
      ?? [FS.resolvePath('../../expo-host', import.meta.dir), FS.resolvePath('../../../..', import.meta.dir)])
      .map(path => FS.resolvePath(path)),
    explicitSources: options.sourceRoots !== undefined && options.sourceRoots.length > 0,
  }
}

function roots(root: string, source: MaintainedNativeSource): [string, string] {
  return [
    FS.resolvePath(`@tao/device/${source.capability}`, root),
    FS.resolvePath(`.tao-ts/native-bindings/${source.capability}`, root),
  ]
}

function registryIdentity(): string {
  return Platform.sha256Hex(JSON.stringify(maintainedNativeSources))
}

async function inBatches<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const values: R[] = []
  for (let index = 0; index < items.length; index += 32) {
    const results = await Promise.allSettled(items.slice(index, index + 32).map(read))
    // Finish each batch before reporting its first failure in inventory order.
    for (const result of results) {
      if (result.status === 'rejected') {
        throw Errors.asError(result.reason)
      }
      values.push(result.value)
    }
  }
  return values
}

async function generatorIdentity(): Promise<{ identity: string; paths: string[] }> {
  const resourceRoot = TaoResources.declaredRoot()
  const directory = await FS.isFile(FS.resolvePath('generate.ts', import.meta.dir))
    ? import.meta.dir
    : resourceRoot === undefined
    ? undefined
    : FS.resolvePath(TaoResources.NATIVE_BINDINGS_GENERATOR_DIRECTORY, resourceRoot)
  Assert.input(
    directory !== undefined && await FS.isDirectory(directory),
    'The maintained native binding generator inputs are missing from this installation. Repair the Tao installation.',
  )
  const paths: string[] = []
  for await (const path of FS.walk(directory)) {
    if (path.endsWith('.ts')) {
      paths.push(path)
    }
  }
  paths.sort()
  const entries = await inBatches(paths, async path => ({
    path: FS.relativePath(directory, path),
    hash: Platform.sha256Hex(await FS.readText(path)),
  }))
  entries.sort((a, b) => a.path.localeCompare(b.path))
  Assert.input(
    entries.some(entry => entry.path === 'generate.ts'),
    'The maintained native binding generator is incomplete.',
  )
  return { identity: Platform.sha256Hex(JSON.stringify(entries)), paths }
}

async function packageRoot(
  name: string,
  searchRoots: readonly string[],
): Promise<{ directory: string; from: string } | undefined> {
  for (const from of searchRoots) {
    if (!await FS.isDirectory(from)) {
      continue
    }
    const declaration = resolveTypeScriptApiInput(name, from)
    if (declaration !== undefined) {
      let directory = FS.dirname(declaration)
      while (!await FS.isFile(FS.resolvePath('package.json', directory))) {
        const parent = FS.dirname(directory)
        Assert.input(parent !== directory, `Native declaration '${declaration}' has no owning package.`)
        directory = parent
      }
      return { directory: await FS.realPath(directory), from }
    }
    let directory = from
    while (true) {
      const candidate = FS.resolvePath(`node_modules/${name}`, directory)
      if (await FS.isFile(FS.resolvePath('package.json', candidate))) {
        return { directory: await FS.realPath(candidate), from }
      }
      const parent = FS.dirname(directory)
      if (parent === directory) {
        break
      }
      directory = parent
    }
  }
  return undefined
}

async function inventory(
  directory: string,
): Promise<{ entries: Entry[]; paths: string[]; files: Record<string, string> }> {
  const paths: string[] = []
  for await (const path of FS.walk(directory, { excludeDirectory: name => name === 'node_modules' })) {
    const relative = FS.relativePath(directory, path)
    if (!(/\.d\.[cm]?ts$/.test(path) || relative === 'package.json')) {
      continue
    }
    paths.push(path)
  }
  paths.sort()
  const contents = await inBatches(paths, async path => {
    Assert.input(!await FS.isSymbolicLink(path), `Native declaration input '${path}' must not be a symlink.`)
    return await FS.readText(path)
  })
  const files: Record<string, string> = {}
  const entries = paths.map((path, index) => {
    const relative = FS.relativePath(directory, path)
    files[relative] = contents[index]!
    return { path: relative, hash: Platform.sha256Hex(contents[index]!) }
  })
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return { entries, paths, files }
}

function safeRelative(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !FS.isAbsolute(value)
    && !value.includes('\\')
    && !value.split('/').some(part => part === '..' || part === '.')
}

function entries(value: unknown): value is Entry[] {
  return Array.isArray(value) && value.every(entry =>
    Json.isRecord(entry)
    && safeRelative(entry['path']) && typeof entry['hash'] === 'string'
    && /^[a-f0-9]{64}$/.test(entry['hash'])
  )
}

async function readManifest(path: string, captured?: Uint8Array): Promise<Manifest> {
  Assert.input(
    !await FS.isSymbolicLink(path) && await FS.isFile(path),
    `Maintained native binding manifest is missing at '${path}'.`,
  )
  const value = Json.tryParse(
    captured === undefined ? await FS.readText(path) : new TextDecoder('utf-8', { fatal: true }).decode(captured),
  )
  Assert.input(
    Json.isRecord(value) && value['schemaVersion'] === 1
      && typeof value['registry'] === 'string' && typeof value['generator'] === 'string'
      && typeof value['engine'] === 'string' && /^[a-f0-9]{64}$/.test(value['engine'])
      && entries(value['outputs']) && Array.isArray(value['packages'])
      && value['packages'].every(item =>
        Json.isRecord(item)
        && typeof item['name'] === 'string' && safeRelative(item['name'])
        && typeof item['version'] === 'string' && entries(item['files'])
      ),
    `Maintained native binding manifest is invalid at '${path}'.`,
  )
  return value as unknown as Manifest
}

/** Inspection hashes complete declaration inventories and published contents without rebuilding a TypeScript program. */
export async function inspectMaintainedNativeBindings(
  options: MaintainedBindingOptions = {},
  observers: {
    /** Test seam for races after capture; it cannot substitute the bytes or the validation result. */
    afterManifestCapture?: () => Promise<void>
    /** Observe completed hashing before the final snapshot guards, without changing its verdict. */
    afterInspection?: () => Promise<void>
  } = {},
): Promise<Inspection> {
  const location = locations(options)
  const first = roots(location.root, maintainedNativeSources[0]!)[0]
  const parent = FS.dirname(first)
  const inspect = () => inspectUnlocked(location)
  if (!await FS.isDirectory(parent)) {
    return await inspect()
  }
  // Match the publisher's canonical boundary and target, without claiming its exclusive lock.
  // Missing roots and every interrupted snapshot retain the lock's wait/reclaim behavior.
  if (await FS.isDirectory(first) && !await FS.isSymbolicLink(first) && !await FS.isSymbolicLink(parent)) {
    const canonicalParent = await FS.realPath(parent)
    const canonicalFirst = FS.resolvePath(FS.relativePath(parent, first), canonicalParent)
    const lock = `${canonicalFirst}.tao-file-mutation.lock`
    const paths = maintainedNativeSources.map(source => FS.resolvePath(manifestName, roots(location.root, source)[1]))
    const capture = async () =>
      new Map(
        await Promise.all(paths.map(async path => {
          Assert.input(
            !await FS.isSymbolicLink(path) && await FS.isFile(path),
            `Maintained native binding manifest is missing at '${path}'.`,
          )
          return [path, await FS.readFile(path)] as const
        })),
      )
    try {
      if (!await FS.exists(lock)) {
        const before = await capture()
        await observers.afterManifestCapture?.()
        const result = await inspectUnlocked(location, before)
        await observers.afterInspection?.()
        const after = await capture()
        if (
          !await FS.exists(lock)
          && paths.every(path => {
            const previous = before.get(path)!
            const current = after.get(path)!
            return previous.length === current.length && previous.every((byte, index) => byte === current[index])
          })
        ) {
          return result
        }
      }
    } catch {
      // Re-read under the publisher lock to report the existing actionable diagnostics.
    }
  }
  return await FS.withFileMutationLock(first, parent, inspect)
}

async function inspectUnlocked(location: Locations, manifests?: ReadonlyMap<string, Uint8Array>): Promise<Inspection> {
  // These snapshots are shared only within this inspection, never with a later check
  // or generation's independent publication guard.
  const inventories = new Map<string, ReturnType<typeof inventory>>()
  const engines = new Map<string, Promise<string>>()
  const inspectInventory = async (directory: string) => {
    const canonical = await FS.realPath(directory)
    let pending = inventories.get(canonical)
    if (pending === undefined) {
      pending = inventory(canonical)
      inventories.set(canonical, pending)
    }
    return await pending
  }
  const inspectEngine = async (path: string) => {
    const canonical = await FS.realPath(path)
    let pending = engines.get(canonical)
    if (pending === undefined) {
      pending = FS.readText(canonical).then(contents => Platform.sha256Hex(contents))
      engines.set(canonical, pending)
    }
    return await pending
  }
  const diagnostics: Diagnostic[] = []
  const inputPaths = new Set<string>(location.sourceRoots)
  const outputPaths = new Set<string>()
  const identities: unknown[] = [location.root, location.sourceRoots, registryIdentity()]
  const stale = (error: unknown, path?: string) =>
    diagnostics.push({
      severity: 'error',
      source: 'compiler',
      code: 'maintained-native-bindings-stale',
      ...(path === undefined ? {} : { filePath: path }),
      message: `${Errors.asError(error).message} ${regenerate}`,
    })
  let generator: Awaited<ReturnType<typeof generatorIdentity>> | undefined
  try {
    generator = await generatorIdentity()
    identities.push(generator.identity)
    generator.paths.forEach(path => inputPaths.add(path))
  } catch (error) {
    stale(error)
  }
  for (const source of maintainedNativeSources) {
    const [taoRoot, tsRoot] = roots(location.root, source)
    const manifestPath = FS.resolvePath(manifestName, tsRoot)
    outputPaths.add(manifestPath)
    try {
      const manifest = await readManifest(manifestPath, manifests?.get(manifestPath))
      identities.push(manifest)
      Assert.input(
        manifest.registry === registryIdentity(),
        'The maintained native package pins or source contracts changed.',
      )
      Assert.input(manifest.generator === generator?.identity, 'The maintained native binding generator changed.')
      const live = await packageRoot(source.packageName, location.sourceRoots)
      Assert.input(
        live !== undefined || !location.explicitSources,
        `Cannot find '${source.packageName}' in the supplied declaration source roots.`,
      )
      const resolutionRoots = live === undefined
        ? [FS.resolvePath('inputs', tsRoot)]
        : [live.directory, ...location.sourceRoots]
      const enginePath = resolveTypeScriptApiEngineInput(live?.from ?? FS.resolvePath('inputs', tsRoot))
      // Default library declarations belong to the engine's package, independently of an
      // API package's own transitive TypeScript dependency or public type entry.
      const engineRoot = FS.dirname(FS.dirname(enginePath))
      const engine = await inspectEngine(enginePath)
      inputPaths.add(enginePath)
      identities.push(engine)
      Assert.input(engine === manifest.engine, 'The pinned TypeScript engine for maintained native bindings changed.')
      for (const item of manifest.packages) {
        const payloadDirectory = FS.resolvePath(`inputs/node_modules/${item.name}`, tsRoot)
        const resolved = live === undefined
          ? await FS.isDirectory(payloadDirectory) ? { directory: payloadDirectory } : undefined
          : item.name === 'typescript'
          ? { directory: engineRoot }
          : await packageRoot(item.name, resolutionRoots)
        Assert.input(resolved !== undefined, `Pinned declaration inputs for '${item.name}' are missing.`)
        inputPaths.add(resolved.directory)
        const actual = await inspectInventory(resolved.directory)
        actual.paths.forEach(path => inputPaths.add(path))
        identities.push([item.name, actual.entries])
        Assert.input(
          JSON.stringify(actual.entries) === JSON.stringify(item.files),
          `Declaration input inventory or contents changed for '${item.name}'.`,
        )
        const packageManifest = Json.tryParse(actual.files['package.json'] ?? '')
        Assert.input(
          Json.isRecord(packageManifest) && packageManifest['name'] === item.name
            && packageManifest['version'] === item.version,
          `Declaration package '${item.name}' no longer matches pinned version '${item.version}'.`,
        )
      }
      const pinned = manifest.packages.find(item => item.name === source.packageName)
      Assert.input(
        pinned?.version === source.version,
        `Native package '${source.packageName}' requires exact version '${source.version}'.`,
      )
      const actualOutputs: Entry[] = []
      for (const [label, directory] of [['tao', taoRoot], ['typescript', tsRoot]] as const) {
        Assert.input(
          !await FS.isSymbolicLink(directory) && await FS.isDirectory(directory),
          `Native binding output is missing at '${directory}'.`,
        )
        const paths: string[] = []
        for await (const path of FS.walk(directory, { includeHidden: true, includeDirectories: true })) {
          paths.push(path)
        }
        const inspected = await inBatches(paths.sort(), async path => {
          Assert.input(!await FS.isSymbolicLink(path), `Native binding output '${path}' must not be a symlink.`)
          if (await FS.isDirectory(path)) {
            return undefined
          }
          return {
            path,
            entry: path === manifestPath ? undefined : {
              path: `${label}/${FS.relativePath(directory, path)}`,
              hash: Platform.sha256Hex(await FS.readText(path)),
            },
          }
        })
        for (const item of inspected) {
          if (item !== undefined) {
            outputPaths.add(item.path)
            if (item.entry !== undefined) {
              actualOutputs.push(item.entry)
            }
          }
        }
      }
      actualOutputs.sort((a, b) => a.path.localeCompare(b.path))
      identities.push(actualOutputs)
      Assert.input(
        JSON.stringify(actualOutputs) === JSON.stringify(manifest.outputs),
        `Native binding output inventory or contents changed for '${source.capability}'.`,
      )
    } catch (error) {
      stale(error, manifestPath)
    }
  }
  return {
    status: diagnostics.length === 0 ? 'fresh' : 'stale',
    diagnostics,
    inputPaths: [...inputPaths].sort(),
    outputPaths: [...outputPaths].sort(),
    identity: Platform.sha256Hex(JSON.stringify(identities)),
  }
}

/** Generate the complete maintained registry before replacing any output; offline inputs are verified first. */
export async function generateMaintainedNativeBindings(
  options: MaintainedBindingOptions & { mode: 'write' | 'check' },
): Promise<string[]> {
  if (options.mode === 'check') {
    const result = await inspectMaintainedNativeBindings(options)
    Assert.input(result.status === 'fresh', result.diagnostics.map(item => item.message).join('\n'))
    return [...result.outputPaths]
  }
  const location = locations(options)
  const generator = await generatorIdentity()
  const fileSets: { directory: string; files: Record<string, string> }[] = []
  const capturedInventories = new Map<string, Entry[]>()
  const capturedEngines = new Map<string, string>()
  for (const source of maintainedNativeSources) {
    const [taoRoot, tsRoot] = roots(location.root, source)
    const live = await packageRoot(source.packageName, location.sourceRoots)
    Assert.input(
      live !== undefined || !location.explicitSources,
      `Cannot find '${source.packageName}' in the supplied declaration source roots.`,
    )
    const from = live?.from ?? FS.resolvePath('inputs', tsRoot)
    const enginePath = resolveTypeScriptApiEngineInput(from)
    const engine = Platform.sha256Hex(await FS.readText(enginePath))
    capturedEngines.set(enginePath, engine)
    const offlineManifest = live === undefined ? await assertOfflineInputs(source, tsRoot) : undefined
    Assert.input(
      offlineManifest === undefined || offlineManifest.engine === engine,
      'Offline extraction requires the pinned TypeScript engine. Repair the Tao installation.',
    )
    const installed = await packageRoot(source.packageName, [from])
    Assert.input(
      installed !== undefined,
      `Pinned declarations for '${source.packageName}' are unavailable. ${regenerate}`,
    )
    const packageManifest = Json.tryParse(await FS.readText(FS.resolvePath('package.json', installed.directory)))
    Assert.input(
      Json.isRecord(packageManifest) && packageManifest['name'] === source.packageName
        && packageManifest['version'] === source.version,
      `Native package '${source.packageName}' requires exact version '${source.version}'.`,
    )
    let resolvedInputs: NativeApiResolvedInput[] = []
    const reader: NativeApiSource = {
      name: ExpoApiSource.name,
      async read(request) {
        const result = await ExpoApiSource.read(request)
        resolvedInputs = result.resolvedInputs ?? []
        return result
      },
    }
    const relativeImport = (from: string, to: string) => {
      const relative = FS.relativePath(from, to)
      return relative.startsWith('.') ? relative : `./${relative}`
    }
    const generated = await NativeBindings.generate({
      source: reader,
      packageName: source.packageName,
      fromDirectory: from,
      ...(source.globalExports === undefined ? {} : { globalExports: source.globalExports }),
      defer: source.defer,
      implementationImport: relativeImport(taoRoot, FS.resolvePath('Bindings.ts', tsRoot)),
      taoTypeImport: relativeImport(tsRoot, FS.resolvePath('Bindings.tao', taoRoot)),
      taoOriginDirectory: taoRoot,
      typescriptOriginDirectory: tsRoot,
      originDeclaration: provenance =>
        FS.resolvePath(`inputs/node_modules/${provenance.packageName}/${provenance.declaration}`, tsRoot),
    })
    Assert.input(
      generated.diagnostics.length === 0,
      `Cannot generate the complete maintained '${source.capability}' binding:\n${
        generated.diagnostics.map(item => `${item.symbol}: ${item.reason}`).join('\n')
      }`,
    )
    Assert.input(
      generated.catalog.operations.length > 0 && resolvedInputs.length > 0,
      `The maintained '${source.capability}' API has no supported actions or captured declaration inputs.`,
    )
    for (const item of source.defer) {
      Assert.input(
        generated.catalog.coverage?.some(row =>
          row.provenance.symbol === item.symbol && row.provenance.declaration === item.declaration
          && row.disposition === item.disposition
        ),
        `Pinned native deferral '${item.symbol}' does not match '${item.declaration}'.`,
      )
    }
    const taoFiles = Object.fromEntries(Object.entries(generated.files).filter(([name]) => !name.endsWith('.ts')))
    const tsFiles: Record<string, string> = {
      ...Object.fromEntries(Object.entries(generated.files).filter(([name]) => name.endsWith('.ts'))),
      'bindings.json': generated.files['bindings.json']!,
    }
    const packages: PackageInput[] = []
    const names = new Map<string, string>()
    for (const input of resolvedInputs) {
      Assert.input(
        safeRelative(input.packageName) && safeRelative(input.declaration),
        'Native declaration payload names must stay inside their owning package.',
      )
      const expected = generated.catalog.inputs?.find(item =>
        item.packageName === input.packageName && item.packageVersion === input.packageVersion
        && item.declaration === input.declaration
      )
      Assert.input(
        expected !== undefined && Platform.sha256Hex(await FS.readText(input.filePath)) === expected.hash,
        `Declaration input '${input.packageName}/${input.declaration}' changed during extraction.`,
      )
      const known = names.get(input.packageName)
      Assert.input(
        known === undefined || known === input.packageRoot,
        `Multiple installations of '${input.packageName}' cannot share one pinned declaration payload.`,
      )
      if (known !== undefined) {
        continue
      }
      names.set(input.packageName, input.packageRoot)
      const captured = await inventory(input.packageRoot)
      if (offlineManifest !== undefined) {
        const pinned = offlineManifest.packages.find(item => item.name === input.packageName)
        Assert.input(
          pinned?.version === input.packageVersion
            && JSON.stringify(pinned.files) === JSON.stringify(captured.entries),
          `Offline extraction requires the pinned declaration inputs and TypeScript engine for '${input.packageName}@${
            pinned?.version ?? 'unknown'
          }'. Repair the Tao installation.`,
        )
      }
      capturedInventories.set(input.packageRoot, captured.entries)
      packages.push({ name: input.packageName, version: input.packageVersion, files: captured.entries })
      for (const [path, contents] of Object.entries(captured.files)) {
        tsFiles[`inputs/node_modules/${input.packageName}/${path}`] = contents
      }
    }
    packages.sort((a, b) => a.name.localeCompare(b.name))
    const outputs = [
      ...Object.entries(taoFiles).map(([path, content]) => ({
        path: `tao/${path}`,
        hash: Platform.sha256Hex(content),
      })),
      ...Object.entries(tsFiles).map(([path, content]) => ({
        path: `typescript/${path}`,
        hash: Platform.sha256Hex(content),
      })),
    ].sort((a, b) => a.path.localeCompare(b.path))
    const manifest: Manifest = {
      schemaVersion: 1,
      registry: registryIdentity(),
      generator: generator.identity,
      engine,
      packages,
      outputs,
    }
    tsFiles[manifestName] = `${JSON.stringify(manifest, null, 2)}\n`
    fileSets.push({ directory: taoRoot, files: taoFiles }, { directory: tsRoot, files: tsFiles })
  }
  const stagingDirectory = FS.resolvePath(
    await FS.isDirectory(FS.resolvePath('.tao', location.root))
      ? '.tao/cache/native-bindings'
      : '.tao-ts/cache/native-bindings',
    location.root,
  )
  await publishNativeBindingFileSets(fileSets, 'write', async () => {
    Assert.input(
      (await generatorIdentity()).identity === generator.identity,
      'The native binding generator changed during generation.',
    )
    for (const [path, expected] of capturedEngines) {
      Assert.input(
        Platform.sha256Hex(await FS.readText(path)) === expected,
        'The pinned TypeScript engine changed during native binding generation.',
      )
    }
    for (const [directory, expected] of capturedInventories) {
      Assert.input(
        JSON.stringify((await inventory(directory)).entries) === JSON.stringify(expected),
        `Declaration inputs changed during generation at '${directory}'.`,
      )
    }
  }, stagingDirectory)
  return fileSets.flatMap(set => Object.keys(set.files).map(name => FS.resolvePath(name, set.directory))).sort()
}

async function assertOfflineInputs(source: MaintainedNativeSource, tsRoot: string): Promise<Manifest> {
  const manifest = await readManifest(FS.resolvePath(manifestName, tsRoot))
  Assert.input(
    manifest.registry === registryIdentity(),
    'The offline maintained declaration payload has obsolete package pins.',
  )
  Assert.input(
    manifest.packages.find(item => item.name === source.packageName)?.version === source.version,
    `The offline declaration payload requires '${source.packageName}@${source.version}'.`,
  )
  for (const item of manifest.packages) {
    const directory = FS.resolvePath(`inputs/node_modules/${item.name}`, tsRoot)
    Assert.input(
      await FS.isDirectory(directory)
        && JSON.stringify((await inventory(directory)).entries) === JSON.stringify(item.files),
      `The offline declaration payload for '${item.name}' is missing or changed. Repair the Tao installation.`,
    )
  }
  return manifest
}

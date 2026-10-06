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
/**
 * A memo of one fresh hashing pass: every path the pass read or walked, the stat fingerprint of
 * those paths and of the manifests it was handed, and the verdict it produced. Only the hashing
 * step is memoised; a fingerprint that moved, a stale verdict, a held publication lock, and
 * explicit `stdlibRoot`/`sourceRoots` options all take the cold path.
 */
type Memo = { fingerprint: string; result: Inspection; watched: readonly string[] }
const memos = new Map<string, Memo>()
let memoisedPasses = 0
const manifestName = 'maintained.json'
const regenerate = 'Regenerate maintained native bindings with tao bindings generate --maintained.'
// A reader only needs a consistent snapshot. A publication that holds the lock longer than this
// on a loaded host is reported with its owner rather than waited out for the publisher's margin.
const INSPECTION_LOCK_WAIT_MS = 60_000

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

async function generatorIdentity(
  beforeRead?: (paths: readonly string[]) => Promise<void>,
): Promise<{ identity: string; paths: string[]; directory: string }> {
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
  await beforeRead?.([directory])
  for await (const path of FS.walk(directory, { includeDirectories: true })) {
    if (await FS.isDirectory(path)) {
      await beforeRead?.([path])
    } else if (path.endsWith('.ts')) {
      paths.push(path)
    }
  }
  paths.sort()
  await beforeRead?.(paths)
  const entries = await inBatches(paths, async path => ({
    path: FS.relativePath(directory, path),
    hash: Platform.sha256Hex(await FS.readText(path)),
  }))
  entries.sort((a, b) => a.path.localeCompare(b.path))
  Assert.input(
    entries.some(entry => entry.path === 'generate.ts'),
    'The maintained native binding generator is incomplete.',
  )
  return { identity: Platform.sha256Hex(JSON.stringify(entries)), paths, directory }
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
  beforeRead?: (paths: readonly string[]) => Promise<void>,
): Promise<{ entries: Entry[]; paths: string[]; directories: string[]; files: Record<string, string> }> {
  const paths: string[] = []
  const directories: string[] = [directory]
  await beforeRead?.([directory])
  for await (
    const path of FS.walk(directory, { includeDirectories: true, excludeDirectory: name => name === 'node_modules' })
  ) {
    if (await FS.isDirectory(path)) {
      directories.push(path)
      await beforeRead?.([path])
      continue
    }
    const relative = FS.relativePath(directory, path)
    if (!(/\.d\.[cm]?ts$/.test(path) || relative === 'package.json')) {
      continue
    }
    paths.push(path)
  }
  paths.sort()
  await beforeRead?.(paths)
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
  return { entries, paths, directories, files }
}

/**
 * memoKey names the process-wide memo an inspection may use, or nothing when the caller chose its
 * own roots: tests that must exercise the cold path do so through `stdlibRoot`/`sourceRoots`.
 * Environment-declared roots are part of the key because `locations` and the engine resolution
 * read them.
 */
function memoKey(options: MaintainedBindingOptions, location: Locations): string | undefined {
  if (options.stdlibRoot !== undefined || options.sourceRoots !== undefined) {
    return undefined
  }
  return JSON.stringify([location.root, location.sourceRoots, TaoResources.declaredRoot() ?? null])
}

/**
 * fingerprint identifies the watched paths by what `lstat` reports (kind, size, modification time,
 * inode) and the captured manifest bytes. A directory's modification time moves when an entry is
 * added or removed, so a new or deleted file under a walked tree changes the fingerprint even
 * though only files are hashed. An in-place rewrite that preserves size and timestamp is the one
 * change this cannot see; callers that need that guarantee bypass the memo with explicit roots.
 */
async function pathFingerprint(path: string): Promise<string> {
  try {
    const entry = await FS.entryMetadata(path)
    return `${path}\0${entry.kind}\0${entry.size}\0${entry.modifiedMs}\0${entry.inode}`
  } catch {
    return `${path}\0missing`
  }
}

function capturedFingerprint(stats: readonly string[], manifests: ReadonlyMap<string, Uint8Array | null>): string {
  const captured = [...manifests.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([path, bytes]) => `${path}\0${bytes === null ? 'missing' : Platform.sha256Hex(bytes)}`)
  return Platform.sha256Hex([...stats, ...captured].join('\n'))
}

async function fingerprint(
  watched: readonly string[],
  manifests: ReadonlyMap<string, Uint8Array | null>,
): Promise<string> {
  return capturedFingerprint(await inBatches(watched, pathFingerprint), manifests)
}

/** memoisedInspectionPasses counts inspections answered from the memo; a test seam for the hashing step. */
export function memoisedInspectionPasses(): number {
  return memoisedPasses
}

/** forgetInspectionMemos empties the process-wide memo; a test seam for isolating cold passes. */
export function forgetInspectionMemos(): void {
  memos.clear()
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

async function readManifest(path: string, captured?: Uint8Array | null): Promise<Manifest> {
  Assert.input(
    captured !== null && (captured !== undefined || !await FS.isSymbolicLink(path) && await FS.isFile(path)),
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
    /** Observe that inspection must cross the publication barrier, before waiting on its lock. */
    beforePublicationBarrier?: () => Promise<void>
    /** Test seam for races after capture; it cannot substitute the bytes or the validation result. */
    afterManifestCapture?: () => Promise<void>
    /** Observe completed hashing before the final snapshot guards, without changing its verdict. */
    afterInspection?: () => Promise<void>
  } = {},
): Promise<Inspection> {
  const location = locations(options)
  const first = roots(location.root, maintainedNativeSources[0]!)[0]
  const parent = FS.dirname(first)
  if (!await FS.isDirectory(parent)) {
    return await inspectUnlocked(location)
  }
  const canInspectOptimistically = await FS.isDirectory(first)
    && !await FS.isSymbolicLink(first) && !await FS.isSymbolicLink(parent)
  const lock = `${FS.resolvePath(FS.relativePath(parent, first), await FS.realPath(parent))}.tao-file-mutation.lock`
  const paths = maintainedNativeSources.map(source => FS.resolvePath(manifestName, roots(location.root, source)[1]))
  const capture = async () =>
    new Map(
      await Promise.all(paths.map(async path =>
        [
          path,
          !await FS.isSymbolicLink(path) && await FS.isFile(path) ? await FS.readFile(path) : null,
        ] as const
      )),
    )
  const sameSnapshot = (
    before: ReadonlyMap<string, Uint8Array | null>,
    after: ReadonlyMap<string, Uint8Array | null>,
  ) =>
    paths.every(path => {
      const previous = before.get(path)!
      const current = after.get(path)!
      return previous === null || current === null
        ? previous === current
        : previous.length === current.length && previous.every((byte, index) => byte === current[index])
    })
  let observedCapture = false
  let observedInspection = false
  const notifyCapture = async () => {
    if (!observedCapture) {
      observedCapture = true
      await observers.afterManifestCapture?.()
    }
  }
  const notifyInspection = async () => {
    if (!observedInspection) {
      observedInspection = true
      await observers.afterInspection?.()
    }
  }
  let firstAttempt = true
  for (let attempt = 0; attempt < 3; attempt++) {
    const barrierRequired = !firstAttempt || !canInspectOptimistically || await FS.exists(lock)
    firstAttempt = false
    if (barrierRequired) {
      await observers.beforePublicationBarrier?.()
      // Let the publication lock validate the canonical boundary and reclaim stale ownership.
      await FS.withFileMutationLock(first, parent, async () => undefined, { timeoutMs: INSPECTION_LOCK_WAIT_MS })
    }
    let before: Map<string, Uint8Array | null>
    try {
      before = await capture()
    } catch {
      continue
    }
    await notifyCapture()
    let pass: Awaited<ReturnType<typeof inspectMemoised>>
    try {
      // A reader that crossed a publisher barrier must rebuild its snapshot cold.
      pass = await inspectMemoised(barrierRequired ? undefined : memoKey(options, location), location, before)
    } catch {
      // A concurrent publication can interrupt hashing; retry from a fresh barrier.
      continue
    }
    await notifyInspection()
    let after: Map<string, Uint8Array | null>
    try {
      after = await capture()
    } catch {
      continue
    }
    if (sameSnapshot(before, after) && await pass.accept?.() !== false && !await FS.exists(lock)) {
      if (pass.result.status === 'fresh') {
        pass.remember?.()
        return pass.result
      }
      return await FS.withFileMutationLock(first, parent, () => inspectUnlocked(location), {
        timeoutMs: INSPECTION_LOCK_WAIT_MS,
      })
    }
  }
  Errors.throwHostEnvironment(
    'Maintained native binding files kept changing during inspection. Retry the check after publication finishes.',
  )
}

/**
 * inspectMemoised answers from the memo when the watched paths and captured manifests still carry
 * the fingerprint of the last fresh pass, and otherwise runs the hashing pass and remembers a fresh
 * verdict. A stale verdict is never remembered: its recovery adds files the stale pass did not watch.
 */
async function inspectMemoised(
  key: string | undefined,
  location: Locations,
  manifests: ReadonlyMap<string, Uint8Array | null>,
): Promise<{ result: Inspection; accept?: () => Promise<boolean>; remember?: () => void }> {
  if (key === undefined) {
    return { result: await inspectUnlocked(location, manifests) }
  }
  const memo = memos.get(key)
  if (memo !== undefined && await fingerprint(memo.watched, manifests) === memo.fingerprint) {
    memoisedPasses += 1
    return {
      result: memo.result,
      accept: async () => {
        if (await fingerprint(memo.watched, manifests) === memo.fingerprint) {
          return true
        }
        memos.delete(key)
        return false
      },
    }
  }
  memos.delete(key)
  const watched = new Set<string>()
  const beforeHash = new Map<string, string>()
  const result = await inspectUnlocked(location, manifests, watched, beforeHash)
  if (result.status !== 'fresh') {
    return { result }
  }
  const sorted = [...watched].sort()
  // Metadata is captured before each inventory walk and content read. Reject a memo
  // whose inputs changed during hashing rather than attaching old contents to new stats.
  const candidate: Memo = {
    fingerprint: capturedFingerprint(sorted.map(path => beforeHash.get(path)!), manifests),
    result,
    watched: sorted,
  }
  // Remembered only once the caller's snapshot guards accept the pass; a publication that began
  // during the pass is discarded there and must not be remembered here.
  return {
    result,
    accept: async () => await fingerprint(sorted, manifests) === candidate.fingerprint,
    remember: () => memos.set(key, candidate),
  }
}

async function inspectUnlocked(
  location: Locations,
  manifests?: ReadonlyMap<string, Uint8Array | null>,
  watched: Set<string> = new Set(),
  beforeHash?: Map<string, string>,
): Promise<Inspection> {
  const watch = async (paths: readonly string[]) => {
    await inBatches(paths, async path => {
      if (!watched.has(path)) {
        watched.add(path)
        if (beforeHash !== undefined) {
          beforeHash.set(path, await pathFingerprint(path))
        }
      }
    })
  }
  // These snapshots are shared only within this inspection, never with a later check
  // or generation's independent publication guard.
  const inventories = new Map<string, ReturnType<typeof inventory>>()
  const engines = new Map<string, Promise<string>>()
  const inspectInventory = async (directory: string) => {
    const canonical = await FS.realPath(directory)
    let pending = inventories.get(canonical)
    if (pending === undefined) {
      pending = inventory(canonical, watch)
      inventories.set(canonical, pending)
    }
    return await pending
  }
  const inspectEngine = async (path: string) => {
    const canonical = await FS.realPath(path)
    let pending = engines.get(canonical)
    if (pending === undefined) {
      await watch([canonical])
      pending = FS.readText(canonical).then(contents => Platform.sha256Hex(contents))
      engines.set(canonical, pending)
    }
    return await pending
  }
  const diagnostics: Diagnostic[] = []
  const inputPaths = new Set<string>(location.sourceRoots)
  const outputPaths = new Set<string>()
  await watch(location.sourceRoots)
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
    generator = await generatorIdentity(watch)
    identities.push(generator.identity)
    generator.paths.forEach(path => inputPaths.add(path))
    await watch(generator.paths)
  } catch (error) {
    stale(error)
  }
  for (const source of maintainedNativeSources) {
    const [taoRoot, tsRoot] = roots(location.root, source)
    const manifestPath = FS.resolvePath(manifestName, tsRoot)
    outputPaths.add(manifestPath)
    await watch([manifestPath])
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
      await watch([enginePath])
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
        await watch([...actual.paths, ...actual.directories])
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
        await watch([directory])
        for await (const path of FS.walk(directory, { includeHidden: true, includeDirectories: true })) {
          paths.push(path)
          await watch([path])
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

import type { CompileResult, EmittedModuleCache } from '@compiler/compiler'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { findProjectRoot } from '@project-tooling'
import { Assert, type FirebaseConnection, FS, HCI, Platform, readFirebaseConnections } from '@shared'
import type { DevLoopMobilePublication } from '@shared/DevLoopControl'
import { withGeneratedModuleLinks } from './generated-module-links'
import { expoUpdateArtifacts, proveReleaseBundle } from './release-bundle-proof'
import { RuntimeToolchainPaths } from './runtime-toolchain-paths'
export { DesktopHost } from './desktop-host'

export { HostDependencies } from './host-dependencies'
export { ManagedNode, type NodeManifest } from './managed-node'
export {
  type ExpoUpdateArtifact,
  type ExpoUpdateArtifacts,
  expoUpdateArtifacts,
  proveReleaseBundle,
  type ReleaseBundleProof,
} from './release-bundle-proof'
export { RuntimeToolchainPaths } from './runtime-toolchain-paths'

export type GeneratePreviewOptions = {
  /** Disable revision marker updates and their exact publication checks for a browser speed experiment. */
  publicationChecks?: boolean
  /** Complete changed-source hints for the temporary preview-first experiments. */
  experimentalChangedSourcePaths?: readonly string[]
  sourceOverrides?: Readonly<Record<string, string>>
  project: string
  revision: number
  sourceVersions: Readonly<Record<string, string>>
  /** Per-file last-change epochs coordinate independently refreshed design and consumer modules. */
  sourceEpochs?: Readonly<Record<string, number>>
}

export type StudioPreviewIdentity = {
  appName: string
  project: string
}

export type StudioPreviewPublication = StudioPreviewIdentity & {
  revision: number
  sourceVersions: Readonly<Record<string, string>>
}

export type GenerateAppOptions = {
  appName?: string
  cwd?: string
  datasourceConfiguration?: Readonly<Record<string, string>>
  /** Installed dependency target root for generated module links; defaults to the source project. */
  moduleLinkRoot?: string
  preview?: GeneratePreviewOptions
  /** A Studio session may reuse its isolated parser services across preview revisions. */
  previewWorkspace?: Workspace
  /** One caller's validated Tao module reuse across its generated revisions. */
  emittedModuleCache?: EmittedModuleCache
  /** publicationHooks exposes file-operation failure seams for transactional publication tests. */
  publicationHooks?: Pick<FS.SynchronizeDirectoryFileSetsOptions, 'beforeMove' | 'beforeRemove'>
  /** journeyObservations emits test-harness-only render source locators without enabling Studio preview behavior. */
  journeyObservations?: boolean
  runtimePackageRoot?: string
  ship?: ShipManifest
  validationMode?: 'development' | 'release'
  managedPublication?: Omit<DevLoopMobilePublication, 'sourceRevision' | 'compiledRevision' | 'nonce'>
}

export type ShipUpdatesConfig = {
  channel: string
  runtimeFingerprint: string
  runtimeVersion: string
  url: string
}

/** ShipManifest is the generated release host contract consumed by app.config.js and the ship pipeline. */
export type ShipManifest = {
  buildNumber: string
  bundleIdentifier: string
  git: {
    commit: string
    dirty: boolean
  }
  icon: 'default' | 'badged'
  /** icloud names the containers and services an app bound to an Apple datasource is entitled to. */
  icloud?: {
    containers: readonly string[]
    /** documentContainers is the subset mounted by the document datasource rather than CloudKit alone. */
    documentContainers: readonly string[]
    services: ReadonlyArray<'CloudDocuments' | 'CloudKit'>
  }
  ios: {
    usesNonExemptEncryption?: false
  }
  name: string
  schemaVersion: 1
  slug: string
  splash?: string
  updates?: ShipUpdatesConfig
  version: string
}

export type GeneratedApp = {
  sourcePath: string
  outputPath: string
  code: string
  preview?: StudioPreviewPublication
  previewRevision?: number
  previewPublicationSkipped?: boolean
  shipManifest?: ShipManifest
  shipManifestPath?: string
  studioManifest?: NonNullable<Awaited<ReturnType<typeof Workspace.compile>>['studioManifest']>
  emittedModuleCache?: CompileResult['emittedModuleCache']
  managedPublication?: DevLoopMobilePublication
}

const generationQueues = new Map<string, Promise<void>>()
const previewPublications = new Map<string, StudioPreviewPublication>()
type PreviewOutputSnapshot = {
  files: ReadonlyMap<string, string>
  metadata: string
  attemptRevision: number
}
const previewOutputSnapshots = new Map<string, PreviewOutputSnapshot>()
const studioPublicationPath = 'TaoStudioPublication.ts'
const legacyPreviewPaths = [
  'current',
  'revisions',
  'TaoStudioActivePreview.ts',
  'TaoStudioProject.ts',
  'TaoStudioRevision.ts',
] as const

/** generateApp generates the runtime app module from a Tao app file. */
async function generateApp(appPath: string, opts: GenerateAppOptions = {}): Promise<GeneratedApp> {
  const runtimePackageRoot = opts.runtimePackageRoot ?? defaultRuntimePackageRoot()
  const sourcePath = FS.resolvePath(appPath, opts.cwd)
  const generatedAppPath = FS.resolvePath('_gen_tao-app/App.tsx', runtimePackageRoot)
  const generatedAppRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  const shipManifestPath = FS.resolvePath('ship.json', generatedAppRoot)
  const trace = opts.preview !== undefined && Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] === 'true'
  const requestedAt = trace ? performance.now() : 0
  return await serializeGeneration(generatedAppRoot, async () => {
    const startedAt = trace ? performance.now() : 0
    if (opts.preview === undefined) {
      previewOutputSnapshots.delete(generatedAppRoot)
      previewPublications.delete(generatedAppRoot)
    }
    Assert(
      opts.ship === undefined || opts.validationMode === 'release',
      'a ship manifest is generated only in release validation mode',
    )
    Assert(
      opts.ship === undefined || opts.preview === undefined,
      'a release ship manifest is not combined with a Studio preview publication',
    )
    Assert(
      opts.managedPublication === undefined || opts.validationMode !== 'release',
      'managed development identity is not included in a release publication',
    )
    const requesterRoot = await findProjectRoot(sourcePath)
    Assert.input(requesterRoot !== undefined, `No Tao project marker (.tao directory) was found for ${sourcePath}.`)
    const firebase = await readFirebaseConnections(requesterRoot)
    const firebaseConfiguration = firebase === undefined ? undefined : firebaseConfigurationSlots(firebase)
    const compileOptions = {
      appDatasourceConfiguration: opts.datasourceConfiguration,
      appFirebaseConfiguration: firebaseConfiguration,
      appAuthConfiguration: firebaseConfiguration,
      appName: opts.appName,
      emittedModuleCache: opts.emittedModuleCache,
      studioSourceEpochs: opts.preview?.sourceEpochs,
      // A Studio preview carries debugger gates so a breakpoint can pause it. Nothing else does:
      // an app built for a device or a test run compiles exactly as it did before.
      debug: opts.preview !== undefined,
      journeyObservations: opts.journeyObservations === true,
      studio: opts.preview !== undefined,
      validationMode: opts.validationMode,
    }
    const sourceRevision = opts.managedPublication === undefined
      ? undefined
      : await managedSourceRevision(opts.managedPublication.projectRoot)
    const preparedAt = trace ? performance.now() : 0
    const compiled = opts.preview === undefined
      ? await Workspace.compile(sourcePath, compileOptions)
      : await compileStudioPreview(sourcePath, opts.preview, compileOptions, opts.previewWorkspace)
    const compiledAt = trace ? performance.now() : 0
    let preview = opts.preview === undefined
      ? undefined
      : previewPublication(compiled.appNames, opts.appName, opts.preview)
    if (preview !== undefined) {
      assertPreviewCanPublish(generatedAppRoot, preview)
    }
    let compiledFiles = preview === undefined
      ? compiled.files
      : filesWithStablePreviewRoot(
        compiled.files,
        preview,
        opts.preview?.publicationChecks !== false,
        previewPublications.get(generatedAppRoot),
      )
    const previousOutput = previewOutputSnapshots.get(generatedAppRoot)
    const output = new Map(
      [
        ...compiledFiles,
        { relativePath: 'ManagedLoopIdentity.ts', code: 'export default null\n' },
      ].filter(file => file.relativePath !== studioPublicationPath)
        .map(file => [file.relativePath, file.code]),
    )
    const metadata = preview === undefined
      ? undefined
      : stableJson({
        appName: preview.appName,
        dependencyEnvironments: compiled.dependencyEnvironments,
        manifest: compiled.studioManifest,
        project: preview.project,
        publicationChecks: opts.preview!.publicationChecks !== false,
        sourceVersions: preview.sourceVersions,
      })
    const previewPublicationSkipped = opts.managedPublication === undefined
      && preview !== undefined && previousOutput !== undefined
      && metadata === previousOutput.metadata
      && previousOutput.files.size === output.size
      && [...output].every(([path, code]) => previousOutput.files.get(path) === code)
    if (previewPublicationSkipped) {
      preview = previewPublications.get(generatedAppRoot)!
      compiledFiles = filesWithStablePreviewRoot(
        compiled.files,
        preview,
        opts.preview?.publicationChecks !== false,
        preview,
      )
    }
    const compiledGeneratedFiles = opts.ship === undefined
      ? compiledFiles
      : [...compiledFiles, { relativePath: 'ship.json', code: `${JSON.stringify(opts.ship, null, 2)}\n` }]
    const publication = opts.managedPublication === undefined ? undefined : {
      ...opts.managedPublication,
      sourceRevision: sourceRevision!,
      compiledRevision: Platform.sha256Hex(JSON.stringify(compiledGeneratedFiles)),
      nonce: Platform.randomUUID(),
    }
    if (publication !== undefined) {
      Assert.input(
        sourceRevision === await managedSourceRevision(publication.projectRoot),
        'Managed app sources changed during compilation; retry compilation before attachment.',
      )
    }
    const generatedFiles = [...compiledGeneratedFiles, {
      relativePath: 'ManagedLoopIdentity.ts',
      code: `export default ${JSON.stringify(publication ?? null)}\n`,
    }]
    const metadataAt = trace ? performance.now() : 0
    await withGeneratedModuleLinks(
      generatedAppRoot,
      requesterRoot,
      compiled.dependencyEnvironments,
      async () => {
        await writeGeneratedFiles(
          generatedAppRoot,
          generatedFiles,
          preview === undefined ? undefined : studioPublicationPath,
          opts.publicationHooks,
        )
      },
      opts.moduleLinkRoot ?? requesterRoot,
      { preserveUnchangedLinks: preview !== undefined },
    )
    if (preview !== undefined) {
      previewPublications.set(generatedAppRoot, preview)
      previewOutputSnapshots.set(generatedAppRoot, {
        files: output,
        metadata: metadata!,
        attemptRevision: opts.preview!.revision,
      })
    }

    if (trace) {
      HCI.logProcessInfo(
        'runtime',
        JSON.stringify({
          type: 'studio-runtime-profile',
          revision: opts.preview!.revision,
          queueMs: startedAt - requestedAt,
          preparationMs: preparedAt - startedAt,
          compileMs: compiledAt - preparedAt,
          metadataMs: metadataAt - compiledAt,
          publicationMs: performance.now() - metadataAt,
        }),
      )
    }

    const generatedAppCode = generatedFiles.find(file => file.relativePath === 'App.tsx')?.code

    return {
      sourcePath,
      outputPath: generatedAppPath,
      code: generatedAppCode ?? compiled.code,
      ...(compiled.emittedModuleCache === undefined ? {} : { emittedModuleCache: compiled.emittedModuleCache }),
      ...(publication === undefined ? {} : { managedPublication: publication }),
      ...(opts.ship === undefined ? {} : { shipManifest: opts.ship, shipManifestPath }),
      ...(preview === undefined
        ? {}
        : {
          preview,
          previewRevision: preview.revision,
          previewPublicationSkipped,
          studioManifest: compiled.studioManifest,
        }),
    }
  })
}

function firebaseConfigurationSlots(connection: FirebaseConnection): Readonly<Record<string, string>> {
  return {
    ApiKey: connection.apiKey,
    ProjectId: connection.projectId,
    AppId: connection.appId,
    ...(connection.authDomain === undefined ? {} : { AuthDomain: connection.authDomain }),
    ...(connection.storageBucket === undefined ? {} : { StorageBucket: connection.storageBucket }),
    ...(connection.messagingSenderId === undefined ? {} : { MessagingSenderId: connection.messagingSenderId }),
  }
}

async function managedSourceRevision(projectRoot: string): Promise<string> {
  const files: Array<readonly [string, string]> = []
  for await (
    const path of FS.walk(projectRoot, {
      extensions: ['.tao'],
      excludeDirectory: name => name === 'node_modules' || name.startsWith('_gen_') || name.startsWith('.'),
    })
  ) {
    files.push([FS.relativePath(projectRoot, path), await FS.readText(path)])
  }
  files.sort(([left], [right]) => left.localeCompare(right))
  return Platform.sha256Hex(JSON.stringify(files))
}

async function compileStudioPreview(
  sourcePath: string,
  preview: GeneratePreviewOptions,
  options: Parameters<Workspace['compile']>[1],
  previewWorkspace?: Workspace,
): Promise<Awaited<ReturnType<Workspace['compile']>>> {
  const generatedEntries = Object.keys(preview.sourceVersions)
    .filter(path => /^@\/studio\/.*\.tao$/u.test(path))
    .map(path => FS.resolvePath(path, preview.project))
  if (!await FS.isDirectory(preview.project)) {
    Assert.input(
      Object.keys(preview.sourceOverrides ?? {}).length === 0,
      'Preview source overrides require an existing project directory.',
    )
    return await Workspace.compile(sourcePath, options)
  }
  const workspace = previewWorkspace !== undefined
    ? previewWorkspace
    : await Workspace.open(preview.project)
  Assert(workspace.root === FS.resolvePath(preview.project), 'preview workspace matches its project')
  // Each workspace load refreshes package topology; feed overrides replace one atomic source snapshot.
  await workspace.setSourceOverrides(preview.sourceOverrides ?? {})
  return await workspace.compileFiles(
    [sourcePath, ...generatedEntries],
    options,
    preview.experimentalChangedSourcePaths,
  )
}

/** resetStudioPreviewSession releases one output root for a new project/app revision stream. */
async function resetStudioPreviewSession(opts: { runtimePackageRoot?: string } = {}): Promise<void> {
  const runtimePackageRoot = opts.runtimePackageRoot ?? defaultRuntimePackageRoot()
  const generatedAppRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  await serializeGeneration(generatedAppRoot, async () => {
    previewOutputSnapshots.delete(generatedAppRoot)
    previewPublications.delete(generatedAppRoot)
  })
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(normalize)
    }
    if (typeof item === 'object' && item !== null) {
      return Object.fromEntries(
        Object.entries(item).sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalize(entry)]),
      )
    }
    return item
  }
  return JSON.stringify(normalize(value)) ?? 'undefined'
}

/** Runtime exposes Expo runtime app generation functions. */
const Runtime = {
  appNames,
  expoUpdateArtifacts,
  generateApp,
  proveReleaseBundle,
  resetStudioPreviewSession,
}

export default Runtime

/** appNames returns the declared app keys reachable from an entry file without generating output. */
async function appNames(appPath: string, opts: { cwd?: string } = {}): Promise<string[]> {
  const sourcePath = FS.resolvePath(appPath, opts.cwd)
  const parsed = await Workspace.parse(sourcePath)
  const entryApps = AST.appValueDeclarationsInFile(parsed.entry.ast).map(statement => statement.name)
  if (entryApps.length > 0) {
    return entryApps
  }
  return parsed.files.flatMap(file => AST.appValueDeclarationsInFile(file.ast).map(statement => statement.name))
}

function defaultRuntimePackageRoot(): string {
  return RuntimeToolchainPaths.packageRoot
}

/** serializeGeneration publishes one complete generated module graph at a time per output root. */
function serializeGeneration<ResultT>(outputRoot: string, generate: () => Promise<ResultT>): Promise<ResultT> {
  const previous = generationQueues.get(outputRoot) ?? Promise.resolve()
  const result = previous.then(generate)
  const completion = result.then(() => undefined, () => undefined)
  generationQueues.set(outputRoot, completion)
  void completion.then(() => {
    if (generationQueues.get(outputRoot) === completion) {
      generationQueues.delete(outputRoot)
    }
  })
  return result
}

async function writeGeneratedFiles(
  outputRoot: string,
  files: Array<{ relativePath: string; code: string }>,
  publishLast?: string,
  publicationHooks: Pick<FS.SynchronizeDirectoryFileSetsOptions, 'beforeMove' | 'beforeRemove'> = {},
): Promise<void> {
  if (publishLast !== undefined) {
    await publishGeneratedFiles(outputRoot, files, publishLast)
    return
  }
  const stagingRoot = await FS.mkTmpDir('tao-runtime-generate-')
  try {
    for (const file of files) {
      await writeGeneratedApp(FS.resolvePath(file.relativePath, stagingRoot), file.code)
    }
    await FS.mkdir(FS.dirname(outputRoot))
    await FS.synchronizeDirectoryFileSets([{ fromPath: stagingRoot, toPath: outputRoot }], {
      ...publicationHooks,
      boundaryPath: FS.dirname(outputRoot),
      lockPath: outputRoot,
      sourceBoundaryPath: stagingRoot,
    })
  } finally {
    await FS.remove(stagingRoot)
  }
}

type GeneratedFileChange = {
  previousCode?: string
  stagedPath: string
  targetPath: string
}

type RemovedGeneratedFile = {
  code: string
  path: string
}

/** publishGeneratedFiles stages changed stable modules and makes their publication marker visible last. */
async function publishGeneratedFiles(
  outputRoot: string,
  files: Array<{ relativePath: string; code: string }>,
  publishLast: string,
): Promise<void> {
  const publication = files.find(file => file.relativePath === publishLast)
  Assert.defined(publication, 'generated publication marker is present', { publishLast })
  const stableRoot = files.find(file => file.relativePath === 'App.tsx')
  Assert.defined(stableRoot, 'generated Studio preview root is present')
  const stableRootPath = FS.resolvePath(stableRoot.relativePath, outputRoot)
  const previousStableRoot = await readGeneratedCode(stableRootPath)
  const isStableRootMigration = previousStableRoot !== stableRoot.code
  const graphFiles = files.filter(file => file !== publication && file !== stableRoot)
  // During the one-time migration, leave the revision-addressed root live until all of its stable
  // replacements exist. Subsequent publications keep the unchanged root in place and publish the
  // identity marker last.
  const orderedFiles = !isStableRootMigration
    ? [...graphFiles, stableRoot, publication]
    : [...graphFiles, publication, stableRoot]
  const changes: GeneratedFileChange[] = []
  const staleFiles = await readStaleGeneratedFiles(outputRoot, new Set(files.map(file => file.relativePath)))
  try {
    for (const file of orderedFiles) {
      const targetPath = FS.resolvePath(file.relativePath, outputRoot)
      const previousCode = await readGeneratedCode(targetPath)
      if (previousCode === file.code) {
        continue
      }
      const stagedPath = `${targetPath}.tao-next`
      await FS.remove(stagedPath)
      await FS.writeText(stagedPath, file.code)
      changes.push({ previousCode, stagedPath, targetPath })
    }
    for (const change of changes) {
      await FS.move(change.stagedPath, change.targetPath)
    }
    for (const staleFile of staleFiles) {
      await FS.remove(staleFile.path)
    }
    await removeEmptyGeneratedDirectories(outputRoot)
  } catch (error) {
    await rollbackGeneratedFileChanges(changes, isStableRootMigration ? stableRootPath : undefined)
    for (const staleFile of staleFiles) {
      await writeGeneratedApp(staleFile.path, staleFile.code)
    }
    throw error
  } finally {
    for (const change of changes) {
      await FS.remove(change.stagedPath).catch(() => {})
    }
  }
  // These paths belong only to the retired revision publisher. They are outside the stable graph,
  // so a cleanup failure cannot invalidate the publication that just committed.
  for (const legacyPath of legacyPreviewPaths) {
    await FS.remove(FS.resolvePath(legacyPath, outputRoot)).catch(() => {})
  }
}

async function readGeneratedCode(path: string): Promise<string | undefined> {
  try {
    return await FS.readText(path)
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined
    }
    throw error
  }
}

async function rollbackGeneratedFileChanges(
  changes: readonly GeneratedFileChange[],
  migrationRootPath?: string,
): Promise<void> {
  // A steady-state rollback restores graph files before the publication marker. A migration must
  // first restore the retired App.tsx importer, whose revision-addressed graph remains untouched,
  // before removing its stable replacement graph.
  const orderedChanges = migrationRootPath === undefined
    ? changes
    : [
      ...changes.filter(change => change.targetPath === migrationRootPath),
      ...changes.filter(change => change.targetPath !== migrationRootPath),
    ]
  for (const change of orderedChanges) {
    if (await FS.exists(change.stagedPath)) {
      continue
    }
    if (change.previousCode === undefined) {
      await FS.remove(change.targetPath)
      continue
    }
    const rollbackPath = `${change.targetPath}.tao-rollback`
    await FS.writeText(rollbackPath, change.previousCode)
    await FS.move(rollbackPath, change.targetPath)
  }
}

async function readStaleGeneratedFiles(
  outputRoot: string,
  expectedPaths: ReadonlySet<string>,
): Promise<RemovedGeneratedFile[]> {
  if (!await FS.exists(outputRoot)) {
    return []
  }
  const staleFiles: RemovedGeneratedFile[] = []
  for await (const path of FS.walk(outputRoot)) {
    if (await FS.isSymbolicLink(path)) {
      continue
    }
    const relativePath = FS.relativePath(outputRoot, path)
    const legacy = legacyPreviewPaths.some(root => relativePath === root || relativePath.startsWith(`${root}/`))
    if (!expectedPaths.has(relativePath) && !legacy) {
      staleFiles.push({ code: await FS.readText(path), path })
    }
  }
  return staleFiles
}

function filesWithStablePreviewRoot(
  files: Array<{ relativePath: string; code: string }>,
  preview: StudioPreviewPublication,
  publicationChecks: boolean,
  previousPublication?: StudioPreviewPublication,
): Array<{ relativePath: string; code: string }> {
  // In the experiment, keep the initial marker (including its source versions) byte-for-byte
  // stable. The current identity and source versions travel in Studio's runtime update instead.
  const marker = publicationChecks ? preview : previousPublication ?? preview
  const publication = {
    appName: marker.appName,
    compileRevision: marker.revision,
    project: marker.project,
    sourceVersions: marker.sourceVersions,
  }
  return [
    {
      relativePath: 'App.tsx',
      code: stablePreviewRootSource(publicationChecks),
    },
    ...files.map(stablePreviewFile),
    {
      relativePath: 'TaoAppRefresh.tsx',
      code: `import TaoApp from './TaoApp'\n\nexport default function TaoAppRefresh() {\n  return <TaoApp />\n}\n`,
    },
    {
      relativePath: studioPublicationPath,
      code: `const TaoStudioPublication = ${
        JSON.stringify(publication)
      } as const\n\nexport default TaoStudioPublication\n`,
    },
  ]
}

/** stablePreviewFile gives the compiled app a stable path while reserving App.tsx for the Studio host. */
function stablePreviewFile(
  file: { relativePath: string; code: string },
): { relativePath: string; code: string } {
  if (file.relativePath === 'App.tsx') {
    return { ...file, relativePath: 'TaoApp.tsx' }
  }
  const appImport = relativeModuleImport(file.relativePath, 'App.tsx')
  const taoAppImport = relativeModuleImport(file.relativePath, 'TaoApp.tsx')
  return {
    relativePath: file.relativePath,
    code: file.code
      .replaceAll(`'${appImport}'`, `'${taoAppImport}'`)
      .replaceAll(`"${appImport}"`, `"${taoAppImport}"`),
  }
}

function relativeModuleImport(fromOutputPath: string, toOutputPath: string): string {
  const relative = FS.relativePath(FS.dirname(fromOutputPath), toOutputPath).replace(/\.(?:d\.ts|tsx?)$/, '')
  return relative.startsWith('.') ? relative : `./${relative}`
}

/**
 * The three failures below are emitted text, not this module's code: they land in the generated
 * app's `App.tsx` and run inside the Tao author's Expo bundle, whose only guaranteed Tao import is
 * `@runtime/TR`. They reach the error taxonomy through `TR.Errors`, which is the whole vocabulary a
 * compiled program can name. A rejected bootstrap response blames the Studio host serving it, while
 * a manifest missing the scenario or fixture the accepted cell names is an invariant the publication
 * revision check upstream should already have ruled out.
 */
function stablePreviewRootSource(publicationChecks: boolean): string {
  return `import React from 'react'
import TR from '@runtime/TR'
import TaoApp from './TaoAppRefresh'
import TaoStudioManifest from './TaoStudioManifest'
import TaoStudioPublication from './TaoStudioPublication'

const TaoStudioPublicationChecks = ${publicationChecks}

// React Native aliases \`window\` to its global, so only the platform says whether this is a browser.
const TaoStudioNativeDevice = require('react-native').Platform?.OS !== 'web'
const TaoStudioPreviewBootstrap = TaoStudioNativeDevice || typeof window === 'undefined'
  ? undefined
  : studioPreviewBootstrap(window.location.href)
const TaoStudioProtocolChannel = 'tao-studio'
const TaoStudioProtocolVersion = 1

export default function App() {
  return TaoStudioNativeDevice
    ? (
      <TR.Studio.DeviceHost
        App={TaoApp}
        cellRuntime={studioCellRuntime}
        manifest={TaoStudioManifest}
        publication={TaoStudioPublication}
      />
    )
    : <StudioBrowserApp />
}

function StudioBrowserApp() {
  // The generated app remains the live Fast Refresh family so safe source edits preserve its hook
  // state and appear immediately. Only the coupled manifest/cell runtime is held stale: those two
  // values must advance together, while the refreshed app is deliberately allowed to render against
  // the last accepted environment until its matching runtime arrives.
  const [appliedRuntime, setAppliedRuntime] = React.useState<any>()
  const [bootstrapError, setBootstrapError] = React.useState<unknown>()
  const [wholeAppPublication, setWholeAppPublication] = React.useState<any>()
  const wholeApp = React.useMemo(
    () => ({ cell: undefined, manifest: TaoStudioManifest, publication: wholeAppPublication ?? TaoStudioPublication }),
    [TaoStudioPublication.compileRevision, wholeAppPublication],
  )
  React.useEffect(() => {
    if (TaoStudioPublicationChecks) return
    setAppliedRuntime((previous: any) => previous === undefined || previous.manifest === TaoStudioManifest
      ? previous
      : { ...previous, manifest: TaoStudioManifest })
  }, [TaoStudioManifest])
  React.useEffect(() => {
    if (TaoStudioPreviewBootstrap?.cell !== true) return
    let cancelled = false
    setBootstrapError(undefined)
    TR.Studio.Diagnostics.record('publication', String(TaoStudioPublication.compileRevision))
    const bootstrapPath = TaoStudioPreviewBootstrap.sessionId === undefined
      ? '/api/preview/cell/bootstrap'
      : '/sessions/' + encodeURIComponent(TaoStudioPreviewBootstrap.sessionId) + '/api/preview/cell/bootstrap'
    const url = new URL(bootstrapPath, TaoStudioPreviewBootstrap.parentOrigin)
    url.searchParams.set('previewInstanceId', TaoStudioPreviewBootstrap.previewInstanceId)
    TR.Studio.Diagnostics.record('bootstrap-request', String(TaoStudioPublication.compileRevision))
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let olderAttempts = 0
    const load = async () => {
      const response = await fetch(url)
      if (!response.ok) TR.Errors.failHost('Tao Studio cell bootstrap was rejected (' + response.status + ').')
      const nextCell = await response.json()
      if (cancelled) return
      if (!TaoStudioPublicationChecks) {
        // The byte-stable marker keeps its first compile's source versions, so they travel with the
        // bootstrap's own revision. Fast Refresh re-runs this effect after a runtime update already
        // applied a revision, and an older response must not replace it.
        if (!validSourceVersions(nextCell.sourceVersions)) {
          TR.Errors.failHost('Tao Studio cell bootstrap did not carry its source versions.')
        }
        const next = {
          cell: nextCell,
          manifest: TaoStudioManifest,
          publication: {
            ...TaoStudioPublication,
            compileRevision: nextCell.identity.compileRevision,
            sourceVersions: nextCell.sourceVersions,
          },
        }
        setAppliedRuntime((previous: any) =>
          previous?.cell?.identity?.compileRevision > nextCell.identity.compileRevision ? previous : next
        )
        return
      }
      const outcome = TR.Studio.Bootstrap.reconcile(nextCell, TaoStudioPublication, newerRevision => {
        const retry = TR.Studio.Bootstrap.nextPublicationReload(window.location.href, newerRevision)
        if (retry === undefined) {
          TR.Errors.failHost('Tao Studio preview could not load publication revision ' + newerRevision + '.')
          return
        }
        TR.Studio.Diagnostics.record('publication-reload-scheduled', String(newerRevision)
          + '/' + String(retry.attempt))
        retryTimer = setTimeout(() => {
          if (!cancelled) window.location.replace(retry.url)
        }, Math.min(200 * retry.attempt, 1_000))
      })
      TR.Studio.Diagnostics.record('bootstrap-response', String(nextCell?.identity?.compileRevision)
        + '/' + String(nextCell?.identity?.cellRevision) + '/' + outcome)
      if (outcome === 'matched') {
        const cleanUrl = TR.Studio.Bootstrap.clearPublicationRetry(window.location.href)
        if (cleanUrl !== window.location.href) {
          window.history.replaceState(window.history.state, '', cleanUrl)
        }
        setAppliedRuntime({ cell: nextCell, manifest: TaoStudioManifest, publication: TaoStudioPublication })
      } else if (outcome === 'older') {
        const delayMs = TR.Studio.Bootstrap.olderRetryDelay(++olderAttempts)
        if (delayMs === undefined) {
          TR.Errors.failHost('Tao Studio cell bootstrap did not catch up to publication revision '
            + TaoStudioPublication.compileRevision + '.')
          return
        }
        TR.Studio.Diagnostics.record('bootstrap-retry-server', String(TaoStudioPublication.compileRevision))
        retryTimer = setTimeout(() => { void load().catch(fail) }, delayMs)
      } else if (outcome === 'incompatible') {
        TR.Errors.failHost('Tao Studio cell bootstrap did not match this preview.')
      }
    }
    const fail = (error: unknown) => {
      TR.Studio.Diagnostics.record('bootstrap-error', String(error))
      if (!cancelled) setBootstrapError(error)
    }
    void load().catch(fail)
    return () => {
      cancelled = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      TR.Studio.Diagnostics.record('bootstrap-superseded', String(TaoStudioPublication.compileRevision))
    }
  }, [TaoStudioPublication.compileRevision])
  React.useEffect(() => {
    if (TaoStudioPreviewBootstrap === undefined || typeof window === 'undefined') return
    const receiveRuntime = (event: MessageEvent) => {
      if (
        !TaoStudioPublicationChecks
        && event.origin === TaoStudioPreviewBootstrap.parentOrigin
        && event.source === window.parent
        && isWholeAppPublicationUpdate(event.data, TaoStudioPreviewBootstrap, TaoStudioPublication)
      ) {
        setWholeAppPublication({
          ...TaoStudioPublication,
          compileRevision: event.data.compileRevision,
          sourceVersions: event.data.sourceVersions,
        })
        return
      }
      if (TaoStudioPreviewBootstrap.cell !== true) return
      if (
        event.origin !== TaoStudioPreviewBootstrap.parentOrigin
        || event.source !== window.parent
        || !isRuntimeUpdate(event.data, TaoStudioPreviewBootstrap, TaoStudioPublication)
      ) return
      setBootstrapError(undefined)
      TR.Studio.Diagnostics.record('runtime-update', String(event.data.runtime.identity?.compileRevision)
        + '/' + String(event.data.runtime.identity?.cellRevision))
      const next = {
        cell: event.data.runtime,
        manifest: TaoStudioManifest,
        publication: TaoStudioPublicationChecks ? TaoStudioPublication : {
          ...TaoStudioPublication,
          compileRevision: event.data.runtime.identity.compileRevision,
          sourceVersions: event.data.sourceVersions,
        },
      }
      // Avoid repeating publication/bridge effects for an already applied identity. The cell's
      // provider lifetime below is separate: source-only publications preserve its runtime state.
      setAppliedRuntime((previous: any) => sameRuntimeIdentity(previous, next) ? previous : next)
    }
    window.addEventListener('message', receiveRuntime)
    return () => window.removeEventListener('message', receiveRuntime)
  }, [TaoStudioPublication])
  const active = TaoStudioPreviewBootstrap?.cell === true ? appliedRuntime : wholeApp
  const waitingForInitialCell = TaoStudioPreviewBootstrap?.cell === true && active === undefined
  // Memoized for the same reason as the cell runtime below: this object is a prop, and
  // PreviewBridge keys an effect on it. A fresh literal every render re-mounts the Studio bridge
  // every render.
  const TaoStudioPreviewConfig = React.useMemo(
    () =>
      TaoStudioPreviewBootstrap === undefined || active === undefined ? undefined : {
        ...TaoStudioPreviewBootstrap,
        ...(active.cell?.identity ?? {}),
        ...active.publication,
        publicationChecks: TaoStudioPublicationChecks,
      },
    [active],
  )
  if (waitingForInitialCell) {
    return bootstrapError === undefined
      ? <TR.Studio.Pending />
      : <TR.Studio.Failure error={bootstrapError} />
  }
  if (TaoStudioPreviewConfig === undefined) {
    return <TaoApp />
  }
  return (
    <TR.Studio.ErrorBoundary resetKey={[
      TaoStudioPreviewConfig.compileRevision,
      TaoStudioPreviewConfig.cellRevision,
      TaoStudioPreviewConfig.manifestRevision,
      TaoStudioPreviewConfig.previewInstanceId,
    ].join(':')}>
      <StudioPreviewContent
        cell={active.cell}
        config={TaoStudioPreviewConfig}
        manifest={active.manifest}
      />
    </TR.Studio.ErrorBoundary>
  )
}

function StudioPreviewContent({ cell, config, manifest }: any) {
  // Each compile delivers a new config, which re-renders this root. One app element for the mounted
  // lifetime lets React skip the app below it; Fast Refresh still re-renders the views it changed, and
  // the Lens wrappers, which read the config's publisher, still report the new source versions.
  const [TaoAppElement] = React.useState(() => <TaoApp />)
  React.useEffect(() => {
    const environment = cell?.cell?.environment
    if (environment === undefined) return
    return TR.Capture.register({
      capture: () => environment,
      domain: 'environment',
      version: 1,
    })
  }, [cell])
  if (cell === undefined) {
    return <TR.Studio.PreviewBridge config={config}>{TaoAppElement}</TR.Studio.PreviewBridge>
  }
  // This resolved contract is plain wire data. A changed fixture, environment, replay, subject,
  // or explicit cell revision remounts providers and fixture owners together. Authored journey
  // prefixes replay per publication, so those cells must also start from their fixture again;
  // cells without a prefix retain interactive state across source-only publications.
  const resolvedCell = studioCellRuntime(cell, manifest)
  const cellContract = JSON.stringify(resolvedCell)
  const replayPublication = resolvedCell.scenario.steps?.length
    ? [config.compileRevision, config.manifestRevision, config.previewInstanceId]
    : undefined
  const cellKey = JSON.stringify([cell.identity.cellId, cell.identity.cellRevision, cellContract, replayPublication])
  return <StudioPreviewCellContent key={cellKey} cellContract={cellContract} config={config} />
}

function StudioPreviewCellContent({ cellContract, config }: any) {
  // State survives Fast Refresh; useMemo may recompute even with unchanged dependencies. The key
  // above owns replacement, so this provider contract keeps one object for its mounted lifetime.
  const [TaoStudioCell] = React.useState(() => JSON.parse(cellContract))
  const [TaoAppElement] = React.useState(() => <TaoApp />)
  return (
    <TR.Studio.ReplayHost replay={TaoStudioCell.replay}>
      <TR.Studio.Environment.Host cell={TaoStudioCell}>
        <TR.Studio.PreviewBridge config={config}>{TaoAppElement}</TR.Studio.PreviewBridge>
      </TR.Studio.Environment.Host>
    </TR.Studio.ReplayHost>
  )
}

function studioCellRuntime(runtime: any, manifest: any) {
  const scenario = manifest.scenarios.find((candidate: any) => candidate.id === runtime.cell.scenarioId)
  if (scenario === undefined) TR.Errors.failInvariant('Tao Studio scenario bootstrap is stale.')
  const fixture = scenario.fixtureId === undefined
    ? { accounts: [], creates: [] }
    : manifest.fixtures.find((candidate: any) => candidate.id === scenario.fixtureId)
  if (fixture === undefined) TR.Errors.failInvariant('Tao Studio fixture bootstrap is stale.')
  const dataState = runtime.resolvedState?.snapshot?.domains?.data?.value
  const replayScheme = runtime.replay?.domains?.find((domain: any) => domain?.domain === 'scheme')?.value
  const network = runtime.cell.environment.network
  // A scenario's authored appearance outranks the cell's scheme, unless the cell was reconfigured to
  // an explicit preference: Studio's own control is read-only for an authored scenario, so only a
  // session-only override, such as a QA capture's appearance pass, sets one.
  const cellScheme = runtime.cell.environment.scheme
  const authored = cellScheme.source === 'preference' ? undefined : scenario.environment?.appearance
  return {
    replay: runtime.replay,
    environment: {
      network: {
        mode: network.outcome === 'offline' ? 'offline' : 'online',
        latencyMs: network.latencyMs,
        ...(network.outcome === 'error'
          ? { failures: [{ message: network.error?.message ?? 'Tao Studio injected network failure.' }] }
          : {}),
      },
      scheme: {
        requested: authored ?? cellScheme.requested,
        ...(replayScheme === undefined ? {} : { replay: replayScheme }),
        source: authored !== undefined
          ? 'scenario'
          : cellScheme.requested === 'system'
          ? 'system'
          : 'preference',
      },
      version: 1,
    },
    fixture: { accounts: fixture.accounts, creates: fixture.creates, signedIn: fixture.signedIn },
    scenario: {
      arguments: runtime.cell.args,
      kind: scenario.subject.kind,
      prepare: scenario.prepare,
      steps: scenario.steps,
      subjectId: scenario.subject.subjectId,
    },
    ...(dataState === undefined ? {} : { seed: dataState }),
  } as any
}

function isRuntimeUpdate(value: any, bootstrap: any, publication: any) {
  const identity = value?.identity
  const runtimeIdentity = value?.runtime?.identity
  return value?.channel === TaoStudioProtocolChannel
    && value?.protocolVersion === TaoStudioProtocolVersion
    && value?.type === 'preview-runtime-update'
    && identity?.previewInstanceId === bootstrap.previewInstanceId
    && identity?.appName === publication.appName
    && (!TaoStudioPublicationChecks || identity?.compileRevision === publication.compileRevision)
    && identity?.project === publication.project
    && (TaoStudioPublicationChecks || validSourceVersions(value?.sourceVersions))
    && runtimeIdentity?.appName === identity.appName
    && runtimeIdentity?.cellId === identity.cellId
    && runtimeIdentity?.cellRevision === identity.cellRevision
    && runtimeIdentity?.compileRevision === identity.compileRevision
    && runtimeIdentity?.manifestRevision === identity.manifestRevision
    && runtimeIdentity?.project === identity.project
}

function isWholeAppPublicationUpdate(value: any, bootstrap: any, publication: any) {
  return value?.channel === TaoStudioProtocolChannel
    && value?.protocolVersion === TaoStudioProtocolVersion
    && value?.type === 'preview-publication-update'
    && value?.previewInstanceId === bootstrap.previewInstanceId
    && value?.appName === publication.appName
    && value?.project === publication.project
    && Number.isSafeInteger(value?.compileRevision)
    && value.compileRevision >= 0
    && validSourceVersions(value?.sourceVersions)
}

function validSourceVersions(value: any) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([path, version]) => path.length > 0 && typeof version === 'string'
      && version.length > 0)
}

/**
 * sameRuntimeIdentity compares the publication values \`TR.Studio.ErrorBoundary resetKey\` observes:
 * compileRevision, cellRevision, and manifestRevision. previewInstanceId is the fourth resetKey
 * value but is not part of either side here — \`isRuntimeUpdate\` already requires it to equal this
 * tab's fixed bootstrap value before a message reaches this comparison, so it cannot discriminate.
 */
function sameRuntimeIdentity(previous: any, next: any) {
  const previousIdentity = previous?.cell?.identity
  const nextIdentity = next?.cell?.identity
  return previousIdentity !== undefined
    && nextIdentity !== undefined
    && previousIdentity.compileRevision === nextIdentity.compileRevision
    && previousIdentity.cellRevision === nextIdentity.cellRevision
    && previousIdentity.manifestRevision === nextIdentity.manifestRevision
}

function studioPreviewBootstrap(href: string) {
  const params = new URL(href).searchParams
  const parentOrigin = params.get('taoStudioParentOrigin')
  const previewInstanceId = params.get('taoStudioPreviewInstanceId')
  const requestedSessionId = params.get('taoStudioSessionId')
  const sessionId = requestedSessionId !== null && /^[A-Za-z0-9_-]{1,128}$/.test(requestedSessionId)
    ? requestedSessionId
    : undefined
  return parentOrigin === null || previewInstanceId === null
    ? undefined
    : { cell: params.get('taoStudioCell') === '1', parentOrigin, previewInstanceId, sessionId }
}
`
}

function previewPublication(
  appNames: readonly string[],
  selectedAppName: string | undefined,
  preview: GeneratePreviewOptions,
): StudioPreviewPublication {
  Assert(preview.project.trim().length > 0, 'Studio preview project identity is not empty')
  Assert(
    Number.isSafeInteger(preview.revision) && preview.revision >= 0,
    'Studio preview revision is a non-negative safe integer',
    { revision: preview.revision },
  )
  const appName = selectedAppName ?? appNames[0]
  Assert.defined(appName, 'compiled Studio preview has a selected app')
  return {
    appName,
    project: preview.project,
    revision: preview.revision,
    sourceVersions: canonicalSourceVersions(preview.sourceVersions, preview.project),
  }
}

function assertPreviewCanPublish(outputRoot: string, next: StudioPreviewPublication): void {
  const current = previewPublications.get(outputRoot)
  if (!current) {
    return
  }
  Assert(
    current.project === next.project && current.appName === next.appName,
    'Studio preview output root retains its project and app identity until reset',
    { current, next, outputRoot },
  )
  Assert(
    next.revision > (previewOutputSnapshots.get(outputRoot)?.attemptRevision ?? current.revision),
    'Studio preview revision increases monotonically',
    { current, next, outputRoot },
  )
}

function canonicalSourceVersions(
  sourceVersions: Readonly<Record<string, string>>,
  project: string,
): Readonly<Record<string, string>> {
  const canonical: Record<string, string> = {}
  for (const [path, version] of Object.entries(sourceVersions).sort(([left], [right]) => left.localeCompare(right))) {
    Assert(path.trim().length > 0 && version.trim().length > 0, 'Studio preview source versions are not empty', {
      path,
      version,
    })
    canonical[FS.resolvePath(path, project)] = version
  }
  return canonical
}

async function removeEmptyGeneratedDirectories(outputRoot: string): Promise<void> {
  if (!await FS.exists(outputRoot)) {
    return
  }
  const directories: string[] = []
  for await (const path of FS.walk(outputRoot, { includeDirectories: true })) {
    if (await FS.isDirectory(path)) {
      directories.push(path)
    }
  }
  for (const path of directories.sort((left, right) => right.length - left.length)) {
    if (await FS.isEmptyDirectory(path)) {
      await FS.remove(path)
    }
  }
}

async function writeGeneratedApp(path: string, code: string): Promise<void> {
  try {
    if (await FS.readText(path) === code) {
      return
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error
    }
  }
  await FS.writeText(path, code)
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

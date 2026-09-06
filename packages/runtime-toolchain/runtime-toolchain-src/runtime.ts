import { AST } from '@parser'
import { Assert, FS } from '@shared'
import { Workspace } from '@workspace'
import { proveReleaseBundle } from './release-bundle-proof'
import { RuntimeToolchainPaths } from './runtime-toolchain-paths'

export { proveReleaseBundle, type ReleaseBundleProof } from './release-bundle-proof'
export { RuntimeToolchainPaths } from './runtime-toolchain-paths'

export type GeneratePreviewOptions = {
  project: string
  revision: number
  sourceVersions: Readonly<Record<string, string>>
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
  preview?: GeneratePreviewOptions
  runtimePackageRoot?: string
  ship?: ShipManifest
  validationMode?: 'development' | 'release'
}

export type ShipUpdatesConfig = {
  channel: string
  runtimeFingerprint: string
  runtimeVersion: { policy: 'fingerprint' }
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
    services: ReadonlyArray<'CloudDocuments' | 'CloudKit'>
  }
  ios: {
    usesNonExemptEncryption: false
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
  shipManifest?: ShipManifest
  shipManifestPath?: string
  studioManifest?: NonNullable<Awaited<ReturnType<typeof Workspace.compile>>['studioManifest']>
}

const generationQueues = new Map<string, Promise<void>>()
const previewPublications = new Map<string, StudioPreviewPublication>()

/**
 * previewInspectionLink is the stable path a human opens to read the generated graph. It points at
 * the newest revision root instead of duplicating it, and stays out of every import: no generated
 * module resolves through it, so Metro and the bundlers only ever see one copy of each module.
 */
const previewInspectionLink = 'current'

/** generateApp generates the runtime app module from a Tao app file. */
async function generateApp(appPath: string, opts: GenerateAppOptions = {}): Promise<GeneratedApp> {
  const runtimePackageRoot = opts.runtimePackageRoot ?? defaultRuntimePackageRoot()
  const sourcePath = FS.resolvePath(appPath, opts.cwd)
  const generatedAppPath = FS.resolvePath('_gen_tao-app/App.tsx', runtimePackageRoot)
  const generatedAppRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  const shipManifestPath = FS.resolvePath('ship.json', generatedAppRoot)
  return await serializeGeneration(generatedAppRoot, async () => {
    Assert(
      opts.ship === undefined || opts.validationMode === 'release',
      'a ship manifest is generated only in release validation mode',
    )
    Assert(
      opts.ship === undefined || opts.preview === undefined,
      'a release ship manifest is not combined with a Studio preview publication',
    )
    const compileOptions = {
      appDatasourceConfiguration: opts.datasourceConfiguration,
      appName: opts.appName,
      studio: opts.preview !== undefined,
      validationMode: opts.validationMode,
    }
    const compiled = opts.preview === undefined
      ? await Workspace.compile(sourcePath, compileOptions)
      : await compileStudioPreview(sourcePath, opts.preview, compileOptions)
    const preview = opts.preview === undefined
      ? undefined
      : previewPublication(compiled.appNames, opts.appName, opts.preview)
    if (preview !== undefined) {
      assertPreviewCanPublish(generatedAppRoot, preview)
    }
    const compiledFiles = preview === undefined
      ? compiled.files
      : filesWithStablePreviewRoot(compiled.files, preview)
    const generatedFiles = opts.ship === undefined
      ? compiledFiles
      : [...compiledFiles, { relativePath: 'ship.json', code: `${JSON.stringify(opts.ship, null, 2)}\n` }]
    const previousPreview = preview === undefined ? undefined : previewPublications.get(generatedAppRoot)

    await writeGeneratedFiles(
      generatedAppRoot,
      generatedFiles,
      preview === undefined ? undefined : 'TaoStudioActivePreview.ts',
      preview === undefined ? [] : [
        previewInspectionLink,
        ...(previousPreview === undefined ? [] : [previewRevisionRoot(previousPreview.revision)]),
      ],
    )
    if (preview === undefined) {
      previewPublications.delete(generatedAppRoot)
    } else {
      previewPublications.set(generatedAppRoot, preview)
      await linkNewestPreviewRevision(generatedAppRoot, previewRevisionRoot(preview.revision))
    }

    const generatedAppCode = generatedFiles.find(file => file.relativePath === 'App.tsx')?.code

    return {
      sourcePath,
      outputPath: generatedAppPath,
      code: generatedAppCode ?? compiled.code,
      ...(opts.ship === undefined ? {} : { shipManifest: opts.ship, shipManifestPath }),
      ...(preview === undefined
        ? {}
        : {
          preview,
          previewRevision: preview.revision,
          studioManifest: compiled.studioManifest,
        }),
    }
  })
}

async function compileStudioPreview(
  sourcePath: string,
  preview: GeneratePreviewOptions,
  options: Parameters<Workspace['compile']>[1],
): Promise<Awaited<ReturnType<Workspace['compile']>>> {
  const generatedEntries = Object.keys(preview.sourceVersions)
    .filter(path => /^@\/studio\/.*\.tao$/u.test(path))
    .map(path => FS.resolvePath(path, preview.project))
  if (generatedEntries.length === 0) {
    return await Workspace.compile(sourcePath, options)
  }
  const workspace = await Workspace.open(preview.project)
  return await workspace.compileFiles([sourcePath, ...generatedEntries], options)
}

/** resetStudioPreviewSession releases one output root for a new project/app revision stream. */
async function resetStudioPreviewSession(opts: { runtimePackageRoot?: string } = {}): Promise<void> {
  const runtimePackageRoot = opts.runtimePackageRoot ?? defaultRuntimePackageRoot()
  const generatedAppRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  await serializeGeneration(generatedAppRoot, async () => {
    previewPublications.delete(generatedAppRoot)
  })
}

/** Runtime exposes Expo runtime app generation functions. */
const Runtime = {
  appNames,
  generateApp,
  proveReleaseBundle,
  resetStudioPreviewSession,
}

export default Runtime

/** appNames returns the declared app keys in an entry file without generating output. */
async function appNames(appPath: string, opts: { cwd?: string } = {}): Promise<string[]> {
  const sourcePath = FS.resolvePath(appPath, opts.cwd)
  const parsed = await Workspace.parse(sourcePath)
  return AST.appValueDeclarationsInFile(parsed.entry.ast).map(statement => statement.name)
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
  preserveRoots: readonly string[] = [],
): Promise<void> {
  const publication = publishLast === undefined
    ? undefined
    : files.find(file => file.relativePath === publishLast)
  Assert(
    publishLast === undefined || publication !== undefined,
    'generated publication marker is present',
    { publishLast },
  )
  for (const file of files) {
    if (file === publication) {
      continue
    }
    await writeGeneratedApp(FS.resolvePath(file.relativePath, outputRoot), file.code)
  }
  if (publication !== undefined) {
    await publishGeneratedApp(FS.resolvePath(publication.relativePath, outputRoot), publication.code)
  }
  await removeStaleGeneratedFiles(outputRoot, new Set(files.map(file => file.relativePath)), preserveRoots)
  await removeEmptyGeneratedDirectories(outputRoot)
}

function filesWithStablePreviewRoot(
  files: Array<{ relativePath: string; code: string }>,
  preview: StudioPreviewPublication,
): Array<{ relativePath: string; code: string }> {
  const revisionRoot = previewRevisionRoot(preview.revision)
  return [
    {
      relativePath: 'App.tsx',
      code: stablePreviewRootSource(),
    },
    {
      relativePath: 'TaoStudioRevision.ts',
      code: `const TaoStudioRevision = ${
        JSON.stringify({
          compileRevision: preview.revision,
          sourceVersions: preview.sourceVersions,
        })
      } as const\n\nexport default TaoStudioRevision\n`,
    },
    {
      relativePath: 'TaoStudioProject.ts',
      code: `const TaoStudioProject = ${
        JSON.stringify({
          appName: preview.appName,
          project: preview.project,
        })
      } as const\n\nexport default TaoStudioProject\n`,
    },
    ...files.map(file => previewRevisionFile(file, revisionRoot)),
    {
      relativePath: 'TaoStudioActivePreview.ts',
      code: activePreviewSource(revisionRoot, preview),
    },
  ]
}

function previewRevisionRoot(revision: number): string {
  return `revisions/revision-${revision}`
}

/** previewRevisionFile places one compiled module in its revision root, freeing App.tsx for the stable preview root. */
function previewRevisionFile(
  file: { relativePath: string; code: string },
  revisionRoot: string,
): { relativePath: string; code: string } {
  if (file.relativePath === 'App.tsx') {
    return { ...file, relativePath: `${revisionRoot}/TaoApp.tsx` }
  }
  const appImport = relativeModuleImport(file.relativePath, 'App.tsx')
  const taoAppImport = relativeModuleImport(file.relativePath, 'TaoApp.tsx')
  return {
    relativePath: `${revisionRoot}/${file.relativePath}`,
    code: file.code
      .replaceAll(`'${appImport}'`, `'${taoAppImport}'`)
      .replaceAll(`"${appImport}"`, `"${taoAppImport}"`),
  }
}

/**
 * linkNewestPreviewRevision repoints the stable inspection path at the revision root just published.
 * A staged rename replaces the existing link in place, so an inspector never catches it missing, and
 * a filesystem that refuses symlinks degrades to a one-line pointer file at the same path.
 */
async function linkNewestPreviewRevision(outputRoot: string, revisionRoot: string): Promise<void> {
  const linkPath = FS.resolvePath(previewInspectionLink, outputRoot)
  const stagedPath = `${linkPath}.next`
  await FS.remove(stagedPath)
  try {
    await FS.symlink(FS.joinPath(revisionRoot), stagedPath)
  } catch {
    await FS.writeText(stagedPath, `${revisionRoot}\n`)
  }
  try {
    await FS.move(stagedPath, linkPath)
  } catch {
    // Only a real directory left at the stable path blocks the rename; the generator owns that path.
    await FS.remove(linkPath)
    await FS.move(stagedPath, linkPath)
  }
}

function activePreviewSource(revisionRoot: string, preview: StudioPreviewPublication): string {
  const publication = {
    appName: preview.appName,
    compileRevision: preview.revision,
    project: preview.project,
    sourceVersions: preview.sourceVersions,
  }
  return `import TaoApp from './${revisionRoot}/TaoApp'
import TaoStudioManifest from './${revisionRoot}/TaoStudioManifest'

const TaoStudioPublication = ${JSON.stringify(publication)} as const

export { TaoApp, TaoStudioManifest, TaoStudioPublication }
`
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
function stablePreviewRootSource(): string {
  return `import React from 'react'
import TR from '@runtime/TR'
import { TaoApp, TaoStudioManifest, TaoStudioPublication } from './TaoStudioActivePreview'

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
  const [cell, setCell] = React.useState<any>()
  const [bootstrapError, setBootstrapError] = React.useState<unknown>()
  React.useEffect(() => {
    if (TaoStudioPreviewBootstrap?.cell !== true) return
    let cancelled = false
    setBootstrapError(undefined)
    const bootstrapPath = TaoStudioPreviewBootstrap.sessionId === undefined
      ? '/api/preview/cell/bootstrap'
      : '/sessions/' + encodeURIComponent(TaoStudioPreviewBootstrap.sessionId) + '/api/preview/cell/bootstrap'
    const url = new URL(bootstrapPath, TaoStudioPreviewBootstrap.parentOrigin)
    url.searchParams.set('previewInstanceId', TaoStudioPreviewBootstrap.previewInstanceId)
    void fetch(url).then(async response => {
      if (!response.ok) TR.Errors.failHost('Tao Studio cell bootstrap was rejected (' + response.status + ').')
      const nextCell = await response.json()
      if (!cancelled && runtimeMatchesPublication(nextCell, TaoStudioPublication)) setCell(nextCell)
    }).catch(error => {
      if (!cancelled) setBootstrapError(error)
    })
    return () => { cancelled = true }
  }, [TaoStudioPublication.compileRevision])
  React.useEffect(() => {
    if (TaoStudioPreviewBootstrap?.cell !== true || typeof window === 'undefined') return
    const receiveRuntime = (event: MessageEvent) => {
      if (
        event.origin !== TaoStudioPreviewBootstrap.parentOrigin
        || event.source !== window.parent
        || !isRuntimeUpdate(event.data, TaoStudioPreviewBootstrap, TaoStudioPublication)
      ) return
      setBootstrapError(undefined)
      setCell(event.data.runtime)
    }
    window.addEventListener('message', receiveRuntime)
    return () => window.removeEventListener('message', receiveRuntime)
  }, [TaoStudioPublication])
  const waitingForCell = TaoStudioPreviewBootstrap?.cell === true
    && !runtimeMatchesPublication(cell, TaoStudioPublication)
  // Memoized for the same reason as the cell runtime below: this object is a prop, and
  // PreviewBridge keys an effect on it. A fresh literal every render re-mounts the Studio bridge
  // every render.
  const TaoStudioPreviewConfig = React.useMemo(
    () =>
      TaoStudioPreviewBootstrap === undefined || waitingForCell ? undefined : {
        ...TaoStudioPreviewBootstrap,
        ...(cell?.identity ?? {}),
        ...TaoStudioPublication,
      },
    [cell, waitingForCell],
  )
  if (waitingForCell) {
    return bootstrapError === undefined
      ? <TR.Studio.Pending />
      : <TR.Studio.Failure error={bootstrapError} />
  }
  if (TaoStudioPreviewConfig === undefined) {
    return <TaoApp />
  }
  return (
    <TR.Studio.ErrorBoundary key={[
      TaoStudioPreviewConfig.compileRevision,
      TaoStudioPreviewConfig.cellRevision,
      TaoStudioPreviewConfig.manifestRevision,
      TaoStudioPreviewConfig.previewInstanceId,
    ].join(':')}>
      <StudioPreviewContent cell={cell} config={TaoStudioPreviewConfig} />
    </TR.Studio.ErrorBoundary>
  )
}

function StudioPreviewContent({ cell, config }: any) {
  React.useEffect(() => {
    const environment = cell?.cell?.environment
    if (environment === undefined) return
    return TR.Capture.register({
      capture: () => environment,
      domain: 'environment',
      version: 1,
    })
  }, [cell])
  // Memoized because everything below reads it as a prop: rebuilding it every render hands each of
  // them a new object every render, and an effect keyed on one of those restarts forever. The native
  // device host memoizes the same call for the same reason.
  const TaoStudioCell = React.useMemo(
    () => cell === undefined ? undefined : studioCellRuntime(cell, TaoStudioManifest),
    [cell],
  )
  return (
    TaoStudioCell === undefined
      ? <TR.Studio.PreviewBridge config={config}><TaoApp /></TR.Studio.PreviewBridge>
      : <TR.Studio.ReplayHost replay={TaoStudioCell.replay}>
          <TR.Studio.Environment.Host cell={TaoStudioCell}>
            <TR.Studio.PreviewBridge config={config}><TaoApp /></TR.Studio.PreviewBridge>
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
        requested: scenario.environment?.appearance ?? runtime.cell.environment.scheme.requested,
        ...(replayScheme === undefined ? {} : { replay: replayScheme }),
        source: scenario.environment?.appearance !== undefined
          ? 'scenario'
          : runtime.cell.environment.scheme.requested === 'system'
          ? 'system'
          : 'preference',
      },
      version: 1,
    },
    fixture: { accounts: fixture.accounts, creates: fixture.creates },
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

function runtimeMatchesPublication(runtime: any, publication: any) {
  const identity = runtime?.identity
  return identity?.appName === publication.appName
    && identity?.compileRevision === publication.compileRevision
    && identity?.project === publication.project
}

function isRuntimeUpdate(value: any, bootstrap: any, publication: any) {
  const identity = value?.identity
  const runtimeIdentity = value?.runtime?.identity
  return value?.channel === TaoStudioProtocolChannel
    && value?.protocolVersion === TaoStudioProtocolVersion
    && value?.type === 'preview-runtime-update'
    && identity?.previewInstanceId === bootstrap.previewInstanceId
    && identity?.appName === publication.appName
    && identity?.compileRevision === publication.compileRevision
    && identity?.project === publication.project
    && runtimeIdentity?.appName === identity.appName
    && runtimeIdentity?.cellId === identity.cellId
    && runtimeIdentity?.cellRevision === identity.cellRevision
    && runtimeIdentity?.compileRevision === identity.compileRevision
    && runtimeIdentity?.manifestRevision === identity.manifestRevision
    && runtimeIdentity?.project === identity.project
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
    next.revision > current.revision,
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

async function removeStaleGeneratedFiles(
  outputRoot: string,
  currentRelativePaths: ReadonlySet<string>,
  preserveRoots: readonly string[] = [],
): Promise<void> {
  if (!await FS.exists(outputRoot)) {
    return
  }
  for await (const path of FS.walk(outputRoot)) {
    const relativePath = FS.relativePath(outputRoot, path)
    const preserved = preserveRoots.some(root => relativePath === root || relativePath.startsWith(`${root}/`))
    if (!currentRelativePaths.has(relativePath) && !preserved) {
      await FS.remove(path)
    }
  }
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

/** publishGeneratedApp atomically switches the one module that makes a complete revision live. */
async function publishGeneratedApp(path: string, code: string): Promise<void> {
  try {
    if (await FS.readText(path) === code) {
      return
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error
    }
  }
  const nextPath = `${path}.next`
  await FS.writeText(nextPath, code)
  await FS.move(nextPath, path)
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

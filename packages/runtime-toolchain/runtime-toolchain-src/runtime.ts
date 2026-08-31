import { AST } from '@parser'
import { Assert, FS } from '@shared'
import { Workspace } from '@workspace'
import { RuntimeToolchainPaths } from './runtime-toolchain-paths'

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
  preview?: GeneratePreviewOptions
  runtimePackageRoot?: string
  validationMode?: 'development' | 'release'
}

export type GeneratedApp = {
  sourcePath: string
  outputPath: string
  code: string
  preview?: StudioPreviewPublication
  previewRevision?: number
  studioManifest?: NonNullable<Awaited<ReturnType<typeof Workspace.compile>>['studioManifest']>
}

const generationQueues = new Map<string, Promise<void>>()
const previewPublications = new Map<string, StudioPreviewPublication>()

/** generateApp generates the runtime app module from a Tao app file. */
async function generateApp(appPath: string, opts: GenerateAppOptions = {}): Promise<GeneratedApp> {
  const runtimePackageRoot = opts.runtimePackageRoot ?? defaultRuntimePackageRoot()
  const sourcePath = FS.resolvePath(appPath, opts.cwd)
  const generatedAppPath = FS.resolvePath('_gen_tao-app/App.tsx', runtimePackageRoot)
  const generatedAppRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  return await serializeGeneration(generatedAppRoot, async () => {
    const compiled = await Workspace.compile(sourcePath, {
      appName: opts.appName,
      studio: opts.preview !== undefined,
      validationMode: opts.validationMode,
    })
    const preview = opts.preview === undefined
      ? undefined
      : previewPublication(compiled.appNames, opts.appName, opts.preview)
    if (preview !== undefined) {
      assertPreviewCanPublish(generatedAppRoot, preview)
    }
    const generatedFiles = preview === undefined
      ? compiled.files
      : filesWithStablePreviewRoot(compiled.files, preview)

    await writeGeneratedFiles(generatedAppRoot, generatedFiles)
    if (preview === undefined) {
      previewPublications.delete(generatedAppRoot)
    } else {
      previewPublications.set(generatedAppRoot, preview)
    }

    const generatedAppCode = generatedFiles.find(file => file.relativePath === 'App.tsx')?.code

    return {
      sourcePath,
      outputPath: generatedAppPath,
      code: generatedAppCode ?? compiled.code,
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
): Promise<void> {
  await removeStaleGeneratedFiles(outputRoot, new Set(files.map(file => file.relativePath)))
  for (const file of files) {
    await writeGeneratedApp(FS.resolvePath(file.relativePath, outputRoot), file.code)
  }
  await removeEmptyGeneratedDirectories(outputRoot)
}

function filesWithStablePreviewRoot(
  files: Array<{ relativePath: string; code: string }>,
  preview: StudioPreviewPublication,
): Array<{ relativePath: string; code: string }> {
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
    ...files.map(file => {
      if (file.relativePath === 'App.tsx') {
        return { ...file, relativePath: 'TaoApp.tsx' }
      }
      const appImport = relativeModuleImport(file.relativePath, 'App.tsx')
      const taoAppImport = relativeModuleImport(file.relativePath, 'TaoApp.tsx')
      return {
        ...file,
        code: file.code
          .replaceAll(`'${appImport}'`, `'${taoAppImport}'`)
          .replaceAll(`"${appImport}"`, `"${taoAppImport}"`),
      }
    }),
  ]
}

function relativeModuleImport(fromOutputPath: string, toOutputPath: string): string {
  const relative = FS.relativePath(FS.dirname(fromOutputPath), toOutputPath).replace(/\.(?:d\.ts|tsx?)$/, '')
  return relative.startsWith('.') ? relative : `./${relative}`
}

function stablePreviewRootSource(): string {
  return `import React from 'react'
import TR from '@runtime/TR'
import TaoApp from './TaoApp'
import TaoStudioManifest from './TaoStudioManifest'
import TaoStudioProject from './TaoStudioProject'
import TaoStudioRevision from './TaoStudioRevision'

const TaoStudioPreviewBootstrap = typeof window === 'undefined'
  ? undefined
  : studioPreviewBootstrap(window.location.href)

export default function App() {
  const [cell, setCell] = React.useState<any>()
  const [bootstrapError, setBootstrapError] = React.useState<unknown>()
  React.useEffect(() => {
    if (TaoStudioPreviewBootstrap?.cell !== true) return
    let cancelled = false
    const bootstrapPath = TaoStudioPreviewBootstrap.sessionId === undefined
      ? '/api/preview/cell/bootstrap'
      : '/sessions/' + encodeURIComponent(TaoStudioPreviewBootstrap.sessionId) + '/api/preview/cell/bootstrap'
    const url = new URL(bootstrapPath, TaoStudioPreviewBootstrap.parentOrigin)
    url.searchParams.set('previewInstanceId', TaoStudioPreviewBootstrap.previewInstanceId)
    void fetch(url).then(async response => {
      if (!response.ok) throw new Error('Tao Studio cell bootstrap was rejected (' + response.status + ').')
      const nextCell = await response.json()
      if (!cancelled) setCell(nextCell)
    }).catch(error => {
      if (!cancelled) setBootstrapError(error)
    })
    return () => { cancelled = true }
  }, [])
  const TaoStudioPreviewConfig = TaoStudioPreviewBootstrap === undefined
    ? undefined
    : TaoStudioPreviewBootstrap.cell === true && cell === undefined
    ? undefined
    : {
      ...TaoStudioProject,
      ...TaoStudioRevision,
      ...TaoStudioPreviewBootstrap,
      ...(cell?.identity ?? {}),
    }
  if (TaoStudioPreviewBootstrap?.cell === true && cell === undefined) {
    return bootstrapError === undefined
      ? <TR.Studio.Pending />
      : <TR.Studio.Failure error={bootstrapError} />
  }
  if (TaoStudioPreviewConfig === undefined) {
    return <TaoApp />
  }
  return (
    <TR.Studio.ErrorBoundary key={String(TaoStudioPreviewConfig.compileRevision) + ':' + TaoStudioPreviewConfig.previewInstanceId}>
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
  const TaoStudioCell = cell === undefined ? undefined : studioCellRuntime(cell)
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

function studioCellRuntime(runtime: any) {
  const manifest: any = TaoStudioManifest
  const scenario = manifest.scenarios.find((candidate: any) => candidate.id === runtime.cell.scenarioId)
  if (scenario === undefined) throw new Error('Tao Studio scenario bootstrap is stale.')
  const fixture = manifest.fixtures.find((candidate: any) => candidate.id === scenario.fixtureId)
  if (fixture === undefined) throw new Error('Tao Studio fixture bootstrap is stale.')
  const dataState = runtime.resolvedState?.snapshot?.domains?.data?.value
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
        capability: 'inert',
        reason: 'Reactive Scheme is not implemented yet.',
        requested: runtime.cell.environment.scheme.requested,
      },
      version: 1,
    },
    fixture: { accounts: fixture.accounts, creates: fixture.creates },
    scenario: {
      arguments: runtime.cell.args,
      kind: scenario.subject.kind,
      prepare: scenario.prepare,
      subjectId: scenario.subject.subjectId,
    },
    ...(dataState === undefined ? {} : { seed: dataState }),
  } as any
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

async function removeStaleGeneratedFiles(outputRoot: string, currentRelativePaths: ReadonlySet<string>): Promise<void> {
  if (!await FS.exists(outputRoot)) {
    return
  }
  for await (const path of FS.walk(outputRoot)) {
    const relativePath = FS.relativePath(outputRoot, path)
    if (!currentRelativePaths.has(relativePath)) {
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

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

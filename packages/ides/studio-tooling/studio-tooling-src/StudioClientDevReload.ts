import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { type StudioClientAssetProvider, StudioClientAssets } from '@studio'
import { watch } from 'chokidar'
import { previewUrlMarker } from './StudioClientSnapshotProcess'

type StudioClientChangeListener = (change: StudioClientChange) => Promise<void>

/** A server edit makes client publication unsafe until the process is deliberately restarted. */
type StudioClientChange = { serverSourcesChanged: boolean }

export type StudioClientDevReloadOptions = {
  loadAssets?: (attempt: number) => Promise<StudioClientAssetProvider>
  onError?: (error: unknown) => void
  subscribe?: (listener: StudioClientChangeListener) => Promise<() => Promise<void>>
}

export type StartedStudioClientDevReload = {
  clientAssets: StudioClientAssetProvider
  close: () => Promise<void>
  revision: () => number
}

export const StudioClientDevReload = {
  testing: {
    isStudioClientSource,
    isStudioServerSource,
    studioClientAssetSnapshot,
  },
} as const

/**
 * Whether a path is loaded by the Studio server process rather than only bundled into the browser client.
 * Everything outside `studio-src/client` and `studio-src/code-editor` is treated as server-owned: a
 * shared module reaches both, and saying "restart to be sure" is the safe direction to be wrong in. The
 * editor package is browser-bundled foreign-view code, not server code, even though it sits beside
 * `client/` rather than inside it. Studio's own Tao client and its app-local packages under
 * `Apps/Tao Studio/` are browser-bundled the same way and never server-loaded.
 */
function isStudioServerSource(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  if (normalized.includes('/studio-tooling-src/')) {
    return true
  }
  if (normalized.includes('/Apps/Tao Studio/')) {
    return false
  }
  if (!normalized.includes('/studio-src/')) {
    return false
  }
  return !normalized.includes('/studio-src/client/')
    && !normalized.includes('/studio-src/code-editor/')
    && !normalized.endsWith('Panel.ts')
}

/**
 * Whether a change to a path can change the Studio client. A `.tao.ts` file is the bridge metadata
 * the compiler writes beside a Tao source, not a source: compiling the client writes it, so a fresh
 * checkout's first page load would otherwise republish the client it had just built and reload the
 * page. Its content follows from the `.tao` file, whose own change is already watched.
 */
function isStudioClientSource(path: string): boolean {
  return ['.tao', '.ts', '.tsx'].includes(FS.extname(path)) && !path.endsWith('.tao.ts')
}

/** Rebuilds the browser-owned Studio shell and publishes only complete client bundles. */
export async function startStudioClientDevReload(
  options: StudioClientDevReloadOptions = {},
): Promise<StartedStudioClientDevReload> {
  const loadAssets = options.loadAssets ?? loadStudioClientAssets
  const onError = options.onError ?? (error => HCI.logProcessError('studio-client', String(error)))
  const subscribe = options.subscribe ?? subscribeStudioClientSources
  let activeAssets: StudioClientAssetProvider = StudioClientAssets
  let attempt = 0
  let closed = false
  let publishedRevision = 0
  let serverSourcesStale = false
  let reloadLane = Promise.resolve()
  const refresh = (change: StudioClientChange = { serverSourcesChanged: false }): Promise<void> => {
    const requestedAttempt = ++attempt
    if (change.serverSourcesChanged && !serverSourcesStale) {
      serverSourcesStale = true
      HCI.logProcessInfo(
        'studio-client',
        'Studio server sources changed; restart ./dev studio to load them. Keeping the current client until restart.',
      )
    }
    const reload = reloadLane.then(async () => {
      if (serverSourcesStale) {
        return
      }
      const nextAssets = await loadAssets(requestedAttempt)
      await nextAssets.bundle()
      if (closed || serverSourcesStale) {
        return
      }
      activeAssets = nextAssets
      publishedRevision = requestedAttempt
      HCI.logProcessInfo('studio-client', `Reloading Studio client revision ${publishedRevision}.`)
    })
    reloadLane = reload.catch(onError)
    return reloadLane
  }
  const unsubscribe = await subscribe(refresh)
  return {
    clientAssets: {
      async bundle(bundleOptions) {
        return await activeAssets.bundle(bundleOptions)
      },
      html(config) {
        return activeAssets.html(config)
      },
    },
    async close() {
      closed = true
      await unsubscribe()
      await reloadLane
    },
    revision: () => publishedRevision,
  }
}

async function loadStudioClientAssets(attempt: number): Promise<StudioClientAssetProvider> {
  const result = await CLI.run(Platform.runtimeProcess.execPath, {
    args: [
      Repo.resolvePath('packages/ides/studio-tooling/studio-tooling-src/StudioClientSnapshotProcess.ts'),
      String(attempt),
    ],
    cwd: Repo.resolvePath('.'),
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.error?.message || `exit code ${result.exitCode ?? 'unknown'}`
    Errors.throwHostEnvironment(`Could not rebuild the Studio browser client. ${detail}`)
  }
  const snapshot = JSON.parse(result.stdout) as StudioClientAssetSnapshot
  if (typeof snapshot.bundle !== 'string' || typeof snapshot.html !== 'string') {
    Errors.throwHostEnvironment('The Studio browser client rebuild returned an invalid asset snapshot.')
  }
  return studioClientAssetSnapshot(snapshot)
}

type StudioClientAssetSnapshot = {
  bundle: string
  html: string
}

const clientConfigMarker = JSON.stringify({ previewUrl: previewUrlMarker })

function studioClientAssetSnapshot(snapshot: StudioClientAssetSnapshot): StudioClientAssetProvider {
  if (!snapshot.html.includes(clientConfigMarker)) {
    Errors.throwHostEnvironment('The Studio browser client rebuild omitted its configuration marker.')
  }
  return {
    async bundle() {
      return snapshot.bundle
    },
    html(config) {
      const serializedConfig = JSON.stringify(config).replaceAll('<', '\\u003c')
      return snapshot.html.replace(clientConfigMarker, () => serializedConfig)
    },
  }
}

async function subscribeStudioClientSources(listener: StudioClientChangeListener): Promise<() => Promise<void>> {
  const roots = [
    Repo.resolvePath('packages/ides/studio/studio-src'),
    Repo.resolvePath('packages/ides/studio-tooling/studio-tooling-src'),
    Repo.resolvePath('Apps/Tao Studio'),
  ]
  const watcher = watch(roots, { ignoreInitial: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  let serverSourcesChanged = false
  const schedule = (path: string) => {
    if (!isStudioClientSource(path)) {
      return
    }
    serverSourcesChanged ||= isStudioServerSource(path)
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      const change = { serverSourcesChanged }
      serverSourcesChanged = false
      void listener(change)
    }, 50)
  }
  watcher.on('add', schedule)
  watcher.on('change', schedule)
  watcher.on('unlink', schedule)
  await new Promise<void>((resolve, reject) => {
    watcher.once('ready', resolve)
    watcher.once('error', reject)
  })
  return async () => {
    clearTimeout(timer)
    await watcher.close()
  }
}

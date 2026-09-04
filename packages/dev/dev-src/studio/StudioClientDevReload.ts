import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { type StudioClientAssetProvider, StudioClientAssets } from '@studio'
import { watch } from 'chokidar'

type StudioClientChangeListener = (change: StudioClientChange) => Promise<void>

/** What changed, so a rebuild can say when rebuilding is not enough. */
export type StudioClientChange = { serverSourcesChanged: boolean }

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
    isStudioServerSource,
    studioClientAssetSnapshot,
  },
} as const

/**
 * Whether a path is loaded by the Studio server process rather than only bundled into the browser client.
 * Everything outside `studio-src/client` is treated as server-owned: a shared module reaches both, and
 * saying "restart to be sure" is the safe direction to be wrong in.
 */
function isStudioServerSource(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  if (!normalized.includes('/studio-src/')) {
    return false
  }
  return !normalized.includes('/studio-src/client/') && !normalized.endsWith('Panel.ts')
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
  let reloadLane = Promise.resolve()
  const refresh = (change: StudioClientChange = { serverSourcesChanged: false }): Promise<void> => {
    const requestedAttempt = ++attempt
    const reload = reloadLane.then(async () => {
      const nextAssets = await loadAssets(requestedAttempt)
      await nextAssets.bundle()
      if (closed) {
        return
      }
      activeAssets = nextAssets
      publishedRevision = requestedAttempt
      HCI.logProcessInfo('studio-client', `Reloading Studio client revision ${publishedRevision}.`)
      if (change.serverSourcesChanged) {
        // Only the browser bundle is rebuilt here. Server modules were loaded when the process started, so a
        // reloaded page can call an endpoint the running server does not have yet, and the failure it gets
        // back is confusing rather than obviously stale.
        HCI.logProcessInfo(
          'studio-client',
          'Studio server sources changed; restart ./dev studio to load them. The reloaded page is newer than the running server.',
        )
      }
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
    args: [Repo.resolvePath('packages/dev/dev-src/studio/StudioClientSnapshotProcess.ts'), String(attempt)],
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

const previewUrlMarker = '__TAO_STUDIO_DEV_PREVIEW_URL__'
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
    Repo.resolvePath('packages/code-editor/code-editor-src'),
    Repo.resolvePath('packages/studio/studio-src'),
  ]
  const watcher = watch(roots, { ignoreInitial: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  let serverSourcesChanged = false
  const schedule = (path: string) => {
    if (!['.tao', '.ts', '.tsx'].includes(FS.extname(path))) {
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

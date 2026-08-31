import { CLI, FS, HCI, Platform, Repo } from '@shared'
import { type StudioClientAssetProvider, StudioClientAssets } from '@studio'
import { watch } from 'chokidar'

type StudioClientChangeListener = () => Promise<void>

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
    studioClientAssetSnapshot,
  },
} as const

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
  const refresh = (): Promise<void> => {
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
    throw new Error(`Could not rebuild the Studio browser client. ${detail}`)
  }
  const snapshot = JSON.parse(result.stdout) as StudioClientAssetSnapshot
  if (typeof snapshot.bundle !== 'string' || typeof snapshot.html !== 'string') {
    throw new Error('The Studio browser client rebuild returned an invalid asset snapshot.')
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
    throw new Error('The Studio browser client rebuild omitted its configuration marker.')
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
  const schedule = (path: string) => {
    if (!['.tao', '.ts', '.tsx'].includes(FS.extname(path))) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void listener()
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

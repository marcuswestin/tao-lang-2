import { RuntimeToolchainPaths } from '@expo-host'
import { Assert, FS, Platform } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, testOverrideSlot } from '@shared/test'

const expoLauncher = FS.realPathSync(FS.resolvePath('.bin/expo', RuntimeToolchainPaths.dependencyRoot()))
const expoRequire = Platform.createModuleRequire(expoLauncher)
const cliEntry = expoRequire.resolve('@expo/cli')
const cliRequire = Platform.createModuleRequire(cliEntry)
const metroWrapper = cliRequire.resolve('@expo/metro/metro/HmrServer')
const metroRequire = Platform.createModuleRequire(metroWrapper)
const metroEntry = metroRequire.resolve('metro/private/HmrServer')
const hmrServerModule = metroRequire(metroEntry) as {
  default: new(bundler: unknown, createModuleId: unknown, config: unknown) => any
}
const metroPackageJson = metroRequire.resolve('metro/package.json')
const fileMapEntry = cliRequire.resolve('@expo/metro-file-map')
const fileMapPackageJson = cliRequire.resolve('@expo/metro-file-map/package.json')
const fileMapRequire = Platform.createModuleRequire(fileMapEntry)
const fileMapModule = fileMapRequire(fileMapEntry) as {
  default: { create(options: unknown): any; H: Record<string, number> }
}
const watcherModule = fileMapRequire('./Watcher') as { Watcher: new(...args: any[]) => any }
const processorModule = fileMapRequire('./lib/FileProcessor') as { FileProcessor: new(...args: any[]) => any }

type TimerCallback = (...args: unknown[]) => unknown
type TimeoutHandle = ReturnType<typeof setTimeout>
type IntervalHandle = ReturnType<typeof setInterval>
const timeoutSlot = testOverrideSlot<typeof setTimeout>({
  read: () => globalThis.setTimeout,
  write: value => globalThis.setTimeout = value,
})
const clearTimeoutSlot = testOverrideSlot<typeof clearTimeout>({
  read: () => globalThis.clearTimeout,
  write: value => globalThis.clearTimeout = value,
})
const intervalSlot = testOverrideSlot<typeof setInterval>({
  read: () => globalThis.setInterval,
  write: value => globalThis.setInterval = value,
})
const clearIntervalSlot = testOverrideSlot<typeof clearInterval>({
  read: () => globalThis.clearInterval,
  write: value => globalThis.clearInterval = value,
})
const fastHmrEnv = testOverrideSlot<string | undefined>({
  read: () => Platform.runtimeProcess.env['TAO_STUDIO_FAST_HMR'],
  write: value => setEnv('TAO_STUDIO_FAST_HMR', value),
})
const fastFileMapEnv = testOverrideSlot<string | undefined>({
  read: () => Platform.runtimeProcess.env['TAO_STUDIO_FAST_FILE_MAP'],
  write: value => setEnv('TAO_STUDIO_FAST_FILE_MAP', value),
})
const watcherClassSlot = testOverrideSlot<new(...args: any[]) => any>({
  read: () => watcherModule.Watcher,
  write: value => watcherModule.Watcher = value,
})
const processorClassSlot = testOverrideSlot<new(...args: any[]) => any>({
  read: () => processorModule.FileProcessor,
  write: value => processorModule.FileProcessor = value,
})

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete Platform.runtimeProcess.env[key]
  } else {
    Platform.runtimeProcess.env[key] = value
  }
}

function withTimers<T>(
  run: (timeouts: { delays: number[]; fire: (index: number) => Promise<void> }, intervals: number[]) => Promise<T>,
): Promise<T> {
  const realTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const realInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  const pending = new Map<TimeoutHandle, TimerCallback>()
  const delays: number[] = []
  const intervals: number[] = []
  const fakeIntervals = new Set<IntervalHandle>()
  let nextHandle = 0
  const restoreTimeout = timeoutSlot.install(
    ((handler: TimerHandler, delay = 0, ...args: unknown[]) => {
      if (typeof handler !== 'function' || (delay !== 0 && delay !== 1 && delay !== 50)) {
        return Reflect.apply(realTimeout, globalThis, [handler, delay, ...args])
      }
      const handle = { id: ++nextHandle } as unknown as TimeoutHandle
      delays.push(delay)
      pending.set(handle, () => Reflect.apply(handler, undefined, args))
      return handle
    }) as typeof setTimeout,
  )
  const restoreClearTimeout = clearTimeoutSlot.install(
    (handle => {
      if (pending.has(handle as TimeoutHandle)) {
        pending.delete(handle as TimeoutHandle)
      } else {
        Reflect.apply(realClearTimeout, globalThis, [handle])
      }
    }) as typeof clearTimeout,
  )
  const restoreInterval = intervalSlot.install(
    ((handler: TimerHandler, delay = 0, ...args: unknown[]) => {
      if (delay !== 30 || typeof handler !== 'function') {
        return Reflect.apply(realInterval, globalThis, [handler, delay, ...args])
      }
      const handle = { id: ++nextHandle } as unknown as IntervalHandle
      intervals.push(delay)
      fakeIntervals.add(handle)
      return handle
    }) as typeof setInterval,
  )
  const restoreClearInterval = clearIntervalSlot.install(
    (handle => {
      if (fakeIntervals.has(handle as IntervalHandle)) {
        fakeIntervals.delete(handle as IntervalHandle)
      } else {
        Reflect.apply(realClearInterval, globalThis, [handle])
      }
    }) as typeof clearInterval,
  )
  return run({
    delays,
    async fire(index) {
      const callback = [...pending.values()][index]
      Assert(callback, `No captured timeout at index ${index}`)
      pending.delete([...pending.keys()][index]!)
      await callback()
    },
  }, intervals).finally(() => {
    restoreClearInterval()
    restoreInterval()
    restoreClearTimeout()
    restoreTimeout()
  })
}

Describe('Studio Metro fast waits', () => {
  Test('resolves the exact Expo-host Metro modules and keeps ordinary HMR debounce at 50ms', async () => {
    Expect(await FS.readJson(metroPackageJson)).toMatchObject({ version: '0.84.5' })
    Expect(await FS.readJson(fileMapPackageJson)).toMatchObject({ version: '57.0.3' })
    const restoreEnv = fastHmrEnv.install(undefined)
    try {
      await withTimers(async ({ delays, fire }) => {
        const server = makeHmrServer()
        await server.register()
        const change = server.listen!({ changeId: 1 })
        Expect(delays).toContain(50)
        await fire(0)
        await change
      })
    } finally {
      restoreEnv()
    }
  })

  Test('uses zero-delay HMR in Studio while serializing rapid asynchronous updates', async () => {
    const restoreEnv = fastHmrEnv.install('true')
    try {
      await withTimers(async ({ delays, fire }) => {
        const server = makeHmrServer()
        await server.register()
        const entered = Deferred()
        const release = Deferred()
        let active = 0
        let maxActive = 0
        let updates = 0
        server.instance._handleFileChange = async (_group: unknown, options: { isInitialUpdate: boolean }) => {
          if (options.isInitialUpdate) {
            return
          }
          active += 1
          maxActive = Math.max(maxActive, active)
          updates += 1
          if (updates === 1) {
            entered.resolve()
            await release.promise
          }
          active -= 1
        }
        const changes = server.listen!
        const first = changes({ changeId: 1 })
        Expect(delays).toContain(0)
        const firing = fire(0)
        await entered.promise
        const second = changes({ changeId: 2 })
        const third = changes({ changeId: 3 })
        release.resolve()
        await firing
        await Promise.all([first, second, third])
        Expect(maxActive).toBe(1)
        Expect(updates).toBe(2)
      })
    } finally {
      restoreEnv()
    }
  })

  Test(
    'keeps the 30ms ordinary FileMap interval but batches fast events on one non-restarting timer after queued processing',
    async () => {
      const restoreFast = fastFileMapEnv.install('true')
      try {
        await withTimers(async (timers, intervals) => {
          const gate = Deferred()
          const controlled = await installControlledFileMap(gate)
          const map = fileMapModule.default.create(fileMapOptions(controlled.root))
          const changes: any[] = []
          map.on('change', (event: unknown) => changes.push(event))
          try {
            await map.build()
            Expect(intervals).toEqual([])
            controlled.watcher.send(deleted(controlled.root, 'one.js'))
            controlled.watcher.send(touched(controlled.root, 'recreated.js'))
            await flushMicrotasks()
            Expect(timers.delays.filter(delay => delay === 1)).toHaveLength(1)
            const firing = timers.fire(0)
            await flushMicrotasks()
            Expect(changes).toHaveLength(0)
            gate.resolve()
            await firing
            Expect(changes).toHaveLength(1)
            Expect(paths(changes[0].changes.removedFiles)).toContain('one.js')
            Expect(paths(changes[0].changes.addedFiles)).toContain('recreated.js')
          } finally {
            await map.end()
            controlled.restore()
            await FS.remove(controlled.root)
          }
        })
      } finally {
        restoreFast()
      }
    },
  )

  Test('end prevents an awaited fast flush from emitting after shutdown; recrawl remains authoritative', async () => {
    const restoreFast = fastFileMapEnv.install('true')
    try {
      await withTimers(async timers => {
        const gate = Deferred()
        const controlled = await installControlledFileMap(gate)
        const map = fileMapModule.default.create(fileMapOptions(controlled.root))
        const changes: unknown[] = []
        map.on('change', (event: unknown) => changes.push(event))
        try {
          await map.build()
          controlled.watcher.send(deleted(controlled.root, 'one.js'))
          controlled.watcher.send(touched(controlled.root, 'blocked.js'))
          await flushMicrotasks()
          const firing = timers.fire(0)
          await flushMicrotasks()
          await map.end()
          gate.resolve()
          await firing
          Expect(changes).toHaveLength(0)
        } finally {
          gate.resolve()
          await map.end()
          controlled.restore()
          await FS.remove(controlled.root)
        }
      })
    } finally {
      restoreFast()
    }
  })

  Test('ordinary FileMap still schedules the default 30ms interval', async () => {
    const restoreFast = fastFileMapEnv.install(undefined)
    try {
      await withTimers(async (_timers, intervals) => {
        const controlled = await installControlledFileMap(Deferred())
        const map = fileMapModule.default.create(fileMapOptions(controlled.root))
        try {
          await map.build()
          Expect(intervals).toEqual([30])
        } finally {
          await map.end()
          controlled.restore()
          await FS.remove(controlled.root)
        }
      })
    } finally {
      restoreFast()
    }
  })

  Test('keeps Metro recrawl reconciliation active in fast mode', async () => {
    const restoreFast = fastFileMapEnv.install('true')
    try {
      await withTimers(async () => {
        const controlled = await installControlledFileMap(Deferred())
        const map = fileMapModule.default.create(fileMapOptions(controlled.root))
        const changes: any[] = []
        map.on('change', (event: unknown) => changes.push(event))
        try {
          await map.build()
          controlled.watcher.send({ root: controlled.root, relativePath: '.', event: 'recrawl', clock: null })
          await flushMicrotasks()
          Expect(changes).toHaveLength(1)
          Expect(paths(changes[0].changes.removedFiles)).toContain('one.js')
        } finally {
          await map.end()
          controlled.restore()
          await FS.remove(controlled.root)
        }
      })
    } finally {
      restoreFast()
    }
  })
})

function makeHmrServer(): { instance: any; register: () => Promise<void>; listen?: (event: unknown) => Promise<void> } {
  let listen: (event: unknown) => Promise<void> | void = () => undefined
  const bundler = {
    getBundler: () => ({
      async getDependencyGraph() {
        return { resolveDependency: () => ({ filePath: '/project/index.js' }) }
      },
    }),
    getRevisionByGraphId: async () => ({ graph: {}, id: 'revision-one' }),
    getDeltaBundler: () => ({
      listen: (_graph: unknown, callback: typeof listen) => {
        listen = callback
        return () => undefined
      },
    }),
  }
  const config = {
    projectRoot: '/project',
    resolver: { platforms: ['ios'] },
    transformer: { unstable_allowRequireContext: false },
    server: { rewriteRequestUrl: (url: string) => url, unstable_serverRoot: '/project' },
  }
  const instance = new hmrServerModule.default(bundler, () => 1, config)
  instance._handleFileChange = async () => undefined
  const client = { revisionIds: [], optedIntoHMR: false, sendFn: () => undefined }
  return {
    instance,
    get listen() {
      return listen as (event: unknown) => Promise<void>
    },
    register: async () => {
      await instance._registerEntryPoint(
        client,
        'http://localhost/index.bundle?platform=ios&dev=true&minify=false',
        () => undefined,
      )
    },
  }
}

async function installControlledFileMap(
  gate: Deferred<void>,
): Promise<{ root: string; watcher: any; restore: () => void }> {
  let watcher: any
  const FakeWatcher = class {
    constructor() {
      watcher = this
    }
    on(): void {}
    async crawl() {
      return { changedFiles: new Map([['one.js', metadata(1)]]), removedFiles: new Set(), clocks: new Map() }
    }
    async watch(callback: (change: any) => void) {
      this.callback = callback
    }
    async recrawl() {
      return { changedFiles: new Map(), removedFiles: new Set(['one.js']), clocks: new Map() }
    }
    async close(): Promise<void> {}
    callback!: (change: any) => void
    send(change: any): void {
      this.callback(change)
    }
  }
  const FakeProcessor = class {
    async processBatch() {
      return { errors: [] }
    }
    async processRegularFile(_path: string, fileMetadata: number[]) {
      await gate.promise
      fileMetadata[fileMapModule.default.H['VISITED']!] = 1
    }
    async end(): Promise<void> {}
  }
  const restoreWatcher = watcherClassSlot.install(FakeWatcher)
  const restoreProcessor = processorClassSlot.install(FakeProcessor)
  const root = await mkTestDir('metro-fast-waits-')
  // The FileMap build is deterministic: its fake watcher reports a seeded file and emits only the events the test sends.
  return {
    root,
    get watcher() {
      return watcher
    },
    restore: () => {
      restoreProcessor()
      restoreWatcher()
    },
  }
}

function fileMapOptions(rootDir: string): unknown {
  return {
    rootDir,
    roots: [rootDir],
    extensions: ['.js'],
    watch: true,
    useWatchman: false,
    forceNodeFilesystemAPI: true,
    resetCache: true,
    computeSha1: false,
    maxWorkers: 1,
    healthCheck: { enabled: false, filePrefix: '.health', interval: 60_000, timeout: 1_000 },
    cacheManagerFactory: () => ({ read: async () => null, write: async () => undefined, end: async () => undefined }),
  }
}

function metadata(mtime: number): number[] {
  const value: number[] = []
  value[fileMapModule.default.H['MTIME']!] = mtime
  value[fileMapModule.default.H['SIZE']!] = 1
  value[fileMapModule.default.H['SYMLINK']!] = 0
  value[fileMapModule.default.H['VISITED']!] = 1
  return value
}

function deleted(root: string, relativePath: string): unknown {
  return { root, relativePath, event: 'delete', metadata: null, clock: null }
}

function touched(root: string, relativePath: string): unknown {
  return { root, relativePath, event: 'touch', metadata: { modifiedTime: 3, size: 1, type: 'f' }, clock: null }
}

function paths(files: Iterable<[string, unknown]>): string[] {
  return [...files].map(([filePath]) => filePath)
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
  }
}

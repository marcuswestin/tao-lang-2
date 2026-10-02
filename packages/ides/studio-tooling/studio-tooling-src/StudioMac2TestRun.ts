import type { Mac2DesktopLeases } from '@appium-driver'
import { type MachineResourceLease, MachineResources } from '@host-control'
import { CLI, Errors, FS, HCI, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'

type FetchInit = Omit<RequestInit, 'signal'> & { signal?: AbortSignal | null }
type FetchLike = (input: string, init?: FetchInit) => Promise<Response>

type FinishOptions = {
  primaryFailure?: { error: unknown }
  closeController?: () => Promise<void>
  cleanupWda: () => Promise<void>
  stopNative: () => Promise<void>
  stopFixtures: () => void
}

/** Retaining uncertain WDA resources must not skip independently owned Studio and HTTP servers. */
async function finish(options: FinishOptions): Promise<void> {
  await runCleanup(
    [options.closeController, options.cleanupWda, options.stopNative, options.stopFixtures],
    options.primaryFailure,
  )
}

async function runCleanup(
  actions: (((() => Promise<void>) | (() => void)) | undefined)[],
  primaryFailure?: { error: unknown },
): Promise<void> {
  let failure = primaryFailure
  for (const cleanup of actions) {
    try {
      await cleanup?.()
    } catch (error) {
      if (failure === undefined) {
        failure = { error }
      } else {
        HCI.logProcessError('studio-mac2', `Cleanup also failed: ${Errors.formatForLog(error)}`)
      }
    }
  }
  if (failure !== undefined) {
    throw failure.error
  }
}

type PrepareOptions = {
  artifactRoot: string
  /** Source-test seams; production starts only the pinned copied WDA project. */
  wdaSource?: string
  xcodebuild?: string
  registryRoot?: string
  inspect?: typeof CLI.run
  start?: typeof CLI.start
  identities?: typeof ProcessTree.identities
  descendants?: typeof ProcessTree.descendants
  signalTracked?: typeof ProcessTree.signalTracked
  fetch?: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  writeLog?: (path: string, text: string) => Promise<void>
  startForwarder?: typeof Bun.serve
}

/** Own WDA before Appium attaches, so the driver never uses its unowned-listener DELETE branch. */
async function prepare(options: PrepareOptions) {
  const root = FS.resolvePath('appium-mac2', options.artifactRoot)
  const bootstrapRoot = FS.resolvePath('WebDriverAgentMac', root)
  const derivedData = FS.resolvePath('DerivedData', root)
  const resolvedBinary = options.xcodebuild ?? await CLI.commandPath('xcodebuild')
  if (resolvedBinary === undefined) {
    return Errors.throwHostEnvironment('Studio Mac2 isolation requires Xcode build tools.')
  }
  const xcodebuild = await FS.realPath(resolvedBinary)
  await FS.copyDirectory(
    options.wdaSource ?? Repo.resolvePath(
      'packages/testing/appium-driver/node_modules/appium-mac2-driver/WebDriverAgentMac',
    ),
    bootstrapRoot,
  )
  const project = await FS.realPath(FS.resolvePath('WebDriverAgentMac.xcodeproj', bootstrapRoot))
  if (!FS.pathIsWithin(project, await FS.realPath(bootstrapRoot))) {
    return Errors.throwHostEnvironment('The copied WDA project resolves outside this invocation.')
  }
  await FS.mkdir(derivedData)
  const ownedDerivedData = await FS.realPath(derivedData)
  const reservation = await reservePort(options.registryRoot)
  const note = FS.resolvePath('isolation.json', root)
  const url = `http://127.0.0.1:${reservation.port}`
  const inspect = options.inspect ?? CLI.run
  // Bun accepts the standard signal; ambient DOM declarations disagree at the fetch boundary.
  const fetcher: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init as RequestInit))
  const identities = options.identities ?? ProcessTree.identities
  const descendants = options.descendants ?? ProcessTree.descendants
  const signalTracked = options.signalTracked ?? ProcessTree.signalTracked
  const now = options.now ?? Time.nowMs
  const sleep = options.sleep ?? Time.sleep
  const owned = new Map<number, TrackedProcess>()
  let process: ReturnType<typeof CLI.start> | undefined
  let rootIdentity: TrackedProcess | undefined
  let desktop: MachineResourceLease | undefined
  let desktopReleased = false
  let released = false
  let retained = false
  let startupAttempted = false
  let forwarding = false
  let forwardingStarted = false
  let forwarderStopped = false
  const forwardingRequests = new Set<AbortController>()
  function disableForwarding(): void {
    forwarding = false
    for (const request of forwardingRequests) {
      request.abort()
    }
  }
  const metadata = {
    bootstrapRoot,
    derivedData: ownedDerivedData,
    // External attach bypasses the driver's Strongbox upgrade bookkeeping entirely.
    driverStartup: 'owned WDA; Appium webDriverAgentMacUrl attach',
    port: reservation.port,
    version: 1,
    xcodebuild,
  }
  async function record(state: string) {
    await FS.writeJson(note, { ...metadata, forwarderUrl, processes: [...owned.values()], state })
  }
  async function quarantine(reason: string): Promise<never> {
    if (!retained) {
      await MachineResources.retain({
        owners: [reservation.lease.owner, ...(desktop !== undefined && !desktopReleased ? [desktop.owner] : [])],
        // Missing inspection retains the complete last known tree, never an empty false proof.
        processes: retainedProcesses(),
        quarantined: true,
        reason,
        registryRoot: options.registryRoot,
      })
      retained = true
    }
    await record('retained')
    return Errors.throwHostEnvironment(`${reason} Retained WDA artifacts and resource fences at ${root}.`)
  }
  function retainedProcesses(): TrackedProcess[] {
    try {
      return surviving()
    } catch {
      return [...owned.values()]
    }
  }
  function captureTree(): void {
    if (
      rootIdentity !== undefined
      && ProcessTree.sameProcess(identities([rootIdentity.pid]).get(rootIdentity.pid), rootIdentity)
    ) {
      const tree = descendants(rootIdentity.pid)
      // Recheck after inspection so root PID reuse cannot import a stranger's descendants.
      if (!ProcessTree.sameProcess(identities([rootIdentity.pid]).get(rootIdentity.pid), rootIdentity)) {
        return
      }
      for (const child of tree) {
        owned.set(child.pid, child)
      }
    }
  }
  function surviving(): TrackedProcess[] {
    const current = identities([...owned.keys()])
    return [...owned.values()].filter(child => ProcessTree.sameProcess(current.get(child.pid), child))
  }
  async function listener(): Promise<number[]> {
    const result = await inspect('/usr/sbin/lsof', {
      args: ['-nP', `-iTCP:${reservation.port}`, '-sTCP:LISTEN', '-Fp'],
    })
    if (
      result.error !== undefined
      || (result.exitCode !== 0 && !(result.exitCode === 1 && result.stdout === '' && result.stderr === ''))
    ) {
      return Errors.throwHostEnvironment('Cannot inspect the WDA listener ownership.')
    }
    return result.stdout.split(/\r?\n/).filter(line => /^p[0-9]+$/.test(line)).map(line => Number(line.slice(1)))
  }
  async function ownedListener(): Promise<boolean> {
    captureTree()
    const pids = await listener()
    if (pids.length === 0) {
      return false
    }
    const current = identities(pids)
    if (
      pids.some(pid => {
        const captured = owned.get(pid)
        return captured === undefined || !ProcessTree.sameProcess(current.get(pid), captured)
      })
    ) {
      return Errors.throwHostEnvironment('Refused to contact a WDA listener not owned by this invocation.')
    }
    return true
  }
  async function waitGone(milliseconds: number): Promise<boolean> {
    const deadline = now() + milliseconds
    do {
      captureTree()
      if (surviving().length === 0) {
        return true
      }
      await sleep(50)
    } while (now() < deadline)
    return false
  }
  async function stopWda(): Promise<void> {
    reservation.guard.stop(true)
    try {
      captureTree()
      signalTracked([...owned.values()], 'SIGTERM')
      if (!await waitGone(5_000)) {
        captureTree()
        signalTracked([...owned.values()], 'SIGKILL')
        if (!await waitGone(5_000)) {
          return await quarantine('WDA shutdown is unproved after bounded termination.')
        }
      }
    } catch (error) {
      if (retained) {
        throw error
      }
      return await quarantine(
        `WDA shutdown is unproved because inspection or signalling failed: ${Errors.messageOf(error)}.`,
      )
    }
    if (startupAttempted && rootIdentity === undefined) {
      return await quarantine('WDA startup process identity is unproved.')
    }
    if (!await resourcesStopped(root, reservation.port, inspect)) {
      return await quarantine('WDA shutdown is unproved by scoped process and port inspection.')
    }
    await process?.closeOutput()
    process?.dispose()
    await record('wda-stopped')
  }
  async function startWda(): Promise<void> {
    reservation.guard.stop(true)
    if ((await listener()).length > 0) {
      return Errors.throwHostEnvironment('Refused WDA startup because its reserved port has an unowned listener.')
    }
    startupAttempted = true
    process = (options.start ?? CLI.start)(xcodebuild, {
      args: [
        'build-for-testing',
        'test-without-building',
        '-project',
        project,
        '-scheme',
        'WebDriverAgentRunner',
        'COMPILER_INDEX_STORE_ENABLE=NO',
        '-derivedDataPath',
        ownedDerivedData,
      ],
      cwd: bootstrapRoot,
      env: { ...Platform.runtimeProcess.env, USE_PORT: String(reservation.port), USE_HOST: '127.0.0.1' },
      onOutput: (_stream, chunk) => {
        logs.push(chunk.toString())
      },
      processPolicy: 'server',
      stdio: 'pipe',
    })
    if (process.pid === undefined) {
      return Errors.throwHostEnvironment('WDA startup did not expose an owned process ID.')
    }
    rootIdentity = identities([process.pid]).get(process.pid)
    if (rootIdentity === undefined) {
      return Errors.throwHostEnvironment('WDA startup process identity could not be captured.')
    }
    owned.set(rootIdentity.pid, rootIdentity)
    captureTree()
    await record('starting')
    const deadline = now() + 240_000
    while (now() < deadline) {
      if (await ownedListener()) {
        // No HTTP reaches a listener until kernel identities tie it to our captured process tree.
        let ready = false
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort(), 5_000)
        try {
          ready = (await fetcher(`${url}/status`, { signal: abort.signal })).ok
        } catch {
          // The owned listener can bind before its status handler is ready; the startup budget bounds retries.
        } finally {
          clearTimeout(timeout)
        }
        if (await ownedListener() && ready) {
          await record('ready')
          return
        }
      }
      if (surviving().length === 0) {
        return Errors.throwHostEnvironment('The owned WDA process exited before readiness.')
      }
      await sleep(100)
    }
    return Errors.throwHostEnvironment('The owned WDA listener did not become ready within 240000ms.')
  }
  const logs: string[] = []
  async function saveLog(): Promise<void> {
    try {
      await (options.writeLog ?? FS.writeText)(FS.resolvePath('wda.log', root), logs.join(''))
    } catch (error) {
      HCI.logProcessError('studio-mac2', `WDA log write failed: ${Errors.formatForLog(error)}`)
    }
  }
  const desktopLeases: Mac2DesktopLeases = {
    async acquire() {
      if (desktop !== undefined) {
        return Errors.throwUnexpected('Expected one desktop session per Mac2 test invocation.')
      }
      desktop = await MachineResources.acquire({
        command: 'Studio Mac2 acceptance WDA',
        name: 'macos-physical-input',
        registryRoot: options.registryRoot,
        repositoryRoot: Repo.getRoot(),
      })
      try {
        await startWda()
        forwarding = true
        forwardingStarted = true
      } catch (error) {
        try {
          await stopWda()
          await desktop.release()
          desktopReleased = true
        } catch (cleanupError) {
          HCI.logProcessError('studio-mac2', `WDA startup cleanup also failed: ${Errors.formatForLog(cleanupError)}`)
        } finally {
          await saveLog()
        }
        throw error
      }
      return {
        assertCurrent: async generation => {
          await desktop!.assertCurrent(generation)
          const listenerOwned = await ownedListener()
          if (!forwarding || !listenerOwned) {
            return Errors.throwHostEnvironment('The owned WDA listener is unavailable for this desktop session.')
          }
        },
        generation: desktop.generation,
        async release() {
          if (desktopReleased) {
            return
          }
          disableForwarding()
          try {
            await stopWda()
            await desktop!.release()
            desktopReleased = true
          } finally {
            await saveLog()
          }
        },
      }
    },
  }
  // Mac2 performs its own long readiness polling and subsequent POSTs inside the Appium child.
  // Keeping this listener bound gives every one of those requests a fresh ownership fence.
  let forwarder: ReturnType<typeof Bun.serve>
  try {
    forwarder = (options.startForwarder ?? Bun.serve)({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const body = await request.arrayBuffer()
        try {
          const generation = desktop?.generation
          if (!forwarding || generation === undefined) {
            return new Response('Owned WDA forwarding is disabled.', { status: 503 })
          }
          const headers = Object.fromEntries(request.headers.entries())
          delete headers['host']
          headers['connection'] = 'close'
          const path = new URL(request.url)
          const init: FetchInit = {
            body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
            headers,
            method: request.method,
            redirect: 'manual',
          }
          // Read the body first. Check immediately before one fetch, with no unchecked redirect or retry.
          await desktop!.assertCurrent(generation)
          const listenerOwned = await ownedListener()
          if (!forwarding || !listenerOwned) {
            return new Response('Owned WDA listener is unavailable.', { status: 503 })
          }
          const abort = new AbortController()
          forwardingRequests.add(abort)
          try {
            const response = await fetcher(`${url}${path.pathname}${path.search}`, { ...init, signal: abort.signal })
            if (response.status >= 300 && response.status < 400) {
              return new Response('Owned WDA forwarding refused a backend redirect.', { status: 503 })
            }
            return response
          } finally {
            forwardingRequests.delete(abort)
          }
        } catch (error) {
          return new Response(Errors.messageOf(error), { status: 503 })
        }
      },
    })
  } catch (error) {
    await runCleanup([() => reservation.guard.stop(true), () => reservation.lease.release()], { error })
    throw error
  }
  const forwarderUrl = `http://127.0.0.1:${forwarder.port}`
  async function closeForwarder(serverStopped: boolean): Promise<void> {
    disableForwarding()
    if (!forwarderStopped && (serverStopped || !forwardingStarted)) {
      forwarder.stop(true)
      forwarderStopped = true
    }
  }
  try {
    await record('reserved')
  } catch (error) {
    await runCleanup([
      () => reservation.guard.stop(true),
      () => closeForwarder(true),
      () => reservation.lease.release(),
    ], { error })
    throw error
  }
  return {
    bootstrapRoot,
    desktopLeases,
    environment: { ...Platform.runtimeProcess.env },
    systemPort: reservation.port,
    webDriverAgentMacUrl: forwarderUrl,
    async cleanup(serverStopped: boolean) {
      await closeForwarder(serverStopped)
      if (released) {
        return
      }
      if (retained) {
        return Errors.throwHostEnvironment(`WDA resources remain fenced for recovery at ${root}.`)
      }
      reservation.guard.stop(true)
      if (desktop !== undefined && !desktopReleased) {
        // Ambiguous remote cleanup leaves physical input fenced; stopping Studio is independent.
        return await quarantine('WDA remote-session shutdown is unproved.')
      }
      if (startupAttempted && (!serverStopped || !await resourcesStopped(root, reservation.port, inspect))) {
        return await quarantine('WDA shutdown is unproved by server, process, and listener inspection.')
      }
      await reservation.lease.release()
      released = true
      await record('closed')
    },
  }
}

async function reservePort(registryRoot?: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const guard = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null, { status: 503 }) })
    const port = guard.port!
    if (port === 10100) {
      guard.stop(true)
      continue
    }
    try {
      const lease = await MachineResources.tryAcquire({
        command: 'Studio Mac2 acceptance WDA',
        name: `appium-wda-port-${port}`,
        registryRoot,
        repositoryRoot: Repo.getRoot(),
      })
      if (lease !== undefined) {
        return { guard, lease, port }
      }
    } catch (error) {
      guard.stop(true)
      throw error
    }
    guard.stop(true)
  }
  return Errors.throwHostEnvironment('No private WDA listener port is available for Studio Mac2 acceptance.')
}

async function resourcesStopped(root: string, port: number, inspect: typeof CLI.run): Promise<boolean> {
  try {
    const files = await inspect('/usr/sbin/lsof', { args: ['-nP', '-d', 'cwd,txt', '-Fpn'] })
    if (files.error !== undefined || files.exitCode !== 0) {
      return false
    }
    if (
      files.stdout.split(/\r?\n/).some(line =>
        line.startsWith('n') && FS.pathIsWithin(line.slice(1).replace(/ \(deleted\)$/, ''), root)
      )
    ) {
      return false
    }
    const guard = Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response(null, { status: 503 }) })
    guard.stop(true)
    return true
  } catch {
    return false
  }
}

/** Select only a bundle built in this invocation; the stable consent ID alone is insufficient. */
async function appPath(
  nativeRoot: string,
  bundleIdentifier: string,
  inspect: typeof CLI.run = CLI.run,
): Promise<string> {
  const buildRoot = FS.resolvePath('build', nativeRoot)
  const candidates: string[] = []
  for (const build of await FS.listDir(buildRoot)) {
    if (!build.startsWith('dev-')) {
      continue
    }
    const directory = FS.resolvePath(build, buildRoot)
    for (const entry of await FS.listDir(directory)) {
      if (!entry.endsWith('.app')) {
        continue
      }
      const path = await FS.realPath(FS.resolvePath(entry, directory))
      if (!FS.pathIsWithin(path, await FS.realPath(nativeRoot))) {
        continue
      }
      const result = await inspect('/usr/libexec/PlistBuddy', {
        args: ['-c', 'Print :CFBundleIdentifier', FS.resolvePath('Contents/Info.plist', path)],
      })
      if (result.error === undefined && result.exitCode === 0 && result.stdout.trim() === bundleIdentifier) {
        candidates.push(path)
      }
    }
  }
  if (candidates.length !== 1) {
    return Errors.throwHostEnvironment('Cannot identify the exact Studio application built by this Mac2 invocation.', {
      details: { candidates, nativeRoot },
    })
  }
  return candidates[0]!
}

export const StudioMac2TestRun = { appPath, finish, prepare } as const

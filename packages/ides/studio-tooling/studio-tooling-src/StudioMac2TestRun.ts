import type { Mac2DesktopLeases } from '@appium-driver'
import { type MachineResourceLease, MachineResources } from '@host-control'
import { CLI, Errors, FS, HCI, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import { StudioWdaRegistration } from './StudioWdaRegistration'

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
  registration?: typeof StudioWdaRegistration.prepare
  /** Fixed internal engineering phases; never exposed as CLI or Appium capabilities. */
  registrationOnly?: 'deny' | 'grant'
  /** Fixed input-free source probe only; never a CLI or Appium capability. */
  sourceLookupProbe?: true
  persistRecord?: typeof persistRecord
}

/** Own WDA before Appium attaches, so the driver never uses its unowned-listener DELETE branch. */
async function prepare(options: PrepareOptions) {
  const root = FS.resolvePath('appium-mac2', options.artifactRoot)
  await FS.mkdir(root)
  await FS.chmod(root, 0o700)
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
  let xcodeProcess: ReturnType<typeof CLI.start> | undefined
  let rootIdentity: TrackedProcess | undefined
  let registration: Awaited<ReturnType<typeof StudioWdaRegistration.prepare>> | undefined
  let registeredPeer: TrackedProcess | undefined
  let registrationEvidence: {
    bundlePath: string
    bundleDigest: string
    signedChannelRule: true
    signedXcodeBaseline: boolean
    signedBaselineDigest: string
  } | undefined
  let desktop: MachineResourceLease | undefined
  let desktopReleased = false
  let released = false
  let retained = false
  let startupAttempted = false
  let forwarding = false
  let replayComplete = false
  let replayTail = ''
  let forwardingStarted = false
  let forwarderStopped = false
  const forwardingRequests = new Set<AbortController>()
  let stopWdaCompletion: Promise<void> | undefined
  let cleanupCompletion: Promise<void> | undefined
  // The bind that proved the port free after WDA stopped, held until the lease releases the port.
  let stoppedPortHold: PortHold | undefined
  function dropStoppedPortHold(): void {
    stoppedPortHold?.stop(true)
    stoppedPortHold = undefined
  }
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
  let recordPublication = Promise.resolve()
  function record(state: string): Promise<void> {
    // Snapshot only when this publication reaches the queue head. Earlier writes cannot erase a peer after ACK.
    const publication = recordPublication.then(async () => await publishRecord(state))
    recordPublication = publication.catch(() => {})
    return publication
  }
  async function publishRecord(state: string): Promise<void> {
    await (options.persistRecord ?? persistRecord)(note, {
      ...metadata,
      forwarderUrl,
      processes: [...owned.values()],
      registration: registrationEvidence,
      sourceDigest: registration?.sourceDigest,
      bootstrapDigest: registration?.bootstrapDigest,
      sourceLookupProvenance: registration?.sourceLookupProvenance,
      state,
    })
  }
  async function quarantine(reason: string): Promise<never> {
    // Recovery must be able to rebind a retained port once this invocation has given up on it.
    dropStoppedPortHold()
    if (!retained) {
      const retention = {
        owners: [reservation.lease.owner, ...(desktop !== undefined && !desktopReleased ? [desktop.owner] : [])],
        // Missing inspection retains the complete last known tree, never an empty false proof.
        processes: retainedProcesses(),
        quarantined: true,
        reason,
        registryRoot: options.registryRoot,
      }
      try {
        await MachineResources.retain(retention)
      } catch (error) {
        const currentDesktop = desktop === undefined ? undefined : await MachineResources.readOwner({
          name: desktop.owner.name,
          registryRoot: options.registryRoot,
        })
        if (desktop === undefined || currentDesktop === undefined || currentDesktop.id === desktop.owner.id) {
          throw error
        }
        // A changed desktop generation belongs to its current owner. Still quarantine our own port.
        await MachineResources.retain({ ...retention, owners: [reservation.lease.owner] })
      }
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
    await desktop!.assertCurrent(desktop!.generation)
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
    registration?.assertHealthy()
    if (
      registeredPeer === undefined
      || pids.some(pid => pid !== registeredPeer!.pid)
      || !ProcessTree.sameProcess(identities([registeredPeer.pid]).get(registeredPeer.pid), registeredPeer)
    ) {
      return Errors.throwHostEnvironment('Refused to contact WDA before proven launch registration acknowledgement.')
    }
    return registration?.acknowledged() === true
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
    return await (stopWdaCompletion ??= doStopWda())
  }
  async function doStopWda(): Promise<void> {
    reservation.guard.stop(true)
    try {
      await registration?.disable()
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
    stoppedPortHold = await holdStoppedResources(root, reservation.port, inspect)
    if (stoppedPortHold === undefined) {
      return await quarantine('WDA shutdown is unproved by scoped process and port inspection.')
    }
    await registration?.close()
    await xcodeProcess?.closeOutput()
    xcodeProcess?.dispose()
    await record('wda-stopped')
  }
  async function startWda(): Promise<void> {
    reservation.guard.stop(true)
    if ((await listener()).length > 0) {
      return Errors.throwHostEnvironment('Refused WDA startup because its reserved port has an unowned listener.')
    }
    registration = await (options.registration ?? StudioWdaRegistration.prepare)({
      bootstrapRoot,
      derivedData: ownedDerivedData,
      generation: desktop!.generation,
      port: reservation.port,
      root,
      registrationOnly: options.registrationOnly,
      sourceLookupProbe: options.sourceLookupProbe,
      captureHelper: helper => owned.set(helper.pid, helper),
      capture: async peer => {
        if (peer.signedChannelRule !== true) {
          return Errors.throwHostEnvironment('WDA signed host lacks the exact invocation socket exception.')
        }
        if (registeredPeer !== undefined) {
          return Errors.throwHostEnvironment('Refused a replayed WDA launch registration.')
        }
        await desktop!.assertCurrent(desktop!.generation)
        if ((await listener()).length > 0) {
          return Errors.throwHostEnvironment(
            'Refused an unowned listener bound before WDA registration acknowledgement.',
          )
        }
        if (!ProcessTree.sameProcess(identities([peer.identity.pid]).get(peer.identity.pid), peer.identity)) {
          return Errors.throwHostEnvironment('WDA launch registration has an unverifiable kernel identity.')
        }
        registeredPeer = peer.identity
        registrationEvidence = {
          bundlePath: peer.bundlePath,
          bundleDigest: peer.bundleDigest,
          signedChannelRule: true,
          signedXcodeBaseline: peer.signedXcodeBaseline,
          signedBaselineDigest: peer.signedBaselineDigest,
        }
        owned.set(peer.identity.pid, peer.identity)
        await record('registered-before-bind')
        if (!ProcessTree.sameProcess(identities([peer.identity.pid]).get(peer.identity.pid), peer.identity)) {
          return Errors.throwHostEnvironment('WDA launch registration identity changed before acknowledgement.')
        }
      },
    })
    startupAttempted = true
    xcodeProcess = (options.start ?? CLI.start)(xcodebuild, {
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
      env: { ...Platform.runtimeProcess.env, ...registration.runnerEnvironment },
      onOutput: (_stream, chunk) => {
        const text = chunk.toString()
        logs.push(text)
        if (options.registrationOnly === 'grant') {
          const marker = 'WDA registration-only replay refused'
          replayTail = replayTail + text
          replayComplete ||= replayTail.includes(marker)
          replayTail = replayTail.slice(-marker.length)
        }
      },
      processPolicy: options.registrationOnly === undefined ? 'server' : 'test',
      timeoutMs: options.registrationOnly === undefined ? undefined : 120_000,
      stdio: 'pipe',
    })
    if (xcodeProcess.pid === undefined) {
      return Errors.throwHostEnvironment('WDA startup did not expose an owned process ID.')
    }
    rootIdentity = identities([xcodeProcess.pid]).get(xcodeProcess.pid)
    if (rootIdentity === undefined) {
      return Errors.throwHostEnvironment('WDA startup process identity could not be captured.')
    }
    owned.set(rootIdentity.pid, rootIdentity)
    captureTree()
    await record('starting')
    const readinessBudget = options.registrationOnly === undefined ? 240_000 : 120_000
    const deadline = now() + readinessBudget
    while (now() < deadline) {
      registration.assertHealthy()
      if (options.registrationOnly !== undefined && registration.acknowledged()) {
        if (options.registrationOnly !== 'grant' || (await listener()).length !== 0) {
          return Errors.throwHostEnvironment(
            'The registration-only probe unexpectedly acknowledged or bound a backend.',
          )
        }
        await record('registration-only-acknowledged')
        return
      }
      if (xcodeProcess.error !== undefined && !registration.acknowledged()) {
        return Errors.throwHostEnvironment(
          'The recorded Xcode process failed before WDA registration acknowledgement (process error).',
        )
      }
      if ((xcodeProcess.exitCode !== null || xcodeProcess.signalCode !== null) && !registration.acknowledged()) {
        const terminal = xcodeProcess.signalCode !== null
          ? `signal ${xcodeProcess.signalCode}`
          : `exit ${xcodeProcess.exitCode}`
        return Errors.throwHostEnvironment(
          `The recorded Xcode process exited before WDA registration acknowledgement (${terminal}).`,
        )
      }
      if (await ownedListener()) {
        // No HTTP precedes registration acknowledgement and current kernel/listener proof.
        let ready = false
        let response: Response | undefined
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort(), 5_000)
        try {
          response = await fetcher(`${url}/status`, { method: 'GET', redirect: 'manual', signal: abort.signal })
        } catch {
          // The owned listener can bind before its status handler is ready; the startup budget bounds retries.
        } finally {
          clearTimeout(timeout)
        }
        if (response !== undefined && response.status >= 300 && response.status < 400) {
          return Errors.throwHostEnvironment('Owned WDA startup refused a backend redirect before readiness.')
        }
        ready = response?.ok === true
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
    return Errors.throwHostEnvironment(`The owned WDA listener did not become ready within ${readinessBudget}ms.`)
  }
  const logs: string[] = []
  async function saveLog(): Promise<void> {
    try {
      const text = logs.join('')
      await (options.writeLog ?? FS.writeText)(FS.resolvePath('wda.log', root), registration?.redact(text) ?? text)
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
        forwarding = options.registrationOnly === undefined
        forwardingStarted = forwarding
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
    async registrationOnlyReplayComplete(): Promise<boolean> {
      if (options.registrationOnly !== 'grant' || desktop === undefined || desktopReleased) {
        return false
      }
      await desktop.assertCurrent(desktop.generation)
      registration?.assertHealthy()
      const current = identities([...owned.keys()])
      if (
        [...owned.values()].some(value =>
          current.has(value.pid) && !ProcessTree.sameProcess(current.get(value.pid), value)
        )
      ) {
        return Errors.throwHostEnvironment('Registration-only replay ownership changed before release.')
      }
      if ((await listener()).length !== 0) {
        return Errors.throwHostEnvironment('Registration-only replay unexpectedly bound a backend.')
      }
      return registration?.acknowledged() === true && replayComplete
    },
    async cleanup(serverStopped: boolean) {
      await closeForwarder(serverStopped)
      return await (cleanupCompletion ??= cleanupResources(serverStopped))
    },
  }
  async function cleanupResources(serverStopped: boolean): Promise<void> {
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
    if (startupAttempted) {
      if (serverStopped) {
        stoppedPortHold = await holdStoppedResources(root, reservation.port, inspect, stoppedPortHold)
      }
      if (!serverStopped || stoppedPortHold === undefined) {
        return await quarantine('WDA shutdown is unproved by server, process, and listener inspection.')
      }
    }
    await reservation.lease.release()
    dropStoppedPortHold()
    released = true
    await record('closed')
  }
}

async function persistRecord(note: string, snapshot: unknown): Promise<void> {
  const temporary = `${note}.${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(temporary, snapshot, { mode: 0o600 })
    const handle = await FS.openAppend(temporary)
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await FS.move(temporary, note)
  } finally {
    await FS.remove(temporary).catch(() => {})
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

type PortHold = ReturnType<typeof Bun.serve>

/**
 * holdStoppedResources proves no process runs from `root` and nothing listens on `port`, and returns
 * the bind that proved the port free. Holding it keeps the proof true: once released, any ephemeral
 * bind or dial on the machine may take the port and fail a later proof. `held` is reused, not rebound.
 */
async function holdStoppedResources(
  root: string,
  port: number,
  inspect: typeof CLI.run,
  held?: PortHold,
): Promise<PortHold | undefined> {
  let hold = held
  try {
    // Bind before the slow file scan, so the port is ours for the whole inspection.
    hold ??= Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response(null, { status: 503 }) })
    const files = await inspect('/usr/sbin/lsof', { args: ['-nP', '-d', 'cwd,txt', '-Fpn'] })
    if (
      files.error === undefined && files.exitCode === 0
      && !files.stdout.split(/\r?\n/).some(line =>
        line.startsWith('n') && FS.pathIsWithin(line.slice(1).replace(/ \(deleted\)$/, ''), root)
      )
    ) {
      return hold
    }
  } catch {
    // Treated as unproved below.
  }
  hold?.stop(true)
  return undefined
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

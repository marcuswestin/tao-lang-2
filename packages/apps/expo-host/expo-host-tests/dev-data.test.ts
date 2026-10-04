import TR from '@runtime/TR'
import { CLI, Errors, FS, Platform, Repo, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  type DevDataBootstrap,
  type DevDataHost,
  DevProvider,
  resolveDevDataBootstrap,
} from '../../stdlib/@tao/data/providers/dev/Dev'
import {
  DEV_DATA_ROOT_PATH,
  devDataAppKey,
  devDataEnvironment,
  devDataManifest,
  DevDataProtocol,
} from '../expo-host-src/dev-loop/dev-data/DevDataBootstrap'
import { DevDataServer } from '../expo-host-src/dev-loop/dev-data/DevDataServer'

const schema = { entities: {}, name: 'DevNotes' } as const
const testCapability = 'test_capability_0123456789abcdef0123456789abcdef'

Describe('dev data bootstrap', () => {
  Test('keys local app data by effective ID across project moves and app renames', () => {
    const first = devDataAppKey('notes')
    const second = devDataAppKey('other-notes')

    Expect(first).toMatch(/^notes-[0-9a-f]{8}$/)
    Expect(second).toMatch(/^other-notes-[0-9a-f]{8}$/)
    Expect(first).not.toBe(second)
    Expect(devDataAppKey('notes')).toBe(first)
    Expect(devDataAppKey('odd/name')).toMatch(/^odd_name-[0-9a-f]{8}$/)
    Expect(devDataAppKey('odd/name')).not.toBe(devDataAppKey('odd:name'))
  })

  Test('writes the same fact as a manifest value and as Expo environment', () => {
    Expect(devDataManifest(4_321, 'Notes-abcdef01', testCapability)).toEqual({
      app: 'Notes-abcdef01',
      capability: testCapability,
      port: 4_321,
      protocol: 'tao-dev-data-v1',
    })
    Expect(devDataEnvironment(4_321, 'Notes-abcdef01', testCapability)).toEqual({
      TAO_DEV_DATA_APP: 'Notes-abcdef01',
      TAO_DEV_DATA_CAPABILITY: testCapability,
      TAO_DEV_DATA_PORT: '4321',
    })
    Expect(DEV_DATA_ROOT_PATH).toBe('.artifacts/user/dev-data')
  })

  Test('resolves the client bootstrap from the manifest the server wrote and the bundle host', () => {
    const manifest = devDataManifest(4_321, 'Notes-abcdef01', testCapability)
    Expect(resolveDevDataBootstrap({ bundleHost: '192.168.1.20', manifest, missingHost: 'no host' })).toEqual({
      app: 'Notes-abcdef01',
      capability: testCapability,
      kind: 'ready',
      serverUrl: 'ws://192.168.1.20:4321',
    })
    Expect(
      resolveDevDataBootstrap({ bundleHost: undefined, manifest: undefined, missingHost: 'the page names no host' }),
    )
      .toEqual({
        kind: 'missing',
        missing: [
          'the Expo manifest carries no tao-dev-data-v1 bootstrap (expo.extra.taoDevData)',
          'the page names no host',
        ],
      })
    Expect(
      resolveDevDataBootstrap({ bundleHost: 'h', manifest: { ...manifest, protocol: 'v0' }, missingHost: 'x' }).kind,
    )
      .toBe('missing')
    Expect(resolveDevDataBootstrap({ bundleHost: 'h', manifest: { ...manifest, app: '../up' }, missingHost: 'x' }).kind)
      .toBe('missing')
  })
})

// Bun can strand an in-process WebSocket dial when an unrelated concurrent test force-stops its
// own Bun.serve instance. These integration tests deliberately retain process-level concurrency
// inside their assertions, but own Bun servers and WebSocket clients serially at the file boundary.
Describe('dev data server', () => {
  ServerTest('answers the probe and refuses streams without a well-formed app key', async () => {
    const server = await DevDataServer.start({ rootDir: await mkTestDir('tao-dev-data-') })
    try {
      const denied = await fetch(`http://127.0.0.1:${server.port}${DevDataProtocol.probePath}`)
      Expect(denied.status).toBe(401)
      const probe = await fetch(
        `http://127.0.0.1:${server.port}${DevDataProtocol.probePath}?capability=${server.capability}`,
      )
      Expect(await probe.json()).toEqual({ protocol: 'tao-dev-data-v1' })

      const auth = `capability=${server.capability}`
      const badApp = await fetch(`http://127.0.0.1:${server.port}${DevDataProtocol.path}?${auth}&app=..&key=Notes`)
      Expect(badApp.status).toBe(400)
      const badKey = await fetch(`http://127.0.0.1:${server.port}${DevDataProtocol.path}?${auth}&app=Notes-1&key=..`)
      Expect(badKey.status).toBe(400)
      const notFound = await fetch(`http://127.0.0.1:${server.port}/elsewhere`)
      Expect(notFound.status).toBe(404)
    } finally {
      await server.stop()
    }
  })

  ServerTest('syncs saves between two connections and keeps apps and storage keys apart', async () => {
    const rootDir = await mkTestDir('tao-dev-data-')
    const server = await DevDataServer.start({ rootDir })
    const provider = DevProvider(() => host(server.port, 'Notes-a1b2c3d4', server.capability))
    const otherApp = DevProvider(() => host(server.port, 'Notes-ffffffff', server.capability))
    try {
      const first = provider.connect({ configuration: {}, schema, storageKey: 'Notes' })
      const second = provider.connect({ configuration: {}, schema, storageKey: 'Notes' })
      const otherKey = provider.connect({ configuration: {}, schema, storageKey: 'Other Notes' })
      const foreign = otherApp.connect({ configuration: {}, schema, storageKey: 'Notes' })
      Expect(await first.load()).toBeUndefined()
      Expect(await second.load()).toBeUndefined()
      Expect(await otherKey.load()).toBeUndefined()
      Expect(await foreign.load()).toBeUndefined()

      const received = collect(second)
      const foreignReceived = collect(foreign)
      const otherKeyReceived = collect(otherKey)
      await first.save('{"snapshot":1}')
      await waitForObserved(() => received.snapshots.includes('{"snapshot":1}'))
      Expect(received.snapshots).toEqual(['{"snapshot":1}'])
      Expect(foreignReceived.snapshots).toEqual([])
      Expect(otherKeyReceived.snapshots).toEqual([])

      // The stream is one file per app and storage key, written whole.
      Expect(await FS.readJson(FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir))).toEqual({
        format: 'tao-dev-data-state-v1',
        revision: 1,
        snapshot: '{"snapshot":1}',
      })
      Expect(await FS.exists(FS.resolvePath('Notes-ffffffff/Notes.json', rootDir))).toBe(false)

      await otherKey.save('{"other":true}')
      Expect(await FS.readJson(FS.resolvePath('Notes-a1b2c3d4/Other%20Notes.json', rootDir))).toEqual({
        format: 'tao-dev-data-state-v1',
        revision: 1,
        snapshot: '{"other":true}',
      })
      Expect(received.snapshots).toEqual(['{"snapshot":1}'])

      for (const connection of [first, second, otherKey, foreign]) {
        connection.close?.()
      }
    } finally {
      await server.stop()
    }
  })

  ServerTest('serializes independent authorities with CAS and publishes external saves and resets', async () => {
    const rootDir = await mkTestDir('tao-dev-data-authorities-')
    const firstServer = await DevDataServer.start({ rootDir })
    const secondServer = await DevDataServer.start({ rootDir })
    const first = DevProvider(() => host(firstServer.port, 'Notes-a1b2c3d4', firstServer.capability))
      .connect({ configuration: {}, schema, storageKey: 'Notes' })
    const second = DevProvider(() => host(secondServer.port, 'Notes-a1b2c3d4', secondServer.capability))
      .connect({ configuration: {}, schema, storageKey: 'Notes' })
    try {
      Expect(await first.load()).toBeUndefined()
      Expect(await second.load()).toBeUndefined()
      const raced = await Promise.allSettled([first.save('{"writer":1}'), second.save('{"writer":2}')])
      Expect(raced.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      Expect(String((raced.find(result => result.status === 'rejected') as PromiseRejectedResult).reason))
        .toContain('changed concurrently')

      // The rejection first resynchronizes the losing client, so retrying cannot overwrite from a
      // stale revision. The other authority observes the accepted write without reconnecting.
      const firstEvents = collect(first)
      await second.save('{"writer":2,"retry":true}')
      await waitForObserved(() => firstEvents.snapshots.includes('{"writer":2,"retry":true}'))
      Expect(firstEvents.snapshots.at(-1)).toBe('{"writer":2,"retry":true}')

      await second.reset?.()
      await waitForObserved(() => firstEvents.snapshots.length >= 2 && firstEvents.snapshots.at(-1) === undefined)
      Expect(firstEvents.snapshots.at(-1)).toBeUndefined()
      Expect(await FS.readJson(FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir))).toEqual({
        format: 'tao-dev-data-state-v1',
        revision: 3,
        snapshot: null,
      })
    } finally {
      first.close?.()
      second.close?.()
      await firstServer.stop()
      await secondServer.stop()
    }
  })

  ServerTest('serializes CAS and observes resets from an independent authority process', async () => {
    const rootDir = await mkTestDir('tao-dev-data-process-authority-')
    const readyPath = FS.resolvePath('child.json', rootDir)
    const stopPath = FS.resolvePath('stop', rootDir)
    const staleLockPath = FS.resolvePath('Notes-a1b2c3d4/Notes.json.lock', rootDir)
    await FS.symlink(FS.resolvePath('crashed-owner.json', rootDir), staleLockPath)
    const serverPath = Repo.resolvePath('packages/apps/expo-host/expo-host-src/dev-loop/dev-data/DevDataServer.ts')
    const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const script = `
      import { Errors, FS, Platform, Time } from ${JSON.stringify(sharedPath)}
      import { DevDataServer } from ${JSON.stringify(serverPath)}
      const root = Platform.runtimeProcess.env['TAO_DEV_DATA_PROCESS_ROOT']
      if (!root) Errors.throwUnexpected('Missing process authority root.')
      const server = await DevDataServer.start({ rootDir: root })
      await FS.writeJson(FS.resolvePath('child.json', root), {
        capability: server.capability, port: server.port,
      })
      while (!await FS.exists(FS.resolvePath('stop', root))) await Time.sleep(10)
      await server.stop()
    `
    const child = CLI.run('bun', {
      args: ['-e', script],
      env: { NODE_ENV: Platform.runtimeProcess.env['NODE_ENV'], TAO_DEV_DATA_PROCESS_ROOT: rootDir },
      stdio: 'pipe',
    })
    const parentServer = await DevDataServer.start({ rootDir })
    let parent: TR.DataConnection | undefined
    let remote: TR.DataConnection | undefined
    try {
      await waitForFile(readyPath)
      const childAuthority = await FS.readJson<{ capability: string; port: number }>(readyPath)
      parent = DevProvider(() => host(parentServer.port, 'Notes-a1b2c3d4', parentServer.capability))
        .connect({ configuration: {}, schema, storageKey: 'Notes' })
      remote = DevProvider(() => host(childAuthority.port, 'Notes-a1b2c3d4', childAuthority.capability))
        .connect({ configuration: {}, schema, storageKey: 'Notes' })
      Expect(await Promise.all([parent.load(), remote.load()])).toEqual([undefined, undefined])

      const raced = await Promise.allSettled([parent.save('{"process":"parent"}'), remote.save('{"process":"child"}')])
      Expect(raced.filter(result => result.status === 'fulfilled')).toHaveLength(1)

      const observed = collect(parent)
      await remote.reset?.()
      await waitForObserved(() => observed.snapshots.length > 0 && observed.snapshots.at(-1) === undefined)
      Expect(observed.snapshots.at(-1)).toBeUndefined()
    } finally {
      parent?.close?.()
      remote?.close?.()
      await parentServer.stop()
      await FS.writeText(stopPath, '')
      const result = await child
      Expect(result.exitCode).toBe(0)
    }
  })

  ServerTest('serves a stream saved by an earlier server and clears it on reset', async () => {
    const rootDir = await mkTestDir('tao-dev-data-')
    const earlier = await DevDataServer.start({ rootDir })
    const earlierConnection = DevProvider(() => host(earlier.port, 'Notes-a1b2c3d4', earlier.capability))
      .connect({ configuration: {}, schema, storageKey: 'Notes' })
    await earlierConnection.load()
    await earlierConnection.save('{"kept":true}')
    earlierConnection.close?.()
    await earlier.stop()

    const server = await DevDataServer.start({ rootDir })
    const provider = DevProvider(() => host(server.port, 'Notes-a1b2c3d4', server.capability))
    try {
      const first = provider.connect({ configuration: {}, schema, storageKey: 'Notes' })
      const second = provider.connect({ configuration: {}, schema, storageKey: 'Notes' })
      Expect(await first.load()).toBe('{"kept":true}')
      Expect(await second.load()).toBe('{"kept":true}')

      const received = collect(second)
      await first.reset?.()
      await waitForObserved(() => received.snapshots.length > 0 && received.snapshots.at(-1) === undefined)
      Expect(received.snapshots).toEqual([undefined])
      Expect(await FS.readJson(FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir))).toEqual({
        format: 'tao-dev-data-state-v1',
        revision: 2,
        snapshot: null,
      })
      // The resetting side reloads from what the server now holds, not from what it last saw.
      Expect(await first.load()).toBeUndefined()
      first.close?.()
      second.close?.()
    } finally {
      await server.stop()
    }
  })

  ServerTest(
    'migrates an arbitrary legacy snapshot without interpreting app fields as authority metadata',
    async () => {
      const rootDir = await mkTestDir('tao-dev-data-legacy-')
      const legacy = '{"revision":7,"snapshot":"app-owned","other":true}'
      await FS.writeText(FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir), legacy)
      const server = await DevDataServer.start({ rootDir })
      const connection = DevProvider(() => host(server.port, 'Notes-a1b2c3d4', server.capability))
        .connect({ configuration: {}, schema, storageKey: 'Notes' })
      try {
        Expect(await connection.load()).toBe(legacy)
        await connection.save('{"migrated":true}')
        Expect(await FS.readJson(FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir))).toEqual({
          format: 'tao-dev-data-state-v1',
          revision: 2,
          snapshot: '{"migrated":true}',
        })
      } finally {
        connection.close?.()
        await server.stop()
      }
    },
  )

  ServerTest('contains and reports an external refresh failure', async () => {
    const rootDir = await mkTestDir('tao-dev-data-refresh-failure-')
    const logs: string[] = []
    const server = await DevDataServer.start({ log: line => logs.push(line), rootDir })
    const connection = DevProvider(() => host(server.port, 'Notes-a1b2c3d4', server.capability))
      .connect({ configuration: {}, schema, storageKey: 'Notes' })
    try {
      Expect(await connection.load()).toBeUndefined()
      await FS.writeText(
        FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir),
        '{"format":"tao-dev-data-state-v1","revision":-1,"snapshot":null}',
      )
      const deadline = Date.now() + 30_000
      while (!logs.some(line => line.includes('invalid') || line.includes('JSON'))) {
        if (Date.now() >= deadline) {
          Errors.throwHostEnvironment('The dev data authority did not report its refresh failure.')
        }
        await Time.sleep(20)
      }
      Expect(logs.some(line => line.includes('Notes-a1b2c3d4 Notes'))).toBe(true)
    } finally {
      connection.close?.()
      await server.stop()
    }
  })

  ServerTest('rejects a save while the server is away and resumes on the server that replaces it', async () => {
    const rootDir = await mkTestDir('tao-dev-data-')
    const timers = manualTimers()
    const server = await DevDataServer.start({ rootDir })
    const port = server.port
    const provider = DevProvider(() => ({ ...host(port, 'Notes-a1b2c3d4', server.capability), timers }))
    const connection = provider.connect({ configuration: {}, schema, storageKey: 'Notes' })
    Expect(await connection.load()).toBeUndefined()
    const received = collect(connection)

    await server.stop()
    await waitForObserved(() => received.errors.length > 0)
    Expect(received.errors).toHaveLength(1)
    Expect(String((received.errors[0] as Error).message)).toContain('disconnected')
    // A write while the server is away tries once more, right now, and fails honestly.
    await Expect(connection.save('{"lost":true}')).rejects.toThrow('Could not reach the Tao dev data server')

    const replacement = await DevDataServer.start({ capability: server.capability, port, rootDir })
    try {
      timers.fire()
      await waitForObserved(() => received.snapshots.length > 0 && received.snapshots.at(-1) === undefined)
      Expect(received.snapshots).toEqual([undefined])
      await connection.save('{"found":true}')
      Expect(await FS.readJson(FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir))).toEqual({
        format: 'tao-dev-data-state-v1',
        revision: 1,
        snapshot: '{"found":true}',
      })
    } finally {
      connection.close?.()
      await replacement.stop()
    }
  })

  ServerTest('publishes Dev through the provider conformance contract', async () => {
    const server = await DevDataServer.start({ rootDir: await mkTestDir('tao-dev-data-') })
    try {
      await TR.testProvider(
        () => DevProvider(() => host(server.port, 'Conformance-00000000', server.capability)),
        () =>
          DevProvider(() => ({
            ...host(server.port, 'Conformance-00000000', server.capability),
            connect: () => rejectingSocket(),
          })),
      )
    } finally {
      await server.stop()
    }
  })

  ServerTest('names what a build lacks instead of dialing nowhere', async () => {
    const provider = DevProvider(() => ({
      bootstrap: (): DevDataBootstrap => ({ kind: 'missing', missing: ['the Expo manifest carries no bootstrap'] }),
      connect: () => Errors.throwUnexpected('must not connect'),
      timers: { clearTimeout: () => {}, setTimeout: () => 0 },
    }))

    await Expect(provider.connect({ configuration: {}, schema, storageKey: 'Notes' }).load())
      .rejects.toThrow('needs a running Tao dev server, but the Expo manifest carries no bootstrap')
  })

  // Bun 1.3.13 dial/forced-stop regression: archived DEVENV-054 records the reproduction.
  // REMOVAL CANDIDATE: drop repeated cycles once supported runners fix the dial bug and ordinary concurrent server cases stay green.
  ServerTest('repeatedly releases each in-process WebSocket before stopping its owned server', async () => {
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const server = await DevDataServer.start({ rootDir: await mkTestDir('tao-dev-data-ownership-') })
      const connection = DevProvider(() => host(server.port, 'Ownership-00000000', server.capability))
        .connect({ configuration: {}, schema, storageKey: 'Notes' })
      try {
        Expect(await connection.load()).toBeUndefined()
        await connection.save(`{"iteration":${iteration}}`)
      } finally {
        connection.close?.()
        await server.stop()
      }
    }
  })
})

let serverTestTail = Promise.resolve()

/** ServerTest gives every in-process Bun server and WebSocket test exclusive ownership until teardown finishes. */
function ServerTest(name: string, run: () => Promise<void>): void {
  Test(name, () => {
    const result = serverTestTail.then(run)
    serverTestTail = result.catch(() => undefined)
    return result
  })
}

/** host dials a real server on this machine through Bun's WebSocket, the way a device would. */
function host(port: number, app: string, capability: string): DevDataHost {
  return {
    bootstrap: () => ({ app, capability, kind: 'ready', serverUrl: `ws://127.0.0.1:${port}` }),
    connect: url => {
      const raw = new WebSocket(url)
      const wrapped: ReturnType<DevDataHost['connect']> = {
        close: () => raw.close(),
        send: text => raw.send(text),
      }
      raw.onopen = () => wrapped.onopen?.()
      raw.onmessage = event => wrapped.onmessage?.(String(event.data))
      raw.onerror = event => wrapped.onerror?.(event)
      raw.onclose = event => wrapped.onclose?.(event.reason ?? '')
      return wrapped
    },
  }
}

function rejectingSocket(): ReturnType<DevDataHost['connect']> {
  const socket: ReturnType<DevDataHost['connect']> = {
    close: () => {},
    send: () => {
      queueMicrotask(() =>
        socket.onmessage?.(JSON.stringify({ message: 'deterministic rejection', seq: 1, type: 'rejected' }))
      )
    },
  }
  queueMicrotask(() => {
    socket.onopen?.()
    socket.onmessage?.(JSON.stringify({ revision: 1, snapshot: null, type: 'snapshot' }))
  })
  return socket
}

function manualTimers(): NonNullable<DevDataHost['timers']> & { fire(): void } {
  const scheduled = new Map<number, () => void>()
  let next = 0
  return {
    clearTimeout: handle => {
      scheduled.delete(handle as number)
    },
    fire: () => {
      const callbacks = [...scheduled.values()]
      scheduled.clear()
      for (const callback of callbacks) {
        callback()
      }
    },
    setTimeout: callback => {
      next += 1
      scheduled.set(next, callback)
      return next
    },
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!await FS.isFile(path)) {
    if (Date.now() >= deadline) {
      Errors.throwHostEnvironment(`Timed out waiting for ${path}.`)
    }
    await Time.sleep(10)
  }
}

async function waitForObserved(predicate: () => boolean): Promise<void> {
  if (!await Time.pollUntil(predicate, { intervalMs: 10, timeoutMs: 30_000 })) {
    Errors.throwHostEnvironment('No expected dev data event arrived within 30s.')
  }
}

/** collect subscribes before a test action and retains all later snapshots and errors. */
function collect(connection: TR.DataConnection): {
  errors: unknown[]
  snapshots: Array<string | undefined>
} {
  const errors: unknown[] = []
  const snapshots: Array<string | undefined> = []
  connection.subscribe!({
    error: error => {
      errors.push(error)
    },
    snapshot: snapshot => {
      snapshots.push(snapshot)
    },
  })
  return { errors, snapshots }
}

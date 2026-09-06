import TR from '@runtime/TR'
import { Errors, FS } from '@shared'
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
} from '../dev-src/dev-data/DevDataBootstrap'
import { DevDataServer } from '../dev-src/dev-data/DevDataServer'

const schema = { entities: {}, name: 'DevNotes' } as const

Describe('dev data bootstrap', () => {
  Test('keys an app by its name and its project, so same-named apps in two projects stay apart', () => {
    const first = devDataAppKey('/work/first', 'Notes')
    const second = devDataAppKey('/work/second', 'Notes')

    Expect(first).toMatch(/^Notes-[0-9a-f]{8}$/)
    Expect(second).toMatch(/^Notes-[0-9a-f]{8}$/)
    Expect(first).not.toBe(second)
    Expect(devDataAppKey('/work/first', 'Notes')).toBe(first)
    Expect(devDataAppKey('/work/first', '  Odd name/with:chars')).toMatch(/^Odd_name_with_chars-[0-9a-f]{8}$/)
  })

  Test('writes the same fact as a manifest value and as Expo environment', () => {
    Expect(devDataManifest(4_321, 'Notes-abcdef01')).toEqual({
      app: 'Notes-abcdef01',
      port: 4_321,
      protocol: 'tao-dev-data-v1',
    })
    Expect(devDataEnvironment(4_321, 'Notes-abcdef01')).toEqual({
      TAO_DEV_DATA_APP: 'Notes-abcdef01',
      TAO_DEV_DATA_PORT: '4321',
    })
    Expect(DEV_DATA_ROOT_PATH).toBe('.artifacts/user/dev-data')
  })

  Test('resolves the client bootstrap from the manifest the server wrote and the bundle host', () => {
    const manifest = devDataManifest(4_321, 'Notes-abcdef01')
    Expect(resolveDevDataBootstrap({ bundleHost: '192.168.1.20', manifest, missingHost: 'no host' })).toEqual({
      app: 'Notes-abcdef01',
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

Describe('dev data server', () => {
  Test('answers the probe and refuses streams without a well-formed app key', async () => {
    const server = await DevDataServer.start({ rootDir: await mkTestDir('tao-dev-data-') })
    try {
      const probe = await fetch(`http://127.0.0.1:${server.port}${DevDataProtocol.probePath}`)
      Expect(await probe.json()).toEqual({ protocol: 'tao-dev-data-v1' })

      const badApp = await fetch(`http://127.0.0.1:${server.port}${DevDataProtocol.path}?app=..&key=Notes`)
      Expect(badApp.status).toBe(400)
      const badKey = await fetch(`http://127.0.0.1:${server.port}${DevDataProtocol.path}?app=Notes-1&key=..`)
      Expect(badKey.status).toBe(400)
      const notFound = await fetch(`http://127.0.0.1:${server.port}/elsewhere`)
      Expect(notFound.status).toBe(404)
    } finally {
      await server.stop()
    }
  })

  Test('syncs saves between two connections and keeps apps and storage keys apart', async () => {
    const rootDir = await mkTestDir('tao-dev-data-')
    const server = await DevDataServer.start({ rootDir })
    const provider = DevProvider(() => host(server.port, 'Notes-a1b2c3d4'))
    const otherApp = DevProvider(() => host(server.port, 'Notes-ffffffff'))
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
      await received.next()
      Expect(received.snapshots).toEqual(['{"snapshot":1}'])
      Expect(foreignReceived.snapshots).toEqual([])
      Expect(otherKeyReceived.snapshots).toEqual([])

      // The stream is one file per app and storage key, written whole.
      Expect(await FS.readText(FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir))).toBe('{"snapshot":1}')
      Expect(await FS.exists(FS.resolvePath('Notes-ffffffff/Notes.json', rootDir))).toBe(false)

      await otherKey.save('{"other":true}')
      Expect(await FS.readText(FS.resolvePath('Notes-a1b2c3d4/Other%20Notes.json', rootDir))).toBe('{"other":true}')
      Expect(received.snapshots).toEqual(['{"snapshot":1}'])

      for (const connection of [first, second, otherKey, foreign]) {
        connection.close?.()
      }
    } finally {
      await server.stop()
    }
  })

  Test('serves a stream saved by an earlier server and clears it on reset', async () => {
    const rootDir = await mkTestDir('tao-dev-data-')
    const earlier = await DevDataServer.start({ rootDir })
    const earlierConnection = DevProvider(() => host(earlier.port, 'Notes-a1b2c3d4'))
      .connect({ configuration: {}, schema, storageKey: 'Notes' })
    await earlierConnection.load()
    await earlierConnection.save('{"kept":true}')
    earlierConnection.close?.()
    await earlier.stop()

    const server = await DevDataServer.start({ rootDir })
    const provider = DevProvider(() => host(server.port, 'Notes-a1b2c3d4'))
    try {
      const first = provider.connect({ configuration: {}, schema, storageKey: 'Notes' })
      const second = provider.connect({ configuration: {}, schema, storageKey: 'Notes' })
      Expect(await first.load()).toBe('{"kept":true}')
      Expect(await second.load()).toBe('{"kept":true}')

      const received = collect(second)
      await first.reset?.()
      await received.next()
      Expect(received.snapshots).toEqual([undefined])
      Expect(await FS.exists(FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir))).toBe(false)
      // The resetting side reloads from what the server now holds, not from what it last saw.
      Expect(await first.load()).toBeUndefined()
      first.close?.()
      second.close?.()
    } finally {
      await server.stop()
    }
  })

  Test('rejects a save while the server is away and resumes on the server that replaces it', async () => {
    const rootDir = await mkTestDir('tao-dev-data-')
    const timers = manualTimers()
    const server = await DevDataServer.start({ rootDir })
    const port = server.port
    const provider = DevProvider(() => ({ ...host(port, 'Notes-a1b2c3d4'), timers }))
    const connection = provider.connect({ configuration: {}, schema, storageKey: 'Notes' })
    Expect(await connection.load()).toBeUndefined()
    const received = collect(connection)

    await server.stop()
    await received.next()
    Expect(received.errors).toHaveLength(1)
    Expect(String((received.errors[0] as Error).message)).toContain('disconnected')
    // A write while the server is away tries once more, right now, and fails honestly.
    await Expect(connection.save('{"lost":true}')).rejects.toThrow('Could not reach the Tao dev data server')

    const replacement = await DevDataServer.start({ port, rootDir })
    try {
      timers.fire()
      await received.next()
      Expect(received.snapshots).toEqual([undefined])
      await connection.save('{"found":true}')
      Expect(await FS.readText(FS.resolvePath('Notes-a1b2c3d4/Notes.json', rootDir))).toBe('{"found":true}')
    } finally {
      connection.close?.()
      await replacement.stop()
    }
  })

  Test('publishes Dev through the provider conformance contract', async () => {
    const server = await DevDataServer.start({ rootDir: await mkTestDir('tao-dev-data-') })
    try {
      await TR.testProvider(
        () => DevProvider(() => host(server.port, 'Conformance-00000000')),
        () => DevProvider(() => ({ ...host(server.port, 'Conformance-00000000'), connect: () => rejectingSocket() })),
      )
    } finally {
      await server.stop()
    }
  })

  Test('names what a build lacks instead of dialing nowhere', async () => {
    const provider = DevProvider(() => ({
      bootstrap: (): DevDataBootstrap => ({ kind: 'missing', missing: ['the Expo manifest carries no bootstrap'] }),
      connect: () => Errors.throwUnexpected('must not connect'),
      timers: { clearTimeout: () => {}, setTimeout: () => 0 },
    }))

    await Expect(provider.connect({ configuration: {}, schema, storageKey: 'Notes' }).load())
      .rejects.toThrow('needs a running Tao dev server, but the Expo manifest carries no bootstrap')
  })
})

/** host dials a real server on this machine through Bun's WebSocket, the way a device would. */
function host(port: number, app: string): DevDataHost {
  return {
    bootstrap: () => ({ app, kind: 'ready', serverUrl: `ws://127.0.0.1:${port}` }),
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
    // Under Bun's concurrent test runner a dial can be stranded by another test's server stopping
    // at that instant; a short bound turns that into one quick redial instead of a hung test.
    connectTimeoutMs: 1_000,
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

/** collect subscribes and lets a test await the next event the connection publishes. */
function collect(connection: TR.DataConnection): {
  errors: unknown[]
  next(): Promise<void>
  snapshots: Array<string | undefined>
} {
  const errors: unknown[] = []
  const snapshots: Array<string | undefined> = []
  let waiting: (() => void) | undefined
  const arrived = () => {
    const resolve = waiting
    waiting = undefined
    resolve?.()
  }
  connection.subscribe!({
    error: error => {
      errors.push(error)
      arrived()
    },
    snapshot: snapshot => {
      snapshots.push(snapshot)
      arrived()
    },
  })
  return {
    errors,
    next: () =>
      new Promise<void>((resolve, reject) => {
        waiting = resolve
        setTimeout(() => reject(new Errors.HostEnvironmentError('No dev data event arrived within 5s.')), 5_000)
      }),
    snapshots,
  }
}

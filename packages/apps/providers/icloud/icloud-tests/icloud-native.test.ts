import { CLI, Repo } from '@shared'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import {
  type CloudKitEvent,
  type CloudKitRecord,
  cloudKitStateFileName,
  cloudKitZonesOver,
  type TaoCloudKitNativeModule,
} from '../icloud-src/cloudkit-native'
import {
  type ICloudDocumentChangedEvent,
  iCloudDocumentsOver,
  type TaoICloudNativeModule,
} from '../icloud-src/icloud-native'
import { iCloudEntitlements, resolveContainers, resolveServices } from '../plugins/with-tao-icloud.cjs'

Describe('tao-icloud documents', () => {
  Test('reads an absent document as undefined and passes the container through', async () => {
    const native = fakeNativeModule()
    const documents = iCloudDocumentsOver(native.module)

    Expect(await documents.read(undefined, 'Notes.json')).toBeUndefined()
    await documents.write('iCloud.example', 'Notes.json', '{"rows":1}')
    Expect(await documents.read('iCloud.example', 'Notes.json')).toBe('{"rows":1}')
    Expect(native.calls).toEqual([
      ['readDocument', null, 'Notes.json'],
      ['writeDocument', 'iCloud.example', 'Notes.json', '{"rows":1}'],
      ['readDocument', 'iCloud.example', 'Notes.json'],
    ])
  })

  Test('routes watch events by the identifier JavaScript chose and stops the native watch once', async () => {
    const native = fakeNativeModule()
    const documents = iCloudDocumentsOver(native.module)
    const changes: Array<string | undefined> = []
    const failures: string[] = []
    const stop = documents.watch(undefined, 'Notes.json', {
      changed: contents => changes.push(contents),
      failed: message => failures.push(message),
    })
    const watchId = native.watches[0]!
    native.emit({ contents: 'first', watchId })
    native.emit({ contents: 'other', watchId: 'someone-else' })
    native.emit({ contents: null, watchId })
    native.emit({ error: 'offline', watchId })
    stop()
    stop()
    native.emit({ contents: 'after stop', watchId })
    await Promise.resolve()

    Expect(changes).toEqual(['first', undefined])
    Expect(failures).toEqual(['offline'])
    Expect(native.stopped).toEqual([watchId])
    Expect(native.listeners).toBe(0)
  })

  Test('reports a watch that could not start as a failure', async () => {
    const native = fakeNativeModule({ startFailure: 'iCloud is unavailable' })
    const failures: string[] = []
    iCloudDocumentsOver(native.module).watch(undefined, 'Notes.json', {
      changed: () => undefined,
      failed: message => failures.push(message),
    })
    await Promise.resolve()
    await Promise.resolve()

    Expect(failures).toEqual(['iCloud is unavailable'])
  })
})

Describe('tao-icloud CloudKit zones', () => {
  Test('starts one session per zone, routes its events, and classifies native failures', async () => {
    const native = fakeCloudKitModule()
    const zones = cloudKitZonesOver(native.module)
    const zone = zones('iCloud.example', 'Notes')
    const fetched: unknown[] = []
    const sent: unknown[] = []
    const failures: string[] = []
    const stop = zone.subscribe({
      accountChanged: message => failures.push(`account: ${message}`),
      failed: message => failures.push(message),
      fetched: (modifications, deletions, acknowledge) => {
        fetched.push([modifications, deletions])
        void acknowledge()
      },
      sent: (savedRecords, conflicts, recordFailures) => sent.push([savedRecords, conflicts, recordFailures]),
      zoneReset: () => failures.push('zone reset'),
    })
    const record: CloudKitRecord = {
      fields: { Title: 'Hello', Title__stamp: '1' },
      name: 'a:Note:Note-1',
      type: 'Note',
    }
    await zone.send([record])
    await zone.fetch()
    await Promise.resolve()
    const sessionId = native.started[0]!.sessionId

    native.emit({ batchId: 'batch-1', kind: 'fetched', modifications: [record], deletions: ['gone'], sessionId })
    native.emit({ kind: 'sent', savedRecords: [record], sessionId })
    native.emit({ kind: 'fetched', modifications: [record], sessionId: 'someone-else' })
    native.emit({ kind: 'zoneDeleted', sessionId })
    native.emit({ kind: 'accountChanged', message: 'signed out', sessionId })
    native.emit({ kind: 'failed', message: 'zone could not be created', sessionId })
    stop()
    native.emit({ kind: 'fetched', modifications: [record], sessionId })
    zone.close()
    zone.close()
    await Promise.resolve()
    await Promise.resolve()

    Expect(native.started).toEqual([{
      container: 'iCloud.example',
      sessionId,
      stateFileName: cloudKitStateFileName('iCloud.example', 'Notes'),
      zoneName: 'Notes',
    }])
    Expect(native.replayed).toEqual([sessionId])
    Expect(native.sends).toEqual([[sessionId, [record]]])
    Expect(native.fetches).toEqual([sessionId])
    Expect(native.acknowledged).toEqual([[sessionId, 'batch-1']])
    Expect(fetched).toEqual([[[record], ['gone']]])
    Expect(sent).toEqual([[[record], [], []]])
    Expect(failures).toEqual(['zone reset', 'account: signed out', 'zone could not be created'])
    Expect(native.stopped).toEqual([sessionId])

    const failing = cloudKitZonesOver(fakeCloudKitModule({ sendFailure: 'quota exceeded' }).module)(
      'iCloud.example',
      'Notes',
    )
    await Expect(failing.send([record])).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
  })

  Test('subscribes before replaying the durable inbox and distinguishes structural state identities', async () => {
    const native = fakeCloudKitModule({ replayBatch: 'durable-batch' })
    const zone = cloudKitZonesOver(native.module)('a.b', 'c')
    const batches: string[] = []
    zone.subscribe({
      accountChanged: () => undefined,
      failed: () => undefined,
      fetched: (_modifications, _deletions, acknowledge) => {
        batches.push('fetched')
        void acknowledge()
      },
      sent: () => undefined,
      zoneReset: () => undefined,
    })
    await Promise.resolve()
    await Promise.resolve()

    Expect(batches).toEqual(['fetched'])
    Expect(native.order).toEqual(['listener', 'start', 'replay'])
    Expect(native.acknowledged).toEqual([[native.started[0]!.sessionId, 'durable-batch']])
    Expect(cloudKitStateFileName('a.b', 'c')).not.toBe(cloudKitStateFileName('a', 'b.c'))
  })

  Test('replays and derives non-aliasing state identities in independent processes', async () => {
    const modulePath = Repo.resolvePath('packages/apps/providers/icloud/icloud-src/cloudkit-native.ts')
    const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const run = async (container: string, zoneName: string) => {
      const script = `
        import { cloudKitStateFileName, cloudKitZonesOver } from ${JSON.stringify(modulePath)}
        import { HCI } from ${JSON.stringify(sharedPath)}
        let listener = () => {}
        let sessionId = ''
        const batches = []
        const native = {
          acknowledgeFetched: async () => {},
          addListener: (_name, next) => { listener = next; return { remove() {} } },
          fetchChanges: async () => {},
          replayInbox: async id => listener({ batchId: 'durable', kind: 'fetched', sessionId: id }),
          sendChanges: async () => {},
          start: async id => {
            sessionId = id
            listener({ batchId: 'early', kind: 'fetched', sessionId: id })
          },
          stop: async () => {},
        }
        const zone = cloudKitZonesOver(native)(${JSON.stringify(container)}, ${JSON.stringify(zoneName)})
        zone.subscribe({
          accountChanged() {}, failed() {}, sent() {}, zoneReset() {},
          fetched(_modifications, _deletions, acknowledge) { batches.push('fetched'); void acknowledge() },
        })
        await Promise.resolve()
        await Promise.resolve()
        HCI.writeLine(JSON.stringify({ batches, sessionId, state: cloudKitStateFileName(${JSON.stringify(container)}, ${
        JSON.stringify(zoneName)
      }) }))
      `
      const result = await CLI.run('bun', { args: ['-e', script], stdio: 'pipe' })
      Expect(result.exitCode).toBe(0)
      return JSON.parse(result.stdout) as { batches: string[]; sessionId: string; state: string }
    }

    const [left, right] = await Promise.all([run('a.b', 'c'), run('a', 'b.c')])
    Expect(left.batches).toEqual(['fetched', 'fetched'])
    Expect(right.batches).toEqual(['fetched', 'fetched'])
    // Process-local session ids may repeat; the durable state identities must not.
    Expect(left.sessionId).toBe(right.sessionId)
    Expect(left.state).not.toBe(right.state)
  })
})

Describe('tao-icloud config plugin', () => {
  Test('resolves the conventional app.plugin subpath through Expo’s actual resolver', async () => {
    const packageRoot = Repo.resolvePath('packages/apps/providers/icloud')
    const expoPackage = Repo.resolvePath('packages/apps/providers/icloud/node_modules/expo/package.json')
    const script = `
      const { createRequire } = require('node:module')
      const expoRequire = createRequire(require.resolve(${JSON.stringify(expoPackage)}))
      const { resolveConfigPluginFunction } = expoRequire('@expo/config-plugins/build/utils/plugin-resolver')
      const plugin = resolveConfigPluginFunction(${JSON.stringify(packageRoot)}, 'tao-icloud')
    `
    const result = await CLI.run('node', { args: ['-e', script], stdio: 'pipe' })
    Expect(result.exitCode).toBe(0)
  })

  Test('derives the default container from the bundle identifier', () => {
    Expect(resolveContainers(undefined, 'lang.tao.notes')).toEqual(['iCloud.lang.tao.notes'])
    Expect(resolveContainers(['iCloud.custom', 'iCloud.custom'], 'lang.tao.notes')).toEqual(['iCloud.custom'])
    Expect(() => resolveContainers(undefined, undefined)).toThrow('bundle identifier')
  })

  Test('defaults to the Documents service and keeps only known services', () => {
    Expect(resolveServices(undefined)).toEqual(['CloudDocuments'])
    Expect(resolveServices(['CloudKit', 'Bogus', 'CloudKit'])).toEqual(['CloudKit'])
  })

  Test('merges the iCloud Documents entitlements without dropping existing ones', () => {
    const entitlements = iCloudEntitlements(
      {
        'aps-environment': 'production',
        'com.apple.developer.icloud-services': ['CloudKit'],
      },
      ['iCloud.lang.tao.notes'],
    )

    Expect(entitlements).toEqual({
      'aps-environment': 'production',
      'com.apple.developer.icloud-container-identifiers': ['iCloud.lang.tao.notes'],
      'com.apple.developer.icloud-services': ['CloudKit', 'CloudDocuments'],
      'com.apple.developer.ubiquity-container-identifiers': ['iCloud.lang.tao.notes'],
    })
  })

  Test('grants CloudKit without the ubiquity container the Documents service needs', () => {
    Expect(iCloudEntitlements({}, ['iCloud.lang.tao.kitchen'], ['CloudKit'])).toEqual({
      'com.apple.developer.icloud-container-identifiers': ['iCloud.lang.tao.kitchen'],
      'com.apple.developer.icloud-services': ['CloudKit'],
    })
  })

  Test('grants document ubiquity only to containers mounted by the Documents provider', () => {
    Expect(
      iCloudEntitlements(
        {},
        ['iCloud.lang.tao.documents', 'iCloud.lang.tao.records'],
        ['CloudDocuments', 'CloudKit'],
        ['iCloud.lang.tao.documents'],
      ),
    ).toEqual({
      'com.apple.developer.icloud-container-identifiers': [
        'iCloud.lang.tao.documents',
        'iCloud.lang.tao.records',
      ],
      'com.apple.developer.icloud-services': ['CloudDocuments', 'CloudKit'],
      'com.apple.developer.ubiquity-container-identifiers': ['iCloud.lang.tao.documents'],
    })
  })
})

function fakeCloudKitModule(options: { replayBatch?: string; sendFailure?: string } = {}): {
  acknowledged: unknown[][]
  emit(event: CloudKitEvent): void
  fetches: string[]
  module: TaoCloudKitNativeModule
  order: string[]
  replayed: string[]
  sends: unknown[][]
  started: Array<{ container: string | null; sessionId: string; stateFileName: string; zoneName: string }>
  stopped: string[]
} {
  const listeners = new Set<(event: CloudKitEvent) => void>()
  const state = {
    acknowledged: [] as unknown[][],
    fetches: [] as string[],
    order: [] as string[],
    replayed: [] as string[],
    sends: [] as unknown[][],
    started: [] as Array<{ container: string | null; sessionId: string; stateFileName: string; zoneName: string }>,
    stopped: [] as string[],
  }
  const module: TaoCloudKitNativeModule = {
    acknowledgeFetched: async (sessionId, batchId) => {
      state.acknowledged.push([sessionId, batchId])
    },
    addListener: (_event, listener) => {
      state.order.push('listener')
      listeners.add(listener)
      return { remove: () => listeners.delete(listener) }
    },
    fetchChanges: async sessionId => {
      state.fetches.push(sessionId)
    },
    replayInbox: async sessionId => {
      state.order.push('replay')
      state.replayed.push(sessionId)
      if (options.replayBatch !== undefined) {
        for (const listener of [...listeners]) {
          listener({ batchId: options.replayBatch, kind: 'fetched', sessionId })
        }
      }
    },
    sendChanges: async (sessionId, records) => {
      if (options.sendFailure !== undefined) {
        throw new FakeNativeError(options.sendFailure)
      }
      state.sends.push([sessionId, records])
    },
    start: async (sessionId, container, zoneName, stateFileName) => {
      state.order.push('start')
      state.started.push({ container, sessionId, stateFileName, zoneName })
    },
    stop: async sessionId => {
      state.stopped.push(sessionId)
    },
  }
  return {
    acknowledged: state.acknowledged,
    emit: event => {
      for (const listener of [...listeners]) {
        listener(event)
      }
    },
    fetches: state.fetches,
    module,
    order: state.order,
    replayed: state.replayed,
    sends: state.sends,
    started: state.started,
    stopped: state.stopped,
  }
}

function fakeNativeModule(options: { startFailure?: string } = {}): {
  calls: unknown[][]
  emit(event: ICloudDocumentChangedEvent): void
  listeners: number
  module: TaoICloudNativeModule
  stopped: string[]
  watches: string[]
} {
  const documents = new Map<string, string>()
  const listeners = new Set<(event: ICloudDocumentChangedEvent) => void>()
  const state = { calls: [] as unknown[][], stopped: [] as string[], watches: [] as string[] }
  const key = (container: string | null, name: string): string => `${container ?? ''}/${name}`
  const module: TaoICloudNativeModule = {
    addListener: (_event, listener) => {
      listeners.add(listener)
      return { remove: () => listeners.delete(listener) }
    },
    readDocument: async (container, name) => {
      state.calls.push(['readDocument', container, name])
      return documents.get(key(container, name)) ?? null
    },
    startWatching: async (watchId, container, name) => {
      state.calls.push(['startWatching', watchId, container, name])
      if (options.startFailure !== undefined) {
        throw new FakeNativeError(options.startFailure)
      }
      state.watches.push(watchId)
    },
    stopWatching: async watchId => {
      state.stopped.push(watchId)
    },
    writeDocument: async (container, name, contents) => {
      state.calls.push(['writeDocument', container, name, contents])
      documents.set(key(container, name), contents)
    },
  }
  return {
    get calls() {
      return state.calls
    },
    emit: event => {
      for (const listener of [...listeners]) {
        listener(event)
      }
    },
    get listeners() {
      return listeners.size
    },
    module,
    get stopped() {
      return state.stopped
    },
    get watches() {
      return state.watches
    },
  }
}

/** FakeNativeError stands in for the plain error object a rejected native call hands JavaScript. */
class FakeNativeError extends Error {}

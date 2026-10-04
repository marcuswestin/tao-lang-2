import { Errors, FS, Switch } from '@shared'
import { Deferred, Expect, mkTestDir, Test } from '@shared/test'
import { DevRuntime } from '../expo-host-src/dev-loop/DevRuntime'
import {
  createManagedRuntimePreparation,
  managedLoopIdentityMarker,
} from '../expo-host-src/ManagedLoopIdentityMarker'

const publication = {
  session: 'session',
  checkout: '/checkout',
  loopGeneration: 'generation',
  projectRoot: '/project',
  appName: 'App',
  sourceRevision: 'source',
  compiledRevision: 'compiled',
  nonce: 'nonce',
}

Test('managed native preparation excludes production, other platforms and incomplete publications', async () => {
  let resolutions = 0
  let hides = 0
  const prepare = createManagedRuntimePreparation()
  const options = {
    development: true,
    platform: 'android',
    publication,
    resolveNativeMenu: () => {
      resolutions++
      return {
        hideMenu: async () => {
          hides++
        },
      }
    },
    onFailure: () => Errors.throwUnexpected('No native action should occur.'),
  }
  await prepare({ ...options, development: false })
  await prepare({ ...options, platform: 'ios' })
  await prepare({ ...options, platform: 'web' })
  for (const invalid of [null, {}, ...Object.keys(publication).map(field => ({ ...publication, [field]: '' }))]) {
    await prepare({ ...options, publication: invalid })
  }
  await prepare({ ...options, publication: Object.create(publication) })
  Expect(resolutions).toBe(0)
  Expect(hides).toBe(0)
  await prepare(options)
  Expect(hides).toBe(1)
})

Test('mounted preparation latches before async native work and repeats only for a new publication', async () => {
  let hides = 0
  const pending = Deferred()
  const prepare = createManagedRuntimePreparation()
  const options = {
    development: true,
    platform: 'android',
    publication,
    resolveNativeMenu: () => ({
      hideMenu: () => {
        hides++
        return pending.promise
      },
    }),
    onFailure: () => Errors.throwUnexpected('Native preparation should succeed.'),
  }
  const first = prepare(options)
  const repeated = prepare({ ...options, publication: { ...publication } })
  try {
    Expect(hides).toBe(1)
  } finally {
    pending.resolve()
    await Promise.all([first, repeated])
  }
  await prepare(options)
  Expect(hides).toBe(1)
  await prepare({ ...options, publication: { ...publication, nonce: 'next-mounted-publication' } })
  Expect(hides).toBe(2)
})

Test('optional native menu absence and async failure never retry or change managed identity', async () => {
  const failure = new Errors.HostEnvironmentError('Native menu initialization unavailable')
  const failures: unknown[] = []
  let hides = 0
  for (
    const menu of [null, {}, {
      hideMenu: async () => {
        hides++
        throw failure
      },
    }]
  ) {
    const prepare = createManagedRuntimePreparation()
    const options = {
      development: true,
      platform: 'android',
      publication,
      resolveNativeMenu: () => menu,
      onFailure: (error: unknown): void | Promise<void> => {
        failures.push(error)
      },
    }
    await prepare(options)
    await prepare(options)
  }
  Expect(hides).toBe(1)
  Expect(failures).toEqual([failure])
  Expect(publication.nonce).toBe('nonce')
})

for (const reporting of ['throw', 'reject', 'pending'] as const) {
  Test(`native preparation contains ${reporting} reporting without retrying or waiting`, async () => {
    const nativeFailure = new Errors.HostEnvironmentError('Native menu unavailable')
    const reporterFailure = new Errors.HostEnvironmentError('Warning unavailable')
    const pending = Deferred<void>()
    let hides = 0
    const reported: unknown[] = []
    const prepare = createManagedRuntimePreparation()
    const options = {
      development: true,
      platform: 'android',
      publication,
      resolveNativeMenu: () => ({
        hideMenu: async () => {
          hides++
          throw nativeFailure
        },
      }),
      onFailure: (error: unknown) => {
        reported.push(error)
        return Switch<typeof reporting, void | Promise<void>>(reporting, {
          throw: () => {
            throw reporterFailure
          },
          reject: () => Promise.reject(reporterFailure),
          pending: () => pending.promise,
        })
      },
    }
    try {
      await prepare(options)
      await prepare(options)
      Expect(hides).toBe(1)
      Expect(reported).toEqual([nativeFailure])
    } finally {
      pending.resolve()
    }
  })
}

Test('projected Expo entry resolves its mounted identity helper inside the generated runtime', async () => {
  const project = await mkTestDir('managed-marker-projection')
  try {
    const runtime = await DevRuntime.prepare(project)
    const index = await FS.readText(FS.resolvePath('index.ts', runtime.root))
    Expect(index).toContain('const prepareManagedRuntime = useMemo(createManagedRuntimePreparation, [])')
    Expect(index).toContain('useEffect(() => {\n    void prepareManagedRuntime({')
    Expect(index).toContain("requireOptionalNativeModule<{ hideMenu?: () => Promise<void> }>('ExpoDevMenu')")
    const helperImport = index.match(/from ['"](.+ManagedLoopIdentityMarker)['"]/u)?.[1]
    Expect(helperImport).toBe('./expo-host-src/ManagedLoopIdentityMarker')
    const helperPath = FS.resolvePath(`${helperImport}.ts`, runtime.root)
    Expect(await FS.isFile(helperPath)).toBe(true)
    const helper = await import(helperPath) as { managedLoopIdentityMarker: typeof managedLoopIdentityMarker }
    const marker = helper.managedLoopIdentityMarker({ nonce: 'projected-nonce' }, 'http://localhost/index.bundle')
    Expect(JSON.parse(decodeURIComponent(marker.testID.slice('tao-managed-loop-identity.'.length)))).toEqual({
      nonce: 'projected-nonce',
      devUrl: 'http://localhost/index.bundle',
    })
    Expect(marker.accessible).toBe(false)
  } finally {
    await FS.remove(project)
  }
})

Test('mounted identity uses a native identifier without focus, announcement, or visible diagnostic text', () => {
  const identity = { nonce: 'session secret', checkout: '/checkout', projectRoot: '/app', sourceRevision: 'source' }
  const props = managedLoopIdentityMarker(identity, 'http://127.0.0.1:8081/index.bundle')
  Expect(props.accessible).toBe(false)
  Expect(props.focusable).toBe(false)
  Expect(props.collapsable).toBe(false)
  Expect('accessibilityLabel' in props).toBe(false)
  Expect('children' in props).toBe(false)
  const prefix = 'tao-managed-loop-identity.'
  Expect(JSON.parse(decodeURIComponent(props.testID.slice(prefix.length)))).toEqual({
    ...identity,
    devUrl: 'http://127.0.0.1:8081/index.bundle',
  })
})

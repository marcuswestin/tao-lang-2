import type { HostSession, HostTarget } from '@host-control'
import { Errors, FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { runManagedFirebaseFixture } from '../native/ManagedFirebaseFixture'
import { createManagedMobileGrant } from '../native/ManagedMobileGrant'

for (const account of ['created', 'existing-account-signin'] as const) {
  Test(`Firebase fixture proves same-CRUD sync before ${account} main account gate`, async () => {
    const root = await mkTestDir('managed-firebase-')
    try {
      const fixture = setup(account, root)
      const evidence = await runManagedFirebaseFixture(fixture.options)
      Expect(evidence.accounts).toEqual([
        { surface: 'web', sample: 'crud', result: account },
        { surface: 'ios', sample: 'crud', result: 'signed-in' },
        { surface: 'ios', sample: 'main', result: account },
        { surface: 'web', sample: 'main', result: 'signed-in' },
      ])
      Expect(evidence.observations).toEqual([
        { surface: 'web', marker: evidence.nativeMarker, text: evidence.nativeMarker },
        { surface: 'ios', marker: evidence.webMarker, text: evidence.webMarker },
      ])
      Expect(fixture.events).toEqual([
        'web-signup',
        'fillCrudAccount',
        'signIn',
        'native-type',
        'addItem',
        'web-observe-native',
        'web-create',
        'signOut',
        'fillMainAccount',
        'createAccount',
        ...(account === 'created' ? [] : ['signIn']),
        'web-signin-main',
        'web-close',
      ])
      Expect(evidence.screenshots.length).toBe(6)
      const sync = FS.resolvePath('firebase-crud-sync.json', root)
      Expect(await FS.fileMode(sync)).toBe(0o600)
      Expect(await FS.readJson(sync)).toEqual({
        version: 1,
        classification: 'firebase-crud-sync',
        status: 'proved',
        accounts: evidence.accounts.slice(0, 2),
        nativeMarker: evidence.nativeMarker,
        webMarker: evidence.webMarker,
        observations: evidence.observations,
        screenshots: evidence.screenshots.slice(0, 4),
      })
      Expect(await FS.exists(FS.resolvePath('firebase-main-account-gate.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
}

Test('Firebase fixture rejects a wrong native row and still closes the borrowed browser attachment', async () => {
  const root = await mkTestDir('managed-firebase-wrong-row-')
  try {
    const fixture = setup('created', root, { wrongRow: true })
    await Expect(runManagedFirebaseFixture(fixture.options)).rejects.toThrow('exactly match')
    Expect(fixture.events.at(-1)).toBe('web-close')
    Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
  } finally {
    await FS.remove(root)
  }
})

Test('Firebase fixture retains proved CRUD sync while rejected main account keeps the case failed', async () => {
  const root = await mkTestDir('managed-firebase-main-rejected-')
  try {
    const fixture = setup('existing-account-signin', root, { rejectMainSignin: true })
    await Expect(runManagedFirebaseFixture(fixture.options)).rejects.toThrow('native-main-signin gate failed')
    Expect(fixture.events).not.toContain('web-signin-main')
    const sync = await FS.readJson(FS.resolvePath('firebase-crud-sync.json', root)) as {
      observations: { marker: string; text: string }[]
      status: string
    }
    Expect(sync.status).toBe('proved')
    Expect(sync.observations.length).toBe(2)
    Expect(sync.observations.every(row => row.marker === row.text)).toBe(true)
    const gate = FS.resolvePath('firebase-main-account-gate.json', root)
    Expect(await FS.fileMode(gate)).toBe(0o600)
    Expect(await FS.readJson(gate)).toEqual({
      version: 1,
      classification: 'firebase-main-account-gate',
      status: 'failed',
      stage: 'native-main-signin',
    })
    Expect(await FS.readText(gate)).not.toContain('private-token')
  } finally {
    await FS.remove(root)
  }
})

Test('Firebase fixture retains proved CRUD sync when the web main account gate fails', async () => {
  const root = await mkTestDir('managed-firebase-web-main-rejected-')
  try {
    const fixture = setup('created', root, { rejectWebMainSignin: true })
    await Expect(runManagedFirebaseFixture(fixture.options)).rejects.toThrow('web-main-signin gate failed')
    Expect(await FS.isFile(FS.resolvePath('firebase-crud-sync.json', root))).toBe(true)
    Expect(await FS.readJson(FS.resolvePath('firebase-main-account-gate.json', root))).toEqual({
      version: 1,
      classification: 'firebase-main-account-gate',
      status: 'failed',
      stage: 'web-main-signin',
    })
  } finally {
    await FS.remove(root)
  }
})

Test('Firebase fixture writes no sync proof after native ownership revocation', async () => {
  const root = await mkTestDir('managed-firebase-revoked-')
  try {
    const fixture = setup('created', root, { revokeBeforeSyncArtifact: true })
    await Expect(runManagedFirebaseFixture(fixture.options)).rejects.toThrow('revoked')
    Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
    Expect(await FS.exists(FS.resolvePath('firebase-main-account-gate.json', root))).toBe(false)
  } finally {
    await FS.remove(root)
  }
})

Test(
  'Firebase fixture refuses a different application before attaching or performing sample-account input',
  async () => {
    const root = await mkTestDir('managed-firebase-wrong-app-')
    try {
      const fixture = setup('created', root, { appName: 'OtherApp' })
      await Expect(runManagedFirebaseFixture(fixture.options)).rejects.toThrow('FirebaseLiveAcceptance')
      Expect(fixture.events).toEqual([])
    } finally {
      await FS.remove(root)
    }
  },
)

function setup(account: 'created' | 'existing-account-signin', artifactRoot: string, fault: {
  wrongRow?: boolean
  rejectMainSignin?: boolean
  rejectWebMainSignin?: boolean
  revokeBeforeSyncArtifact?: boolean
  appName?: string
} = {}) {
  const events: string[] = []
  const revision = { build: 'compiled', source: 'source' }
  const lease = { generation: 'generation', name: 'owned-ios' }
  const grant = createManagedMobileGrant({
    identity: {
      session: '12345678-1234-1234-1234-123456789abc',
      checkout: '/checkout',
      loopGeneration: 'generation',
      target: { platform: 'ios', id: 'owned-sim' },
      resources: [{ name: 'owned-ios', generation: 'generation' }],
      runtime: {
        session: '12345678-1234-1234-1234-123456789abc',
        checkout: '/checkout',
        loopGeneration: 'generation',
        kind: 'companion',
        appId: 'owned.app',
        devUrl: 'taostudiocompanion://dev',
        projectRoot: '/checkout/fresh',
        appName: fault.appName ?? 'FirebaseLiveAcceptance',
        sourceRevision: 'source',
        compiledRevision: 'compiled',
        nonce: 'mounted',
      },
    },
    assertOwnerCurrent: async () => {},
    assertLoopCurrent: async () => {},
  })
  grant.bindRuntimeObserver(async () => {})
  let phase: 'gate' | 'existing' | 'items' = 'gate'
  let sample: 'crud' | 'main' = 'crud'
  let typed = ''
  let nativeMarker = ''
  let webMarker = ''
  const session: HostSession = {
    descriptor: () => ({
      version: 1,
      id: 'driver',
      target: 'owned-sim',
      mode: 'acceptance',
      driver: 'fixture',
      revision,
      lease,
      capabilities: ['inspect', 'textInput', 'pointer', 'screenshot'],
    }),
    observe: async ({ target }) => {
      const value = tag(target)
      const input = target.kind === 'scoped' && tag(target.scope) === 'itemTitle'
      const row = target.kind === 'scoped' && tag(target.scope) === 'items'
      if ((input && phase !== 'items') || (target.kind === 'text' && phase !== 'existing')) {
        Errors.throwHostEnvironment('Expected fixture control is not present.')
      }
      return {
        version: 1,
        id: value ?? 'control',
        sessionId: 'driver',
        lease,
        revision,
        observationRevision: 1,
        target,
        timestamp: 'observed',
        visible: value !== 'signOut' || phase === 'items',
        ...(row ? { text: fault.wrongRow ? 'different row' : webMarker } : {}),
      }
    },
    perform: async action => {
      await grant.assertCurrent()
      if (action.kind === 'type') {
        typed = action.text
        events.push('native-type')
      } else if (action.kind === 'click') {
        const value = tag(action.observation.target)!
        events.push(value)
        if (value === 'fillCrudAccount') {
          sample = 'crud'
        }
        if (value === 'fillMainAccount') {
          sample = 'main'
        }
        if (value === 'signOut') {
          phase = 'gate'
        }
        if (value === 'createAccount') {
          phase = account === 'created' ? 'items' : 'existing'
        }
        if (value === 'signIn') {
          if (sample === 'main' && fault.rejectMainSignin) {
            Errors.throwHostEnvironment('Rejected password private-token')
          }
          phase = 'items'
        }
        if (value === 'addItem') {
          nativeMarker = typed
        }
      } else {
        Errors.throwUnexpected('The fixed Firebase fixture performed an unexpected action.')
      }
      return { version: 1, action: action.kind, sessionId: 'driver', lease, revision, observationRevision: 1 }
    },
    captureScreenshot: async name => {
      if (name === 'firebase-web-to-native' && fault.revokeBeforeSyncArtifact) {
        grant.revokeInput()
      }
      return {
        version: 1,
        sessionId: 'driver',
        revision,
        observationRevision: 1,
        artifactPath: `${name}.png`,
      }
    },
    close: async () => {},
    publishRevision: async () => {},
  }
  return {
    events,
    options: {
      grant,
      session,
      artifactRoot,
      openWeb: async () => ({
        createCrudAccount: async () => {
          events.push('web-signup')
          return account
        },
        signInMainAccount: async () => {
          events.push('web-signin-main')
          if (fault.rejectWebMainSignin) {
            Errors.throwHostEnvironment('Rejected web password private-token')
          }
        },
        createItem: async (marker: string) => {
          events.push('web-create')
          webMarker = marker
        },
        observeItem: async (marker: string) => {
          events.push('web-observe-native')
          Expect(marker).toBe(nativeMarker)
          return nativeMarker
        },
        screenshot: async (name: string) => `${name}.png`,
        close: async () => {
          events.push('web-close')
        },
      }),
    },
  }
}

function tag(target: HostTarget): string | undefined {
  return target.kind === 'tag' ? target.value : undefined
}

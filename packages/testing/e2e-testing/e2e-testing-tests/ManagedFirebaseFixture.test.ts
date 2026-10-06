import { HostControlError, type HostSession, type HostTarget } from '@host-control'
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

Test('Firebase fixture observes a row below the fold and returns to sign-out before switching accounts', async () => {
  const root = await mkTestDir('managed-firebase-scroll-')
  try {
    const fixture = setup('created', root, { rowBelowFold: true })
    const evidence = await runManagedFirebaseFixture(fixture.options)
    Expect(evidence.observations.length).toBe(2)
    Expect(fixture.events.filter(event => event.startsWith('scroll-'))).toEqual([
      'scroll-down',
      'scroll-down',
      'scroll-up',
      'scroll-up',
    ])
    Expect(fixture.events.indexOf('scroll-up')).toBeLessThan(fixture.events.indexOf('signOut'))
    Expect(await FS.isFile(FS.resolvePath('firebase-crud-sync.json', root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})

Test('Firebase fixture stops scrolling after custody revocation and publishes no sync proof', async () => {
  const root = await mkTestDir('managed-firebase-scroll-revoked-')
  try {
    const fixture = setup('created', root, { rowBelowFold: true, revokeOnScroll: true })
    await Expect(runManagedFirebaseFixture(fixture.options)).rejects.toThrow('native-observe-web-item')
    Expect(fixture.events.filter(event => event.startsWith('scroll-'))).toEqual(['scroll-down'])
    Expect(fixture.events).not.toContain('fillMainAccount')
    Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
  } finally {
    await FS.remove(root)
  }
})

Test('Firebase fixture rejects a wrong native row and still closes the borrowed browser attachment', async () => {
  const root = await mkTestDir('managed-firebase-wrong-row-')
  try {
    const fixture = setup('created', root, { wrongRow: true })
    const error = await runManagedFirebaseFixture(fixture.options).catch(error => error)
    Expect(error.message).toContain('native-observe-web-item')
    Expect(error.cause.message).toContain('exactly match')
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
    const error = await runManagedFirebaseFixture(fixture.options).catch(error => error)
    Expect(error.cause.message).toContain('revoked')
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

Test('Firebase fixture dismisses only the exact runtime tutorial before signed-in account input', async () => {
  const root = await mkTestDir('managed-firebase-tutorial-')
  try {
    const fixture = setup('created', root, { tutorial: 'matched', startSignedIn: true })
    await runManagedFirebaseFixture(fixture.options)
    Expect(fixture.events.slice(0, 6)).toEqual([
      'Continue',
      'Close',
      'signOut',
      'web-signup',
      'fillCrudAccount',
      'signIn',
    ])
    Expect(fixture.targets.slice(0, 8)).toEqual([
      { kind: 'text', value: 'Tao Runtime' },
      { kind: 'text', value: 'This is the developer menu. It gives you access to useful tools in development builds.' },
      { kind: 'accessibility', name: 'Continue' },
      { kind: 'text', value: 'Tao Runtime' },
      { kind: 'text', value: 'Reload' },
      { kind: 'text', value: 'Go home' },
      { kind: 'accessibility', name: 'Close' },
      { kind: 'text', value: "Couldn't load app data" },
    ])
  } finally {
    await FS.remove(root)
  }
})

for (
  const tutorial of [
    'partial',
    'wrong-title',
    'wrong-body',
    'wrong-button',
    'missing-button',
    'ambiguous-button',
  ] as const
) {
  Test(`Firebase fixture refuses ${tutorial} runtime tutorial without sending input`, async () => {
    const root = await mkTestDir('managed-firebase-tutorial-refused-')
    try {
      const fixture = setup('created', root, { tutorial })
      const error = await runManagedFirebaseFixture(fixture.options).catch(error => error)
      Expect(error.message).toContain('native-runtime-tutorial failed at')
      Expect(error.cause.message).toContain(tutorial === 'ambiguous-button' ? 'ambiguous' : 'tutorial')
      Expect(fixture.actions).toEqual([])
      Expect(fixture.events).toEqual(['web-close'])
      Expect(fixture.screenshots).toEqual(['firebase-native-failure'])
      Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
}

for (const revokeAfter of ['body', 'button'] as const) {
  Test(`Firebase fixture sends no tutorial input after custody revocation at ${revokeAfter}`, async () => {
    const root = await mkTestDir('managed-firebase-tutorial-revoked-')
    try {
      const fixture = setup('created', root, { tutorial: 'matched', revokeAfter })
      const error = await runManagedFirebaseFixture(fixture.options).catch(error => error)
      Expect(error.message).toContain('native-runtime-tutorial failed at')
      Expect(error.cause.message).toContain('revoked')
      Expect(fixture.actions).toEqual([])
      Expect(fixture.events).toEqual(['web-close'])
      Expect(fixture.screenshots).toEqual([])
      if (revokeAfter === 'body') {
        Expect(fixture.targets).not.toContainEqual({ kind: 'accessibility', name: 'Continue' })
      }
      Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
}

Test(
  'Firebase fixture records the data-load failure stage after tutorial dismissal without account input',
  async () => {
    const root = await mkTestDir('managed-firebase-data-failure-')
    try {
      const fixture = setup('created', root, { tutorial: 'matched', dataFailure: true, startSignedIn: true })
      const error = await runManagedFirebaseFixture(fixture.options).catch(error => error)
      Expect(error.message).toBe("Firebase native-data-load failed at exact text 'Couldn't load app data'.")
      Expect(error.cause.message).toContain('app data load failure is visible')
      Expect(fixture.events).toEqual(['Continue', 'Close', 'web-close'])
      Expect(fixture.screenshots).toEqual(['firebase-native-failure'])
      Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  },
)

for (const menu of ['partial', 'revoked-close'] as const) {
  Test(`Firebase fixture refuses ${menu} runtime menu before account input`, async () => {
    const root = await mkTestDir('managed-firebase-menu-refused-')
    try {
      const fixture = setup('created', root, { tutorial: 'matched', menu })
      const error = await runManagedFirebaseFixture(fixture.options).catch(error => error)
      Expect(error.message).toContain('native-runtime-menu failed at')
      Expect(error.cause.message).toContain(menu === 'partial' ? 'menu signature' : 'revoked')
      Expect(fixture.actions).toEqual([{ kind: 'accessibility', name: 'Continue' }])
      Expect(fixture.events).toEqual(['Continue', 'web-close'])
      Expect(fixture.targets).not.toContainEqual({ kind: 'text', value: "Couldn't load app data" })
      Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
}

for (
  const failure of [
    { control: 'signOut', stage: 'native-initial-signout', target: '#signOut' },
    { control: 'web-signup', stage: 'web-crud-signup', target: 'web CRUD sample account' },
    { control: 'fillCrudAccount', stage: 'native-crud-fill', target: '#fillCrudAccount' },
    { control: 'signIn', stage: 'native-crud-signin', target: '#signIn' },
  ] as const
) {
  Test(`Firebase fixture preserves the cause and exact ${failure.stage} target without sync proof`, async () => {
    const root = await mkTestDir('managed-firebase-stage-failure-')
    try {
      const fixture = setup('created', root, { failControl: failure.control, startSignedIn: true })
      const error = await runManagedFirebaseFixture(fixture.options).catch(error => error)
      Expect(error.message).toBe(`Firebase ${failure.stage} failed at ${failure.target}.`)
      Expect(error.message).not.toContain('private-token')
      Expect(error.cause).toBe(fixture.failure)
      Expect(fixture.screenshots).toEqual(['firebase-native-failure'])
      Expect(fixture.events.at(-1)).toBe('web-close')
      Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
}

for (const initialSignoutFailure of ['transport', 'ambiguous'] as const) {
  Test(
    `Firebase fixture refuses ${initialSignoutFailure} initial sign-out observation before account input`,
    async () => {
      const root = await mkTestDir('managed-firebase-signout-observation-failure-')
      try {
        const fixture = setup('created', root, { initialSignoutFailure })
        const error = await runManagedFirebaseFixture(fixture.options).catch(error => error)
        Expect(error.message).toBe('Firebase native-initial-signout failed at #signOut.')
        Expect(error.cause).toBe(fixture.signoutObservationFailure)
        Expect(fixture.actions).toEqual([])
        Expect(fixture.events).toEqual(['web-close'])
        Expect(fixture.screenshots).toEqual(['firebase-native-failure'])
        Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
      } finally {
        await FS.remove(root)
      }
    },
  )
}

Test('Firebase fixture names the scoped item-title stage when ownership is revoked during its read', async () => {
  const root = await mkTestDir('managed-firebase-item-title-revoked-')
  try {
    const fixture = setup('created', root, { revokeAtItemTitle: true })
    const error = await runManagedFirebaseFixture(fixture.options).catch(error => error)
    Expect(error.message).toBe("Firebase native-crud-item-title failed at #itemTitle / accessible textbox ''.")
    Expect(error.cause.message).toContain('revoked')
    Expect(fixture.events).not.toContain('native-type')
    Expect(await FS.exists(FS.resolvePath('firebase-crud-sync.json', root))).toBe(false)
  } finally {
    await FS.remove(root)
  }
})

function setup(account: 'created' | 'existing-account-signin', artifactRoot: string, fault: {
  wrongRow?: boolean
  rejectMainSignin?: boolean
  rejectWebMainSignin?: boolean
  revokeBeforeSyncArtifact?: boolean
  appName?: string
  tutorial?:
    | 'matched'
    | 'partial'
    | 'wrong-title'
    | 'wrong-body'
    | 'wrong-button'
    | 'missing-button'
    | 'ambiguous-button'
  revokeAfter?: 'body' | 'button'
  dataFailure?: boolean
  startSignedIn?: boolean
  failControl?: 'signOut' | 'web-signup' | 'fillCrudAccount' | 'signIn'
  revokeAtItemTitle?: boolean
  initialSignoutFailure?: 'transport' | 'ambiguous'
  menu?: 'partial' | 'revoked-close'
  rowBelowFold?: boolean
  revokeOnScroll?: boolean
} = {}) {
  const events: string[] = []
  const targets: HostTarget[] = []
  const actions: HostTarget[] = []
  const screenshots: string[] = []
  const failure = new Errors.HostEnvironmentError('Fixture rejected input private-token')
  const signoutObservationFailure = fault.initialSignoutFailure === 'ambiguous'
    ? new HostControlError('assertion', 'Fixture sign-out target is ambiguous.', { reason: 'ambiguous-target' })
    : new Errors.HostEnvironmentError('Fixture sign-out observation transport failed.')
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
  let phase: 'gate' | 'existing' | 'items' = fault.startSignedIn ? 'items' : 'gate'
  let runtimeOverlay: 'intro' | 'menu' | 'closed' = fault.tutorial ? 'intro' : 'closed'
  let sample: 'crud' | 'main' = 'crud'
  let typed = ''
  let nativeMarker = ''
  let webMarker = ''
  let observationRevision = 0
  let scrollPosition = 0
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
      targets.push(target)
      observationRevision += 1
      const value = tag(target)
      if (value === 'signOut' && fault.initialSignoutFailure) {
        throw signoutObservationFailure
      }
      if (value === 'signOut' && phase !== 'items') {
        throw new HostControlError('assertion', 'Fixture sign-out is absent.', { reason: 'element-not-found' })
      }
      const input = target.kind === 'scoped' && tag(target.scope) === 'itemTitle'
      const row = target.kind === 'text' && target.value === webMarker
      let text: string | undefined
      if (
        target.kind === 'text'
        && (target.value === 'Tao Runtime' || target.value.startsWith('This is the developer menu.'))
      ) {
        if (
          runtimeOverlay === 'closed'
          || (target.value !== 'Tao Runtime' && (runtimeOverlay !== 'intro' || fault.tutorial === 'partial'))
        ) {
          throw new HostControlError('assertion', 'Fixture tutorial is absent.', { reason: 'element-not-found' })
        }
        text = (target.value === 'Tao Runtime' && fault.tutorial === 'wrong-title')
            || (target.value !== 'Tao Runtime' && fault.tutorial === 'wrong-body')
          ? 'Different tutorial'
          : target.value
        if (target.value !== 'Tao Runtime' && fault.revokeAfter === 'body') {
          grant.revokeInput()
        }
      } else if (target.kind === 'accessibility' && target.name === 'Continue') {
        Expect(runtimeOverlay).toBe('intro')
        if (fault.tutorial === 'missing-button') {
          throw new HostControlError('assertion', 'Fixture tutorial button is absent.', { reason: 'element-not-found' })
        }
        if (fault.tutorial === 'ambiguous-button') {
          throw new HostControlError('assertion', 'Fixture tutorial button is ambiguous.', {
            reason: 'ambiguous-target',
          })
        }
        text = fault.tutorial === 'wrong-button' ? 'Different button' : 'Continue'
        if (fault.revokeAfter === 'button') {
          grant.revokeInput()
        }
      } else if (target.kind === 'text' && (target.value === 'Reload' || target.value === 'Go home')) {
        Expect(runtimeOverlay).toBe('menu')
        text = fault.menu === 'partial' && target.value === 'Go home' ? 'Different menu item' : target.value
      } else if (target.kind === 'accessibility' && target.name === 'Close') {
        Expect(runtimeOverlay).toBe('menu')
        text = 'Close'
        if (fault.menu === 'revoked-close') {
          grant.revokeInput()
        }
      } else if (target.kind === 'text' && target.value === "Couldn't load app data") {
        Expect(runtimeOverlay).toBe('closed')
        if (!fault.dataFailure) {
          throw new HostControlError('assertion', 'Fixture data failure is absent.', { reason: 'element-not-found' })
        }
        text = target.value
      }
      if (input && fault.revokeAtItemTitle) {
        grant.revokeInput()
      }
      if (
        (input && phase !== 'items') || (target.kind === 'text' && !row && text === undefined && phase !== 'existing')
      ) {
        Errors.throwHostEnvironment('Expected fixture control is not present.')
      }
      return {
        version: 1,
        id: value ?? 'control',
        sessionId: 'driver',
        lease,
        revision,
        observationRevision,
        target,
        timestamp: 'observed',
        visible: row
          ? !fault.rowBelowFold || scrollPosition >= 2
          : value !== 'signOut' || scrollPosition === 0,
        ...(row ? { text: fault.wrongRow ? 'different row' : webMarker } : text === undefined ? {} : { text }),
      }
    },
    perform: async action => {
      if (action.kind === 'click' || action.kind === 'type') {
        actions.push(action.observation.target)
        Expect(action.observation.observationRevision).toBe(observationRevision)
        Expect(action.expectedRevision).toEqual(revision)
        Expect(action.lease).toEqual(lease)
      }
      await grant.assertCurrent()
      if (action.kind === 'type' || (action.kind === 'click' && action.observation.target.kind === 'tag')) {
        Expect(runtimeOverlay).toBe('closed')
      }
      if (action.kind === 'type') {
        typed = action.text
        events.push('native-type')
      } else if (action.kind === 'click') {
        const target = action.observation.target
        const value = target.kind === 'accessibility' ? target.name : tag(target)!
        events.push(value)
        if (value === 'Continue') {
          Expect(runtimeOverlay).toBe('intro')
          runtimeOverlay = 'menu'
        }
        if (value === 'Close') {
          Expect(runtimeOverlay).toBe('menu')
          runtimeOverlay = 'closed'
        }
        if (value === fault.failControl) {
          throw failure
        }
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
      } else if (action.kind === 'scroll') {
        Expect(runtimeOverlay).toBe('closed')
        events.push(action.deltaY > 0 ? 'scroll-down' : 'scroll-up')
        scrollPosition = Math.max(0, scrollPosition + (action.deltaY > 0 ? 1 : -1))
        if (fault.revokeOnScroll) {
          grant.revokeInput()
        }
      } else {
        Errors.throwUnexpected('The fixed Firebase fixture performed an unexpected action.')
      }
      return { version: 1, action: action.kind, sessionId: 'driver', lease, revision, observationRevision: 1 }
    },
    captureScreenshot: async name => {
      screenshots.push(name)
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
    targets,
    actions,
    screenshots,
    failure,
    signoutObservationFailure,
    options: {
      grant,
      session,
      artifactRoot,
      openWeb: async () => ({
        createCrudAccount: async () => {
          events.push('web-signup')
          if (fault.failControl === 'web-signup') {
            throw failure
          }
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

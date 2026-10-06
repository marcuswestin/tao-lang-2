import { Errors, FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  type AppiumReceiptSink,
  type AppiumSessionReceipt,
  type AppiumWebDriverSession,
  type AppiumXcuiTestCapabilities,
  createManagedAppiumXcuiTestController,
} from '../native/appium/AppiumXcuiTestController'
import { createManagedMobileGrant } from '../native/ManagedMobileGrant'

function firebaseGrant(appName = 'FirebaseLiveAcceptance') {
  return createManagedMobileGrant({
    identity: {
      session: 'firebase-loop',
      checkout: '/checkout',
      loopGeneration: 'generation',
      target: { platform: 'ios', id: 'SIM-FIREBASE' },
      resources: [{ name: 'ios-simulator:SIM-FIREBASE', generation: 'owned' }],
      runtime: {
        session: 'firebase-loop',
        checkout: '/checkout',
        loopGeneration: 'generation',
        kind: 'companion',
        appId: 'com.devtao.studio.companion',
        devUrl: 'taostudiocompanion://dev',
        projectRoot: '/checkout/Apps/Firebase Live Acceptance',
        appName,
        sourceRevision: 'source',
        compiledRevision: 'compiled',
        nonce: 'nonce',
      },
    },
    assertOwnerCurrent: async () => {},
    assertLoopCurrent: async () => {},
  })
}

function controlledDriver() {
  let deleted = false
  let input = false
  const session: AppiumWebDriverSession = {
    id: 'driver',
    deleteSession: async () => {
      deleted = true
    },
    findElement: async () => {
      input = true
      Errors.throwUnexpected('Startup proof cannot inspect native elements.')
    },
    findElements: async () => {
      input = true
      Errors.throwUnexpected('Startup proof cannot inspect native elements.')
    },
  }
  return { session, deleted: () => deleted, input: () => input }
}

function controlledLeases() {
  return {
    acquire: async () => Errors.throwUnexpected('A managed simulator must not reacquire its target.'),
    tryAcquire: async () => ({ generation: 'port', assertCurrent: async () => {}, release: async () => {} }),
  }
}

Test('managed Firebase iOS writes startup intent before fixed launch and retains it through close', async () => {
  const root = await mkTestDir('managed-firebase-startup-')
  const grant = firebaseGrant()
  grant.bindRuntimeObserver(async () => {})
  const driver = controlledDriver()
  const receipts: AppiumSessionReceipt[] = []
  const sink: AppiumReceiptSink = {
    write: async (_path, receipt) => {
      receipts.push(receipt)
    },
  }
  const events: string[] = []
  let capabilities: AppiumXcuiTestCapabilities | undefined
  const controller = createManagedAppiumXcuiTestController({
    grant,
    client: {
      createSession: async value => {
        Expect(receipts.at(-1)?.lifecycle).toBe('opening')
        Expect(receipts.at(-1)?.startup?.bundleId).toBe(grant.identity.runtime.appId)
        capabilities = value
        events.push('create')
        return driver.session
      },
    },
    leases: controlledLeases(),
    receipts: sink,
    firebaseStartupGuard: async () => {
      await grant.assertRequestCurrent()
      events.push('guard')
    },
    target: { kind: 'simulator', udid: grant.identity.target.id, appId: grant.identity.runtime.appId },
  })
  try {
    const session = await controller.openSession({
      artifactRoot: root,
      mode: 'acceptance',
      revision: {
        source: 'source',
        build: 'compiled',
      },
      target: 'SIM-FIREBASE',
    })
    Expect(events).toEqual(['guard', 'create', 'guard'])
    Expect(capabilities).toMatchObject({
      'appium:bundleId': grant.identity.runtime.appId,
      'appium:autoLaunch': true,
      'appium:noReset': true,
      'appium:fullReset': false,
      'appium:forceAppLaunch': false,
      'appium:shouldTerminateApp': false,
      'appium:settings[respectSystemAlerts]': true,
    })
    Expect(capabilities?.['appium:autoAcceptAlerts']).toBeUndefined()
    Expect(receipts.map(receipt => receipt.lifecycle)).toEqual(['opening', 'open'])
    Expect(receipts[0]?.startup).toEqual({
      authority: 'managed-firebase-owned-simulator',
      operation: 'activate-or-launch-granted-application',
      bundleId: grant.identity.runtime.appId,
      loopSession: grant.identity.session,
      loopGeneration: grant.identity.loopGeneration,
      runtimeNonce: grant.identity.runtime.nonce,
    })
    await session.close(session.descriptor().lease)
    Expect(driver.deleted()).toBe(true)
    Expect(driver.input()).toBe(false)
    Expect(receipts.map(receipt => receipt.startup)).toEqual([
      receipts[0]!.startup,
      receipts[0]!.startup,
      receipts[0]!.startup,
    ])
  } finally {
    grant.revoke()
    await FS.remove(root)
  }
})

Test('failed Firebase startup guard refuses session creation before native input', async () => {
  const root = await mkTestDir('managed-firebase-startup-refused-')
  const grant = firebaseGrant()
  let createCalls = 0
  const receipts: AppiumSessionReceipt[] = []
  const controller = createManagedAppiumXcuiTestController({
    grant,
    client: {
      createSession: async () => {
        createCalls++
        return controlledDriver().session
      },
    },
    leases: controlledLeases(),
    receipts: {
      write: async (_path, receipt) => {
        receipts.push(receipt)
      },
    },
    firebaseStartupGuard: async () => Errors.throwHostEnvironment('Startup authority changed.'),
    target: { kind: 'simulator', udid: grant.identity.target.id, appId: grant.identity.runtime.appId },
  })
  try {
    await Expect(controller.openSession({
      artifactRoot: root,
      mode: 'acceptance',
      revision: { source: 'source', build: 'compiled' },
      target: 'SIM-FIREBASE',
    })).rejects.toThrow('Startup authority changed.')
    Expect(createCalls).toBe(0)
    Expect(receipts.map(receipt => receipt.lifecycle)).toEqual(['opening', 'failed'])
    Expect(receipts[0]?.startup?.authority).toBe('managed-firebase-owned-simulator')
  } finally {
    grant.revoke()
    await FS.remove(root)
  }
})

Test('post-creation revocation deletes the managed session without native input', async () => {
  const root = await mkTestDir('managed-firebase-revoked-')
  const grant = firebaseGrant()
  const driver = controlledDriver()
  const receipts: AppiumSessionReceipt[] = []
  const controller = createManagedAppiumXcuiTestController({
    grant,
    client: {
      createSession: async () => {
        grant.revokeInput()
        return driver.session
      },
    },
    leases: controlledLeases(),
    receipts: {
      write: async (_path, receipt) => {
        receipts.push(receipt)
      },
    },
    firebaseStartupGuard: () => grant.assertRequestCurrent(),
    target: { kind: 'simulator', udid: grant.identity.target.id, appId: grant.identity.runtime.appId },
  })
  try {
    await Expect(controller.openSession({
      artifactRoot: root,
      mode: 'acceptance',
      revision: {
        source: 'source',
        build: 'compiled',
      },
      target: 'SIM-FIREBASE',
    })).rejects.toThrow('Managed mobile interaction was revoked.')
    Expect(driver.deleted()).toBe(true)
    Expect(driver.input()).toBe(false)
    Expect(receipts.map(receipt => receipt.lifecycle)).toEqual(['opening', 'failed'])
    Expect(receipts[1]?.startup).toEqual(receipts[0]?.startup)
  } finally {
    grant.revoke()
    await FS.remove(root)
  }
})

Test('ordinary managed iOS keeps autoLaunch disabled and cannot opt another app into Firebase startup', async () => {
  const root = await mkTestDir('managed-ios-ordinary-')
  const grant = firebaseGrant('DataMVPApp')
  grant.bindRuntimeObserver(async () => {})
  const driver = controlledDriver()
  let capabilities: AppiumXcuiTestCapabilities | undefined
  const receipts: AppiumSessionReceipt[] = []
  const options = {
    grant,
    client: {
      createSession: async (value: AppiumXcuiTestCapabilities) => {
        capabilities = value
        return driver.session
      },
    },
    leases: controlledLeases(),
    receipts: {
      write: async (_path: string, receipt: AppiumSessionReceipt) => {
        receipts.push(receipt)
      },
    },
    target: { kind: 'simulator' as const, udid: grant.identity.target.id, appId: grant.identity.runtime.appId },
  }
  try {
    Expect(() => createManagedAppiumXcuiTestController({ ...options, firebaseStartupGuard: async () => {} }))
      .toThrow('granted simulator and dispatched runtime')
    const session = await createManagedAppiumXcuiTestController(options).openSession({
      artifactRoot: root,
      mode: 'acceptance',
      revision: { source: 'source', build: 'compiled' },
      target: 'SIM-FIREBASE',
    })
    Expect(capabilities?.['appium:autoLaunch']).toBe(false)
    Expect(capabilities?.['appium:settings[respectSystemAlerts]']).toBeUndefined()
    Expect(receipts[0]?.startup).toBeUndefined()
    await session.close(session.descriptor().lease)
  } finally {
    grant.revoke()
    await FS.remove(root)
  }
})

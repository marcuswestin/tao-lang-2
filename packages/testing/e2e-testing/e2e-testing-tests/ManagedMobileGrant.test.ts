import { Errors, FS, Time } from '@shared'
import { Deferred, Expect, mkTestDir, Test } from '@shared/test'
import { runManagedMobileFixture } from '../native/ManagedMobileFixture'
import {
  createManagedMobileGrant,
  type ManagedMobileGrant,
  type ManagedMobileIdentity,
  settleManagedMobileProof,
} from '../native/ManagedMobileGrant'

Test('a proof ignoring revocation exhausts a finite cleanup grace and retains its fences', async () => {
  const abort = new AbortController()
  const hung = Deferred<void>()
  const result = settleManagedMobileProof(hung.promise, abort.signal, 10).then(() => 'completed', error => {
    Expect(error.details?.retainsTargetLease).toBe(true)
    return Errors.messageOf(error)
  })
  abort.abort()
  try {
    // budget-ok: The finite guard distinguishes a cancelled hung proof from an unbounded cleanup wait.
    Expect(await Promise.race([result, Time.sleep(200).then(() => 'unbounded')])).toContain('finite grace period')
  } finally {
    hung.resolve()
    await result
  }
})

function identity(): ManagedMobileIdentity {
  return {
    session: 'session',
    checkout: '/checkout',
    loopGeneration: 'loop-1',
    target: { platform: 'android', id: 'emulator-5554' },
    resources: [{ name: 'android-avd:owned', generation: 'retained-2' }, {
      name: 'android-emulator:emulator-5554',
      generation: 'retained-2',
    }],
    runtime: {
      session: 'session',
      checkout: '/checkout',
      loopGeneration: 'loop-1',
      kind: 'companion',
      appId: 'com.devtao.studio.companion',
      devUrl: 'taostudiocompanion://dev',
      projectRoot: '/checkout/app',
      appName: 'DataMVPApp',
      sourceRevision: 'source',
      compiledRevision: 'compiled',
      nonce: 'nonce',
    },
  }
}

Test(
  'normal cleanup revokes input and diagnostics without cancelling the proof or releasing target authority',
  async () => {
    const grant = createManagedMobileGrant({
      identity: identity(),
      assertOwnerCurrent: async () => {},
      assertLoopCurrent: async () => {},
    })
    grant.bindRuntimeObserver(async () => {})
    await grant.assertCurrent()
    grant.revokeInput()
    Expect(grant.signal.aborted).toBe(true)
    Expect(grant.externalCancellationSignal.aborted).toBe(false)
    await Expect(grant.assertCurrent()).rejects.toThrow('revoked')
    await Expect(grant.assertRequestCurrent()).rejects.toThrow('revoked')
    await Expect(grant.lease.assertCurrent('loop-1')).rejects.toThrow('revoked')
    await grant.assertCleanupCurrent()
    grant.revoke()
    Expect(grant.externalCancellationSignal.aborted).toBe(true)
  },
)

function failedCreationFixture(
  grant: ManagedMobileGrant,
  root: string,
  primary: Errors.HostEnvironmentError,
  closeServer: () => Promise<void>,
  published: boolean[],
) {
  return runManagedMobileFixture({
    grant,
    artifactRoot: root,
    onDriverProcess: async () => {},
    onCleanup: async proved => {
      published.push(proved)
    },
  }, {
    startServer: async () => ({ url: 'http://127.0.0.1:4723', logs: () => '', close: closeServer }),
    resources: () => ({
      leases: {
        acquire: async () => Errors.throwUnexpected('This source fixture cannot acquire a driver resource.'),
        tryAcquire: async () => undefined,
      },
      serverReservations: () => ({
        reserve: async () => Errors.throwUnexpected('This source fixture cannot reserve a server port.'),
      }),
      releaseAfterCleanup: async () => Errors.throwUnexpected('Uncertain session creation cannot release fences.'),
    }),
    controller: () => ({
      openSession: async () => {
        throw primary
      },
      close: async () => {},
    }),
  })
}

for (const serverCleanup of ['proved', 'failed'] as const) {
  Test(
    `normal fixture ${serverCleanup} cleanup outlives cancellation grace and preserves its primary creation failure`,
    async () => {
      const root = await mkTestDir('managed-normal-cleanup-')
      const entered = Deferred<void>()
      const cleanup = Deferred<void>()
      const published: boolean[] = []
      const grant = createManagedMobileGrant({
        identity: identity(),
        assertOwnerCurrent: async () => {},
        assertLoopCurrent: async () => {},
      })
      const primary = new Errors.HostEnvironmentError('Driver creation returned no session identity.', {
        cause: new Errors.HostEnvironmentError('POST /session failed.'),
        details: { retainsTargetLease: true },
      })
      const completed = failedCreationFixture(grant, root, primary, async () => {
        entered.resolve()
        await cleanup.promise
        if (serverCleanup === 'failed') {
          Errors.throwHostEnvironment('Owned server group absence is unproved.')
        }
      }, published)
      let settled = false
      const result = settleManagedMobileProof(completed, grant.externalCancellationSignal, 10).catch(error => error)
        .finally(() => {
          settled = true
        })
      try {
        await entered.promise
        // budget-ok: Hold controlled cleanup past the deliberately injected 10ms cancellation grace.
        await Time.sleep(30)
        Expect(grant.signal.aborted).toBe(true)
        Expect(grant.externalCancellationSignal.aborted).toBe(false)
        Expect(settled).toBe(false)
        cleanup.resolve()
        const failure: unknown = await result
        Expect(failure instanceof Errors.HostEnvironmentError).toBe(true)
        if (!(failure instanceof Errors.HostEnvironmentError)) {
          Errors.throwUnexpected('Expected completed fixture cleanup failure evidence.')
        }
        Expect(failure.cause).toBe(primary)
        Expect(failure.details?.['originalFailure']).toEqual([
          { name: 'HostEnvironmentError', message: 'Driver creation returned no session identity.' },
          { name: 'HostEnvironmentError', message: 'POST /session failed.' },
        ])
        Expect(failure.details?.['driverClosed']).toBe(true)
        Expect(failure.details?.['serverClosed']).toBe(serverCleanup === 'proved')
        Expect(failure.details?.['openingRetained']).toBe(true)
        Expect(failure.details?.['driverResourcesReleased']).toBe(false)
        Expect(failure.details?.['cleanupFailures']).toEqual(
          serverCleanup === 'failed'
            ? [[{ name: 'HostEnvironmentError', message: 'Owned server group absence is unproved.' }]]
            : [],
        )
        Expect(published).toEqual([false])
      } finally {
        cleanup.resolve()
        await completed.catch(() => {})
        await FS.remove(root)
      }
    },
  )
}

Test('external cancellation bounds stuck fixture cleanup and retains fences until independent completion', async () => {
  const root = await mkTestDir('managed-external-cleanup-')
  const entered = Deferred<void>()
  const cleanup = Deferred<void>()
  const published: boolean[] = []
  const grant = createManagedMobileGrant({
    identity: identity(),
    assertOwnerCurrent: async () => {},
    assertLoopCurrent: async () => {},
  })
  const primary = new Errors.HostEnvironmentError('Driver creation returned no session identity.', {
    details: { retainsTargetLease: true },
  })
  const completed = failedCreationFixture(grant, root, primary, async () => {
    entered.resolve()
    await cleanup.promise
  }, published)
  const result = settleManagedMobileProof(completed, grant.externalCancellationSignal, 10).catch(error => error)
  try {
    await entered.promise
    grant.revoke()
    Expect(grant.signal.aborted).toBe(true)
    Expect(grant.externalCancellationSignal.aborted).toBe(true)
    // budget-ok: The finite guard catches an unbounded externally cancelled cleanup contract.
    const failure: unknown = await Promise.race([result, Time.sleep(200).then(() => undefined)])
    Expect(failure instanceof Errors.HostEnvironmentError).toBe(true)
    if (!(failure instanceof Errors.HostEnvironmentError)) {
      Errors.throwUnexpected('Expected bounded external cancellation failure evidence.')
    }
    Expect(failure.message).toContain('finite grace period')
    Expect(failure.details?.['retainsTargetLease']).toBe(true)
    Expect(published).toEqual([])
  } finally {
    cleanup.resolve()
    await completed.catch(() => {})
    await FS.remove(root)
  }
  Expect(published).toEqual([false])
})

Test('a delayed mounted observation cannot authorize input after revocation', async () => {
  const entered = Deferred<void>()
  const observed = Deferred<void>()
  const grant = createManagedMobileGrant({
    identity: identity(),
    assertOwnerCurrent: async () => {},
    assertLoopCurrent: async () => {},
  })
  grant.bindRuntimeObserver(async () => {
    entered.resolve()
    await observed.promise
  })
  const checking = grant.assertCurrent()
  await entered.promise
  grant.revoke()
  observed.resolve()
  await Expect(checking).rejects.toThrow('revoked')
  await Expect(grant.lease.assertCurrent('loop-1')).rejects.toThrow('revoked')
  // Revocation permits only fenced driver deletion; it never drops target authority.
  await grant.assertCleanupCurrent()
})

Test('driver deletion after revocation still refuses a physical owner change', async () => {
  let owner = 'retained-2'
  const grant = createManagedMobileGrant({
    identity: identity(),
    assertLoopCurrent: async () => {},
    assertOwnerCurrent: async () => {
      if (owner !== 'retained-2') {
        Errors.throwHostEnvironment('physical owner changed')
      }
    },
  })
  grant.bindRuntimeObserver(async () => {})
  await grant.lease.release()
  await grant.assertCurrent()
  grant.revoke()
  owner = 'peer-3'
  await Expect(grant.assertCleanupCurrent()).rejects.toThrow('physical owner changed')
})

Test('managed input requires an observed runtime and rechecks loop generation after observation', async () => {
  let generation = 'loop-1'
  const grant = createManagedMobileGrant({
    identity: identity(),
    assertOwnerCurrent: async () => {},
    assertLoopCurrent: async () => {
      if (generation !== 'loop-1') {
        Errors.throwHostEnvironment('loop generation changed')
      }
    },
  })
  await Expect(grant.assertCurrent()).rejects.toThrow('has not been observed')
  grant.bindRuntimeObserver(async () => {
    generation = 'loop-2'
  })
  await Expect(grant.assertCurrent()).rejects.toThrow('loop generation changed')
  await Expect(grant.lease.assertCurrent('stale')).rejects.toThrow('generation changed')
})

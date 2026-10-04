import { createAppiumHttpTransport } from '@appium-driver'
import { Errors, FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { runManagedMobileFixture } from '../native/ManagedMobileFixture'
import { createManagedMobileGrant } from '../native/ManagedMobileGrant'

Test(
  'an unavailable artifact root preserves its filesystem cause and proves cleanup without allocating a driver',
  async () => {
    const root = await mkTestDir('managed-unavailable-artifacts-')
    const absent = FS.resolvePath('absent', root)
    const events: string[] = []
    const grant = createManagedMobileGrant({
      identity: {
        session: 'session',
        checkout: '/checkout',
        loopGeneration: 'generation',
        target: { platform: 'android', id: 'emulator-owned' },
        resources: [],
        runtime: {
          session: 'session',
          checkout: '/checkout',
          loopGeneration: 'generation',
          projectRoot: '/project',
          appName: 'DataMVPApp',
          sourceRevision: 'source',
          compiledRevision: 'compiled',
          nonce: 'nonce',
          kind: 'companion',
          appId: 'runtime.app',
          devUrl: 'http://127.0.0.1:8081',
        },
      },
      assertLoopCurrent: async () => {},
      assertOwnerCurrent: async () => {},
    })
    let failure: unknown
    try {
      await Expect(
        runManagedMobileFixture({
          grant,
          artifactRoot: absent,
          onDriverProcess: async () => Errors.throwUnexpected('Unavailable artifacts cannot start a process.'),
          onCleanup: async proved => {
            events.push(`cleanup:${proved}`)
          },
        }, {
          startServer: async () => Errors.throwUnexpected('Unavailable artifacts cannot allocate a server.'),
          controller: () => Errors.throwUnexpected('Unavailable artifacts cannot construct a controller.'),
          resources: () => ({
            leases: {
              acquire: async () => Errors.throwUnexpected('Unavailable artifacts cannot allocate a target.'),
              tryAcquire: async () => Errors.throwUnexpected('Unavailable artifacts cannot allocate driver ports.'),
            },
            serverReservations: () => ({
              reserve: async () => Errors.throwUnexpected('Unavailable artifacts cannot allocate a server port.'),
            }),
            releaseAfterCleanup: async (driverClosed, serverClosed) => {
              Expect([driverClosed, serverClosed]).toEqual([true, true])
              events.push('absence-proved')
            },
          }),
        }).catch(error => {
          failure = error
          throw error
        }),
      ).rejects.toThrow('The managed mobile fixture artifact directory could not be created.')
      if (!(failure instanceof Errors.HostEnvironmentError)) {
        Errors.throwUnexpected('Expected the unavailable artifact root to preserve its host failure.')
      }
      Expect(failure.cause instanceof Error).toBe(true)
      Expect((failure.cause as { code?: string }).code).toBe('ENOENT')
      Expect(events).toEqual(['absence-proved', 'cleanup:true'])
      Expect(grant.signal.aborted).toBe(true)
      Expect(await FS.exists(absent)).toBe(false)
      Expect(await FS.listDir(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  },
)

for (const mode of ['fetch-external', 'response-external', 'response-timeout'] as const) {
  Test(
    `managed ${mode} creation retains every fence without accepting a UUID`,
    async () => {
      const root = await mkTestDir('managed-creation-budget-')
      const grant = createManagedMobileGrant({
        identity: {
          session: 'session',
          checkout: '/checkout',
          loopGeneration: 'generation',
          target: { platform: 'android', id: 'emulator-owned' },
          resources: [],
          runtime: {
            session: 'session',
            checkout: '/checkout',
            loopGeneration: 'generation',
            projectRoot: '/project',
            appName: 'DataMVPApp',
            sourceRevision: 'source',
            compiledRevision: 'compiled',
            nonce: 'nonce',
            kind: 'expo-go',
            appId: 'host.exp.exponent',
            devUrl: 'http://127.0.0.1:8081',
          },
        },
        assertLoopCurrent: async () => {},
        assertOwnerCurrent: async () => {},
      })
      const held: string[] = []
      const events: string[] = []
      let now = 0
      const timers: { deadline: number; controller: AbortController }[] = []
      let creations = 0
      let bodyReads = 0
      let attemptRoot: string | undefined
      try {
        await Expect(runManagedMobileFixture({
          grant,
          artifactRoot: root,
          onDriverProcess: async () => {},
          onCleanup: async proved => {
            events.push(`cleanup:${proved}`)
          },
        }, {
          startServer: async ({ artifactRoot }) => {
            attemptRoot = artifactRoot
            return {
              url: 'http://127.0.0.1:4723',
              logs: () => '',
              close: async () => {
                events.push('server-closed')
              },
            }
          },
          resources: () => ({
            leases: {
              acquire: async () => Errors.throwUnexpected('The physical target must not be reacquired.'),
              tryAcquire: async name => {
                held.push(name)
                return {
                  generation: 'driver-owned',
                  assertCurrent: async () => {},
                  release: async () => {
                    events.push('driver-port-release')
                  },
                }
              },
            },
            serverReservations: () => ({ reserve: async () => Errors.throwUnexpected('Source server has no port.') }),
            releaseAfterCleanup: async () => {
              events.push('resources-released')
            },
          }),
          transport: options =>
            createAppiumHttpTransport({
              ...options,
              fetch: async (_url, init) => {
                creations++
                if (mode !== 'fetch-external') {
                  // A zero-watermark stream starts only when the transport consumes the body,
                  // after headers. Like native fetch, aborting its request errors that stream.
                  return new Response(
                    new ReadableStream<Uint8Array>({
                      start(controller) {
                        init?.signal?.addEventListener('abort', () => {
                          controller.error(Errors.abortError('creation response cancelled'))
                        }, { once: true })
                      },
                      pull(controller) {
                        bodyReads++
                        controller.enqueue(new TextEncoder().encode('{"value":{"sessionId":"partial-private-uuid'))
                        now = mode === 'response-timeout' ? 91_000 : 35_000
                        for (const timer of timers) {
                          if (timer.deadline <= now) {
                            timer.controller.abort()
                          }
                        }
                        if (mode === 'response-external') {
                          grant.revoke()
                        }
                      },
                    }, { highWaterMark: 0 }),
                  )
                }
                now = 35_000
                for (const timer of timers) {
                  if (timer.deadline <= now) {
                    timer.controller.abort()
                  }
                }
                // This is the actual managed transport, not a synthetic unknown-session error.
                Expect(init?.signal?.aborted).toBe(false)
                grant.revoke()
                init?.signal?.throwIfAborted()
                return new Response('{"value":{"sessionId":"must-not-publish"}}')
              },
            }, {
              now: () => now,
              timeoutSignal: milliseconds => {
                const controller = new AbortController()
                timers.push({ deadline: now + milliseconds, controller })
                return controller.signal
              },
            }),
        })).rejects.toThrow('cleanup is unproved')
        Expect(creations).toBe(1)
        Expect(bodyReads).toBe(mode === 'fetch-external' ? 0 : 1)
        Expect(held).toHaveLength(2)
        Expect(events).toEqual(['server-closed', 'cleanup:false'])
        if (attemptRoot === undefined) {
          Errors.throwUnexpected('Missing started fixture artifact namespace.')
        }
        const receiptNames = (await FS.listDir(FS.resolvePath('appium-android', attemptRoot)))
          .filter(name => name.endsWith('.receipt.json'))
        Expect(receiptNames).toHaveLength(1)
        const receiptName = receiptNames[0]!
        const receipt = JSON.parse(
          await FS.readText(FS.resolvePath(receiptName, FS.resolvePath('appium-android', attemptRoot))),
        )
        Expect(receipt.lifecycle).toBe('opening')
        Expect(receipt.sessionId).toBeUndefined()
        const cleanupNames = (await FS.listDir(attemptRoot)).filter(name => name.startsWith('managed-mobile-cleanup-'))
        Expect(cleanupNames).toHaveLength(1)
        const cleanupText = await FS.readText(
          FS.resolvePath('cleanup.json', FS.resolvePath(cleanupNames[0]!, attemptRoot)),
        )
        Expect(cleanupText.includes('partial-private-uuid')).toBe(false)
        const cleanup = JSON.parse(cleanupText)
        Expect(cleanup.cleanupProved).toBe(false)
        Expect(cleanup.openingRetained).toBe(true)
        Expect(cleanup.originalFailure[1].transport).toEqual({
          stage: mode === 'fetch-external' ? 'fetch' : 'response',
          operation: 'session-creation',
          cancellation: mode === 'response-timeout' ? 'timeout' : 'external',
          elapsedMs: mode === 'response-timeout' ? 91_000 : 35_000,
          timeoutMs: 90_000,
        })
      } finally {
        await FS.remove(root)
      }
    },
  )
}

for (
  const fault of [
    'opening',
    'driver',
    'server',
    'both',
    'artifact-unwritable',
    'publication',
    'publication-after-physical',
  ] as const
) {
  Test(`managed session failure preserves original cause and separate ${fault} cleanup facts`, async () => {
    const root = await mkTestDir('managed-cleanup-evidence-')
    const underlying = new Errors.HostEnvironmentError(
      'POST /session failed: http://private.invalid/session authorization=private-token',
    )
    const original = new Errors.HostEnvironmentError('Remote session creation is uncertain.', {
      cause: underlying,
      details: { retainsTargetLease: fault !== 'publication-after-physical' },
    })
    const grant = createManagedMobileGrant({
      identity: {
        session: 'session',
        checkout: '/checkout',
        loopGeneration: 'generation',
        target: { platform: 'android', id: 'emulator-5554' },
        resources: [],
        runtime: {
          session: 'session',
          checkout: '/checkout',
          loopGeneration: 'generation',
          projectRoot: '/project',
          appName: 'DataMVPApp',
          sourceRevision: 'source',
          compiledRevision: 'compiled',
          nonce: 'nonce',
          kind: 'expo-go',
          appId: 'host.exp.exponent',
          devUrl: 'http://127.0.0.1:8081',
        },
      },
      assertLoopCurrent: async () => {},
      assertOwnerCurrent: async () => {},
    })
    const events: string[] = []
    let caught: unknown
    let attemptRoot: string | undefined
    try {
      await runManagedMobileFixture({
        grant,
        artifactRoot: root,
        onDriverProcess: async () => {},
        onCleanup: async proved => {
          events.push(`published:${proved}`)
          if (fault === 'publication' || fault === 'publication-after-physical') {
            Errors.throwHostEnvironment(
              'Private cleanup save failed http://publication.invalid/receipt secret=private-publication',
            )
          }
        },
      }, {
        startServer: async ({ artifactRoot }) => {
          attemptRoot = artifactRoot
          return {
            url: 'http://127.0.0.1:4723',
            logs: () => '',
            close: async () => {
              events.push('server')
              if (fault === 'server' || fault === 'both') {
                Errors.throwHostEnvironment('Owned server close unproved')
              }
            },
          }
        },
        resources: () => ({
          leases: {
            acquire: async () => Errors.throwUnexpected('No source driver reservations'),
            tryAcquire: async () => undefined,
          },
          serverReservations: () => ({ reserve: async () => Errors.throwUnexpected('No source port reservations') }),
          releaseAfterCleanup: async () => {
            events.push('released')
          },
        }),
        controller: () => ({
          openSession: async () => {
            if (fault === 'artifact-unwritable') {
              if (attemptRoot === undefined) {
                Errors.throwUnexpected('Missing fixture namespace before session creation.')
              }
              await FS.remove(attemptRoot)
            }
            throw original
          },
          close: async () => {
            events.push('driver')
            if (fault === 'driver' || fault === 'both') {
              Errors.throwHostEnvironment('Owned driver close unproved')
            }
          },
        }),
      })
    } catch (error) {
      caught = error
    }
    try {
      Expect(caught instanceof Errors.HostEnvironmentError).toBe(true)
      if (!(caught instanceof Errors.HostEnvironmentError)) {
        Errors.throwUnexpected('Missing cleanup failure')
      }
      Expect(caught.cause).toBe(original)
      Expect(events).toEqual(
        fault === 'publication-after-physical'
          ? ['driver', 'server', 'released', 'published:true']
          : ['driver', 'server', 'published:false'],
      )
      Expect(caught.details?.['driverClosed']).toBe(fault !== 'driver' && fault !== 'both')
      Expect(caught.details?.['serverClosed']).toBe(fault !== 'server' && fault !== 'both')
      Expect(caught.details?.['openingRetained']).toBe(fault !== 'publication-after-physical')
      Expect(caught.details?.['driverResourcesReleased']).toBe(fault === 'publication-after-physical')
      if (fault === 'publication-after-physical') {
        Expect(caught.message.includes('driver resources were released')).toBe(true)
        Expect(caught.message.includes('fences remain retained')).toBe(false)
      }
      const directories = await FS.listDir(root)
      if (fault === 'artifact-unwritable') {
        Expect(directories).toEqual([])
        Expect(caught.details?.['diagnosticWriteFailure']).not.toEqual([])
      } else {
        if (attemptRoot === undefined) {
          Errors.throwUnexpected('Missing started fixture artifact namespace.')
        }
        Expect(directories).toEqual([FS.basename(attemptRoot)])
        Expect(await FS.fileMode(attemptRoot)).toBe(0o700)
        const cleanupNames = (await FS.listDir(attemptRoot)).filter(name => name.startsWith('managed-mobile-cleanup-'))
        Expect(cleanupNames).toHaveLength(1)
        const directory = FS.resolvePath(cleanupNames[0]!, attemptRoot)
        const artifact = FS.resolvePath('cleanup.json', directory)
        Expect(await FS.fileMode(directory)).toBe(0o700)
        Expect(await FS.fileMode(artifact)).toBe(0o600)
        const text = await FS.readText(artifact)
        Expect(text.length < 65_536).toBe(true)
        Expect(text.includes('private.invalid')).toBe(false)
        Expect(text.includes('private-token')).toBe(false)
        const record = JSON.parse(text)
        Expect(record.cleanupProved).toBe(false)
        Expect(record.originalFailure[1].message).toBe('POST /session failed: [redacted-url] authorization=[redacted]')
        Expect(record.driverClosed).toBe(caught.details?.['driverClosed'])
        Expect(record.serverClosed).toBe(caught.details?.['serverClosed'])
        Expect(record.openingRetained).toBe(fault !== 'publication-after-physical')
        Expect(record.driverResourcesReleased).toBe(fault === 'publication-after-physical')
        Expect(record.cleanupFailures).toHaveLength(
          fault === 'both' ? 2 : fault === 'driver' || fault === 'server' ? 1 : 0,
        )
        Expect(record.finalPublicationFailure).toEqual(
          fault === 'publication' || fault === 'publication-after-physical'
            ? [{
              name: 'HostEnvironmentError',
              message: 'Private cleanup save failed [redacted-url] secret=[redacted]',
            }]
            : [],
        )
        Expect(caught.details?.['finalPublicationFailure']).toEqual(record.finalPublicationFailure)
        Expect(text.includes('publication.invalid')).toBe(false)
        Expect(text.includes('private-publication')).toBe(false)
      }
    } finally {
      await FS.remove(root)
    }
  })
}

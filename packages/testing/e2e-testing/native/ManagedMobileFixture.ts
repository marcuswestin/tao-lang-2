import {
  createAppiumHttpTransport,
  createAppiumWebDriverClient,
  isManagedRuntimeIdentityRequest,
  startMobileAppiumServer,
} from '@appium-driver'
import type { HostController, HostObservation, HostSession, HostTarget } from '@host-control'
import { CLI, Errors, FS, Platform, Time } from '@shared'
import { createManagedAppiumAndroidController } from './appium-android/AppiumAndroidController'
import { createManagedAppiumXcuiTestController } from './appium/AppiumXcuiTestController'
import { appiumAndroidClient, appiumXcuiTestClient } from './AppiumMobileClients'
import { type ManagedMobileGrant, type ManagedMobileIdentity, settleManagedMobileProof } from './ManagedMobileGrant'
import { managedMobileResources } from './ManagedMobileResources'

function privateFailure(error: unknown): readonly { name: string; message: string; transport?: unknown }[] {
  const chain: { name: string; message: string; transport?: unknown }[] = []
  const seen = new Set<unknown>()
  const sanitize = (text: string) =>
    text
      .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu, '[redacted-url]')
      .replace(/Bearer\s+[^\s"']+/giu, 'Bearer [redacted]')
      .replace(
        /(token|authorization|capability|credentials|password|secret)(["']?\s*[:=]\s*["']?)[^\s,"'}]+/giu,
        '$1$2[redacted]',
      )
      .slice(0, 1_024)
  while (error !== undefined && chain.length < 4 && !seen.has(error)) {
    seen.add(error)
    const transport = error instanceof Errors.HostEnvironmentError ? error.details?.['transportFailure'] : undefined
    const safeTransport = typeof transport === 'object' && transport !== null
      ? transport as Record<string, unknown>
      : undefined
    chain.push({
      name: error instanceof Error ? sanitize(error.name).slice(0, 64) : 'UnknownFailure',
      message: sanitize(error instanceof Error ? error.message : 'Non-error failure'),
      ...(safeTransport === undefined ? {} : {
        transport: {
          stage: ['fetch', 'response', 'parse'].includes(String(safeTransport['stage']))
            ? safeTransport['stage']
            : 'unknown',
          operation: ['session-creation', 'session-deletion', 'ordinary'].includes(String(safeTransport['operation']))
            ? safeTransport['operation']
            : 'unknown',
          cancellation: ['timeout', 'external', 'none'].includes(String(safeTransport['cancellation']))
            ? safeTransport['cancellation']
            : 'unknown',
          elapsedMs: typeof safeTransport['elapsedMs'] === 'number' && Number.isFinite(safeTransport['elapsedMs'])
            ? Math.max(0, safeTransport['elapsedMs'])
            : undefined,
          timeoutMs: typeof safeTransport['timeoutMs'] === 'number' && Number.isFinite(safeTransport['timeoutMs'])
            ? Math.max(0, safeTransport['timeoutMs'])
            : undefined,
        },
      }),
    })
    const cause = error instanceof Error && 'cause' in error ? error.cause : undefined
    if (cause === undefined && error instanceof Errors.HostEnvironmentError) {
      // Some host wrappers carry their incoming error in details rather than Error.cause.
      const detailCause = error.details?.['cause']
      error = detailCause instanceof Error ? detailCause : undefined
    } else {
      error = cause
    }
  }
  return chain
}

export type ManagedMobileFixtureEvidence = Readonly<{
  identity: ManagedMobileIdentity
  workspaceName: string
  screenshots: readonly string[]
  driverClosed: true
  targetReservationPreserved: true
}>

/** The sole managed native input sequence: Data MVP workspace input, add, row assertion, screenshots. */
export async function runManagedMobileFixture(options: {
  grant: ManagedMobileGrant
  artifactRoot: string
  onDriverProcess: (process: CLI.StartedCommand) => Promise<void>
  onCleanup: (proved: boolean) => Promise<void>
  beforeDriverCleanup?: () => Promise<void>
  beforeFixtureAction?: (phase: 'input' | 'add' | 'observe', grant: ManagedMobileGrant) => Promise<void>
  beforeDriverDeletion?: () => Promise<void>
  assertOwnedDiagnosticTargetCurrent?: () => Promise<void>
}, dependencies: {
  startServer?: typeof startMobileAppiumServer
  resources?: typeof managedMobileResources
  controller?: () => HostController
  transport?: typeof createAppiumHttpTransport
} = {}): Promise<ManagedMobileFixtureEvidence> {
  const { grant } = options
  const { platform, id } = grant.identity.target
  const runtime = grant.identity.runtime
  const revision = { build: runtime.compiledRevision, source: runtime.sourceRevision }
  const resources = (dependencies.resources ?? managedMobileResources)()
  let server: Awaited<ReturnType<typeof startMobileAppiumServer>> | undefined
  let controller: HostController | undefined
  let startupAttempted = false
  let startupCleanupProved = false
  let session: HostSession | undefined
  let artifactRoot = options.artifactRoot
  let failure: unknown
  let evidence: Omit<ManagedMobileFixtureEvidence, 'driverClosed' | 'targetReservationPreserved'> | undefined
  try {
    await grant.assertOwnerCurrent()
    try {
      artifactRoot = await FS.mkTmpDir(
        FS.resolvePath(`managed-mobile-attempt-${Platform.randomUUID()}-`, options.artifactRoot),
      )
    } catch (error) {
      Errors.throwHostEnvironment('The managed mobile fixture artifact directory could not be created.', {
        cause: error,
      })
    }
    startupAttempted = true
    server = await (dependencies.startServer ?? startMobileAppiumServer)({
      artifactRoot,
      driver: platform === 'ios' ? 'xcuitest' : 'uiautomator2',
      runId: `${grant.identity.session}-${grant.identity.loopGeneration}`,
      quiet: true,
      detached: true,
      signal: grant.signal,
      onStarted: options.onDriverProcess,
      reservations: resources.serverReservations(`${grant.identity.session}-${grant.identity.loopGeneration}`),
      onStartupCleanup: proved => {
        startupCleanupProved = proved
      },
    })
    const factory = createAppiumWebDriverClient((dependencies.transport ?? createAppiumHttpTransport)({
      serverUrl: server.url,
      signal: grant.signal,
      requestTimeoutMs: 30_000,
      sessionCreationTimeoutMs: 90_000,
      assertRequest: async request => {
        if (request.method === 'DELETE' && /^\/session\/[^/]+$/u.test(request.path)) {
          await grant.assertCleanupCurrent()
        } else {
          if (
            isManagedRuntimeIdentityRequest(request, platform, runtime.appId)
            || request.purpose === 'managed-diagnostic'
            || request.path === '/session'
          ) {
            await grant.assertRequestCurrent()
          } else {
            await grant.assertCurrent()
          }
        }
      },
    }))
    controller = dependencies.controller !== undefined ? dependencies.controller() : platform === 'ios'
      ? createManagedAppiumXcuiTestController({
        client: appiumXcuiTestClient(factory, grant),
        grant,
        leases: resources.leases,
        beforeDriverDeletion: options.beforeDriverDeletion,
        target: { kind: 'simulator', udid: id, appId: runtime.appId },
      })
      : createManagedAppiumAndroidController({
        client: appiumAndroidClient(
          factory,
          grant,
          options.assertOwnedDiagnosticTargetCurrent === undefined
            ? undefined
            : {
              artifactRoot,
              assertOwnedTargetCurrent: options.assertOwnedDiagnosticTargetCurrent,
            },
        ),
        grant,
        leases: resources.leases,
        beforeDriverDeletion: options.beforeDriverDeletion,
        target: { kind: 'emulator', serial: id, appId: runtime.appId },
      })
    session = await controller.openSession({
      artifactRoot,
      mode: 'acceptance',
      revision,
      target: id,
    })
    const observe = async (target: HostTarget): Promise<HostObservation> => {
      const result = await session!.observe({ expectedRevision: revision, target })
      if (!result.visible) {
        Errors.throwHostEnvironment('The managed fixture target is not visible.')
      }
      return result
    }
    const screenshots: string[] = []
    screenshots.push((await session.captureScreenshot('before-workspace')).artifactPath)
    const workspaceName = `Managed ${Platform.randomUUID().slice(0, 8)}`
    const input = await observe({
      kind: 'scoped',
      scope: { kind: 'tag', value: 'workspaceName' },
      target: { kind: 'accessibility', role: 'textbox', name: '' },
    })
    await options.beforeFixtureAction?.('input', grant)
    await session.perform({
      kind: 'type',
      observation: input,
      text: workspaceName,
      expectedRevision: revision,
      lease: session.descriptor().lease,
    })
    const add = await observe({ kind: 'tag', value: 'addWorkspace' })
    await options.beforeFixtureAction?.('add', grant)
    await session.perform({
      kind: 'click',
      observation: add,
      expectedRevision: revision,
      lease: session.descriptor().lease,
    })
    await options.beforeFixtureAction?.('observe', grant)
    const row = await Time.pollUntil(async () => {
      try {
        return await observe({
          kind: 'scoped',
          scope: { kind: 'tag', value: 'workspaces' },
          target: { kind: 'text', value: workspaceName },
        })
      } catch (error) {
        await grant.assertCurrent()
        if (grant.signal.aborted) {
          throw error
        }
        return undefined
      }
    }, { timeoutMs: 30_000, intervalMs: 100 })
    if (row === undefined || row.text !== workspaceName) {
      Errors.throwHostEnvironment('Data MVP did not render the workspace created by managed native input.')
    }
    screenshots.push((await session.captureScreenshot('after-workspace')).artifactPath)
    evidence = { identity: grant.identity, workspaceName, screenshots }
  } catch (error) {
    failure = error
  } finally {
    // Normal cleanup revokes input without cancelling the independently bounded proof.
    grant.revokeInput()
    let publicationFailure: unknown
    try {
      await settleManagedMobileProof(Promise.resolve(options.beforeDriverCleanup?.()), grant.signal)
    } catch (error) {
      publicationFailure = error
    }
    // Driver deletion and owned server shutdown are independent. Either uncertainty keeps
    // physical reservations retained and blocks every later loop mutation.
    const cleanupFailures: unknown[] = []
    let driverClosed = controller === undefined
    let serverClosed = !startupAttempted || startupCleanupProved
    if (controller !== undefined) {
      try {
        await settleManagedMobileProof(controller.close(), grant.signal, 30_000)
        driverClosed = true
      } catch (error) {
        cleanupFailures.push(error)
      }
    }
    if (server !== undefined) {
      try {
        await server.close()
        serverClosed = true
      } catch (error) {
        cleanupFailures.push(error)
      }
    }
    try {
      await settleManagedMobileProof(grant.assertCleanupCurrent(), grant.signal)
    } catch (error) {
      cleanupFailures.push(error)
    }
    const openingRetained = failure instanceof Errors.HostEnvironmentError
      && failure.details?.['retainsTargetLease'] === true
    const proved = driverClosed && serverClosed && cleanupFailures.length === 0 && !openingRetained
      && publicationFailure === undefined
    let driverResourcesReleased = false
    if (proved) {
      try {
        await resources.releaseAfterCleanup(driverClosed, serverClosed)
        driverResourcesReleased = true
      } catch (error) {
        cleanupFailures.push(error)
      }
    }
    let finalPublicationFailure: unknown
    try {
      await options.onCleanup(proved && cleanupFailures.length === 0)
    } catch (error) {
      finalPublicationFailure = error
    }
    const cleanupFacts = {
      driverClosed,
      serverClosed,
      openingRetained,
      driverResourcesReleased,
      cleanupFailures: cleanupFailures.slice(0, 8).map(privateFailure),
      publicationFailure: privateFailure(publicationFailure),
      finalPublicationFailure: privateFailure(finalPublicationFailure),
      originalFailure: privateFailure(failure),
    }
    let diagnosticWriteFailure: unknown
    if (failure !== undefined || !proved || cleanupFailures.length > 0 || finalPublicationFailure !== undefined) {
      try {
        // The artifact root already belongs to this finite proof. No missing root is created.
        const directory = await FS.mkTmpDir(FS.resolvePath('managed-mobile-cleanup-', artifactRoot))
        await FS.writeExclusiveFile(
          FS.resolvePath('cleanup.json', directory),
          JSON.stringify({
            version: 1,
            classification: 'managed-mobile-cleanup',
            cleanupProved: proved && cleanupFailures.length === 0 && finalPublicationFailure === undefined,
            ...cleanupFacts,
          }),
          { mode: 0o600 },
        )
      } catch (error) {
        diagnosticWriteFailure = error
      }
    }
    if (!proved || cleanupFailures.length > 0 || finalPublicationFailure !== undefined) {
      Errors.throwHostEnvironment(
        driverResourcesReleased
          ? 'Managed mobile cleanup publication is unproved; target mutation remains blocked after driver resources were released.'
          : 'Managed mobile driver cleanup is unproved; target and driver fences remain retained.',
        {
          cause: failure ?? publicationFailure ?? cleanupFailures[0] ?? finalPublicationFailure,
          details: {
            retainsTargetLease: true,
            ...cleanupFacts,
            diagnosticWriteFailure: privateFailure(diagnosticWriteFailure),
          },
        },
      )
    }
  }
  if (failure !== undefined) {
    throw failure
  }
  await grant.assertCleanupCurrent()
  if (evidence === undefined) {
    Errors.throwUnexpected('Expected completed managed mobile fixture evidence.')
  }
  return { ...evidence, driverClosed: true, targetReservationPreserved: true }
}

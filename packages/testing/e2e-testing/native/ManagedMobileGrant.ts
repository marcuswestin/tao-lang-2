import { Errors } from '@shared'
import type { DevLoopMobileRuntime } from '@shared/DevLoopControl'

/** Revocation gives independent cleanup a finite grace period; unfinished work keeps its fences. */
export async function settleManagedMobileProof<T>(
  completed: Promise<T>,
  signal: AbortSignal,
  cleanupTimeoutMs = 5_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      completed,
      new Promise<never>((_resolve, reject) => {
        abort = () => {
          timer = setTimeout(() =>
            reject(
              new Errors.HostEnvironmentError(
                'Managed mobile cleanup did not finish within its finite grace period; fences remain retained.',
                { details: { retainsTargetLease: true } },
              ),
            ), cleanupTimeoutMs)
        }
        if (signal.aborted) {
          abort()
        } else {
          signal.addEventListener('abort', abort, { once: true })
        }
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    if (abort !== undefined) {
      signal.removeEventListener('abort', abort)
    }
  }
}

export type ManagedMobileIdentity = Readonly<{
  session: string
  checkout: string
  loopGeneration: string
  target: Readonly<{ platform: 'ios' | 'android'; id: string }>
  resources: readonly Readonly<{ name: string; generation: string }>[]
  runtime: DevLoopMobileRuntime
}>

/** Finite interaction authority; revocation never releases the physical target reservation. */
export type ManagedMobileGrant = Readonly<{
  identity: ManagedMobileIdentity
  /** Input and diagnostic requests stop as soon as fixture cleanup starts. */
  signal: AbortSignal
  /** Only external revocation starts the controller's request/drain grace period. */
  externalCancellationSignal: AbortSignal
  assertCurrent: () => Promise<void>
  assertOwnerCurrent: () => Promise<void>
  assertRequestCurrent: () => Promise<void>
  assertCleanupCurrent: () => Promise<void>
  bindRuntimeObserver: (observe: () => Promise<void>) => void
  revokeInput: () => void
  revoke: () => void
  lease: Readonly<
    { generation: string; assertCurrent: (generation: string) => Promise<void>; release: () => Promise<void> }
  >
}>

export function createManagedMobileGrant(options: {
  identity: ManagedMobileIdentity
  assertOwnerCurrent: () => Promise<void>
  assertLoopCurrent: () => Promise<void>
}): ManagedMobileGrant {
  const copied = structuredClone(options.identity)
  const identity = Object.freeze({
    ...copied,
    target: Object.freeze(copied.target),
    runtime: Object.freeze(copied.runtime),
    resources: Object.freeze(copied.resources.map(resource => Object.freeze(resource))),
  })
  const abort = new AbortController()
  const externalCancellation = new AbortController()
  let observeRuntime: (() => Promise<void>) | undefined
  const assertOwnerCurrent = async () => {
    await options.assertOwnerCurrent()
  }
  const assertCurrent = async () => {
    if (abort.signal.aborted) {
      Errors.throwHostEnvironment('Managed mobile interaction was revoked.')
    }
    await options.assertLoopCurrent()
    await assertOwnerCurrent()
    if (observeRuntime === undefined) {
      Errors.throwHostEnvironment('Managed mobile runtime identity has not been observed on the attached target.')
    }
    await observeRuntime()
    await options.assertLoopCurrent()
    await assertOwnerCurrent()
    if (abort.signal.aborted) {
      Errors.throwHostEnvironment('Managed mobile interaction was revoked.')
    }
  }
  const assertRequestCurrent = async () => {
    if (abort.signal.aborted) {
      Errors.throwHostEnvironment('Managed mobile interaction was revoked.')
    }
    await options.assertLoopCurrent()
    await assertOwnerCurrent()
    if (abort.signal.aborted) {
      Errors.throwHostEnvironment('Managed mobile interaction was revoked.')
    }
  }
  const generation = identity.loopGeneration
  return Object.freeze({
    identity,
    signal: abort.signal,
    externalCancellationSignal: externalCancellation.signal,
    assertCurrent,
    assertOwnerCurrent,
    assertRequestCurrent,
    // This assertion is exposed only to driver deletion, never input or lifecycle actions.
    assertCleanupCurrent: assertOwnerCurrent,
    bindRuntimeObserver: observe => {
      if (observeRuntime !== undefined || abort.signal.aborted) {
        Errors.throwUnexpected('Expected one runtime observer per live managed mobile grant.')
      }
      observeRuntime = observe
    },
    revokeInput: () => abort.abort(),
    revoke: () => {
      abort.abort()
      externalCancellation.abort()
    },
    lease: Object.freeze({
      generation,
      assertCurrent: async (supplied: string) => {
        if (supplied !== generation) {
          Errors.throwHostEnvironment('Managed mobile target generation changed.')
        }
        await assertCurrent()
      },
      release: async () => {},
    }),
  })
}

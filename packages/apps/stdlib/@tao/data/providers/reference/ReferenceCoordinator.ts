import { Assert, Errors } from '@shared/core'
import type { ReferenceCheckpoint, ReferenceEnvelope } from './ReferenceState'

type State = { checkpoint?: ReferenceCheckpoint; liveSnapshot?: ReferenceEnvelope }
type Coordinator = {
  state: State
  coverage: string
  members: Set<() => void>
  tail: Promise<void>
  ownership: Promise<() => void>
}
type Acquire = (identity: string) => Promise<() => void>
const coordinators = new Map<string, Coordinator>()
// Closed datasources release their browser lock, but the owning auth scope may still be signed in.
// Keep only lease identities here; plaintext state and keys never survive coordinator retirement.
const authenticatedLeases = new Map<string, Set<symbol>>()

function coordinator(identity: string, acquire?: Acquire): Coordinator {
  let shared = coordinators.get(identity)
  if (shared === undefined) {
    shared = {
      state: {},
      coverage: '',
      members: new Set(),
      tail: Promise.resolve(),
      ownership: Promise.resolve(() => {}),
    }
    // Publish before acquisition: another mount must join this queue while its host lock is pending.
    coordinators.set(identity, shared)
    shared.ownership = acquire === undefined ? Promise.resolve(() => {}) : acquire(identity)
    void shared.ownership.catch(() => {})
  }
  return shared
}

function run<T>(shared: Coordinator, action: () => Promise<T>): Promise<T> {
  const next = shared.tail.then(async () => {
    await shared.ownership
    return await action()
  })
  shared.tail = next.then(() => {}, () => {})
  return next
}

function retire(identity: string, shared: Coordinator): void {
  const tail = shared.tail
  void tail.then(async () => {
    const release = await shared.ownership.catch(() => undefined)
    if (shared.members.size > 0 || coordinators.get(identity) !== shared) {
      return
    }
    if (shared.tail !== tail) {
      retire(identity, shared)
      return
    }
    coordinators.delete(identity)
    delete shared.state.checkpoint
    delete shared.state.liveSnapshot
    release?.()
  })
}

/** One account checkpoint has one serial writer and one accepted base per JavaScript runtime. */
export function joinReferenceCheckpoint(identity: string, coverage: string, notify: () => void, acquire?: Acquire) {
  const shared = coordinator(identity, acquire)
  Assert.input(
    shared.members.size === 0 || shared.coverage === coverage,
    'Simultaneous Reference connections must declare the same schema and offline working set.',
  )
  shared.coverage = coverage
  shared.members.add(notify)
  const lease = Symbol()
  const leases = authenticatedLeases.get(identity) ?? new Set<symbol>()
  authenticatedLeases.set(identity, leases)
  leases.add(lease)
  let closed = false
  return {
    state: shared.state,
    run: <T>(action: () => Promise<T>) => run(shared, action),
    changed: () => {
      for (const listener of shared.members) {
        listener()
      }
    },
    close: () => {
      if (closed) {
        return
      }
      closed = true
      shared.members.delete(notify)
      if (shared.members.size === 0) {
        void run(shared, async () => {
          delete shared.state.liveSnapshot
        }).catch(() => {})
      }
      retire(identity, shared)
    },
    invalidate: (removeKey: () => Promise<void>) => {
      leases.delete(lease)
      if (leases.size === 0 && authenticatedLeases.get(identity) === leases) {
        authenticatedLeases.delete(identity)
      }
      // An unmounted connection may outlive its retired coordinator. Join the CURRENT queue so
      // its late logout cannot remove a key installed by a newer authenticated mount.
      const current = coordinator(identity, acquire)
      const cleanup = current.tail.then(async () => {
        // Failed acquisition means no key/checkpoint action could have started on this queue.
        // Drain it, but do not turn refusal to open data into refusal to sign out.
        const owned = await current.ownership.then(() => true, () => false)
        if (owned && (authenticatedLeases.get(identity)?.size ?? 0) === 0) {
          await removeKey()
        }
      })
      current.tail = cleanup.then(() => {}, () => {})
      retire(identity, current)
      return cleanup
    },
  }
}

/** Browser checkpoint persistence refuses a second tab rather than racing localStorage writes. */
export async function acquireBrowserCheckpoint(identity: string): Promise<() => void> {
  const locks = globalThis.navigator?.locks
  if (locks === undefined) {
    Errors.throwHostEnvironment(
      'Reference browser persistence requires Web Locks; concurrent writers cannot be protected on this host.',
    )
  }
  let acquired!: (release: () => void) => void
  let rejected!: (reason: unknown) => void
  const ownership = new Promise<() => void>((resolve, reject) => {
    acquired = resolve
    rejected = reject
  })
  void locks.request(`tao-reference:${identity}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (lock === null) {
      Errors.throwHostEnvironment('This account working set is already open in another browser tab.')
    }
    await new Promise<void>(release => acquired(release))
  }).catch(rejected)
  return await ownership
}

import { Errors, Platform, ProcessTree, type TrackedProcess } from '@shared'

type Tree = Pick<typeof ProcessTree, 'identities' | 'descendants' | 'processGroupOf' | 'groupMembers'> & {
  processIsAlive?: (pid: number) => boolean
}
type Capture = { processes: TrackedProcess[]; uncertain: boolean; rootPid?: number }

function same(a: TrackedProcess | undefined, b: TrackedProcess): boolean {
  return a?.pid === b.pid && a.startedAt === b.startedAt
}

function key(processes: readonly TrackedProcess[]): string {
  return JSON.stringify(
    processes.map(process => [process.pid, process.startedAt]).sort((a, b) => Number(a[0]) - Number(b[0])),
  )
}

/** Sample ancestry through the original root; group membership is comparison evidence only. */
function refresh(previous: Capture, tree: Tree = ProcessTree): Capture {
  const root = previous.processes.find(process => process.pid === previous.rootPid)
  if (previous.uncertain || root === undefined) {
    Errors.throwHostEnvironment('Android ownership has no complete original launch anchor.', {
      details: { retainsTargetLease: true },
    })
  }
  let stable: string | undefined
  let captured = [...previous.processes]
  for (let attempt = 0; attempt < 4; attempt++) {
    verifyAnchor(root, tree)
    const descendants = tree.descendants(root.pid)
    // Every newly admitted identity came from ancestry while the original anchor was live.
    for (const candidate of descendants) {
      const original = captured.find(process => process.pid === candidate.pid)
      if (original !== undefined && !same(candidate, original)) {
        Errors.throwHostEnvironment('Android ownership encountered a reused captured process.', {
          details: { retainsTargetLease: true },
        })
      }
      if (original === undefined) {
        captured.push(candidate)
      }
    }
    verifyAnchor(root, tree)
    const identities = tree.identities(captured.map(process => process.pid))
    const live: TrackedProcess[] = []
    for (const candidate of captured) {
      const current = identities.get(candidate.pid)
      if (current !== undefined && !same(current, candidate)) {
        Errors.throwHostEnvironment('Android ownership encountered a changed captured identity.', {
          details: { retainsTargetLease: true },
        })
      }
      if (current !== undefined) {
        if (tree.processGroupOf(candidate.pid) !== root.pid) {
          Errors.throwHostEnvironment('Android ownership encountered an escaped captured child.', {
            details: { retainsTargetLease: true },
          })
        }
        live.push(current)
      } else if (
        descendants.some(process => same(process, candidate))
        || (tree.processIsAlive ?? Platform.processIsAlive)(candidate.pid)
      ) {
        Errors.throwHostEnvironment('Android ownership could not recheck a newly sampled child.', {
          details: { retainsTargetLease: true },
        })
      }
    }
    const members = tree.groupMembers(root.pid)
    if (key(members) !== key(live)) {
      Errors.throwHostEnvironment('Android ownership has unexplained process group membership.', {
        details: { retainsTargetLease: true },
      })
    }
    verifyAnchor(root, tree)
    const sample = key(live)
    if (stable === sample) {
      return { processes: captured, rootPid: root.pid, uncertain: false }
    }
    stable = sample
  }
  Errors.throwHostEnvironment('Android ownership did not stabilize within its finite capture budget.', {
    details: { retainsTargetLease: true },
  })
}

function verifyAnchor(root: TrackedProcess, tree: Tree): void {
  if (!same(tree.identities([root.pid]).get(root.pid), root) || tree.processGroupOf(root.pid) !== root.pid) {
    Errors.throwHostEnvironment('Android ownership lost its original launch anchor.', {
      details: { retainsTargetLease: true },
    })
  }
}

/** Observers never add identities: a changed live sample invalidates an injection checkpoint. */
function verify(previous: Capture, tree: Tree = ProcessTree): void {
  const current = refresh(previous, tree)
  if (key(current.processes) !== key(previous.processes)) {
    Errors.throwHostEnvironment('Android ownership changed after its durable checkpoint.')
  }
}

export const AndroidOwnershipCapture = { refresh, verify }

/*
 * A test seam that replaces a process-wide value has to survive two uses that overlap rather than
 * nest. Snapshot-and-restore only works when restores run in exactly the reverse order of installs:
 * install A, install B, restore A, restore B leaves A's value installed forever, because B's restore
 * writes back the value B found, which was A's. The narrower "restore only when the value in place is
 * still the one I installed" guard fixes nesting and leaks the same way under overlap: A's restore
 * becomes a no-op and B's restore, running last, reinstates A. The symptom then surfaces in an
 * unrelated later test, which is the expensive kind of failure to chase.
 *
 * Every install therefore joins a per-slot stack, and a restore removes its own entry wherever that
 * entry now sits before re-applying whatever the stack says is current. The value in force is always
 * the most recent install that has not been restored, and the base value returns only once the last
 * install is gone — under any interleaving, and however many times a restore function is called.
 *
 * Overlap is corrected silently rather than reported. A restore runs from `finally` blocks and
 * `afterEach` hooks, so throwing there would replace the failure the test was actually reporting with
 * a complaint about the seam, and it would fire in whichever test happened to restore first rather
 * than in the one that overlapped. Install time cannot tell nesting — which is legitimate, and is how
 * a suite-wide install and a per-check install compose — from overlap, so there is no earlier place
 * to complain from either. Where overlapping uses must not interleave at all because the state
 * accumulates, such as captured process output, serialize the uses instead of stacking them.
 */

/** TestOverrideAccess reads and writes the one process-wide value a slot stands for. */
export type TestOverrideAccess<T> = {
  /**
   * equals decides whether the value in place is still the one this slot installed. It defaults to
   * `Object.is`; a slot whose read returns a fresh object each call must supply its own.
   */
  equals?: (left: T, right: T) => boolean
  read: () => T
  write: (value: T) => void
}

/** TestOverrideSlot owns the install stack for one process-wide value. */
export type TestOverrideSlot<T> = {
  /**
   * install puts `value` in place until the returned restore function runs. Restoring is idempotent
   * and order-independent: it drops this install and leaves whichever other install is still
   * outstanding in force, or the value that preceded them all once none is.
   */
  install: (value: T) => () => void
}

/**
 * testOverrideSlot declares one process-wide value that tests replace, and returns the seam that
 * installs over it. Declare the slot once at module scope: the slot object is the identity that lets
 * overlapping installs of the same value find each other's entries.
 */
export function testOverrideSlot<T>(access: TestOverrideAccess<T>): TestOverrideSlot<T> {
  const equals = access.equals ?? Object.is
  const installs: Array<{ value: T }> = []
  let base: { value: T } | undefined

  return {
    install(value: T): () => void {
      base ??= { value: access.read() }
      const entry = { value }
      installs.push(entry)
      access.write(value)

      return () => {
        const index = installs.indexOf(entry)
        if (index === -1 || base === undefined) {
          return
        }

        const installed = installs[installs.length - 1] ?? base
        installs.splice(index, 1)
        const next = installs[installs.length - 1] ?? base
        // Write back only while the value in place is still the one this slot last installed.
        // Something that replaced it without going through the slot owns it now, and reinstating over
        // that would undo a change this slot never made.
        if (equals(access.read(), installed.value)) {
          access.write(next.value)
        }
        if (installs.length === 0) {
          base = undefined
        }
      }
    },
  }
}

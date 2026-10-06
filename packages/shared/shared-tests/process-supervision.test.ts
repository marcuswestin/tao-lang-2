import { AfterEach, Describe, Expect, Test, testOverrideSlot, until, withCapturedOutput } from '@shared/test'
import { CLI, Errors, Platform, ProcessTree, Time, type TrackedProcess } from '../shared-src/shared'

/**
 * These tests start real process trees, so each one registers what it started for cleanup: a leaked
 * `sleep` would outlive the suite and a leaked tree would outlive the lane. A sleeping shell is the
 * deliberate stand-in for a runaway child — reproducing the formatter runaway that motivated this
 * supervision would put the machine back in the state it exists to prevent.
 */
const abandoned: number[] = []
type SetTimeoutCall = (...args: Parameters<typeof globalThis.setTimeout>) => ReturnType<typeof globalThis.setTimeout>
type ClearTimeoutCall = (handle: ReturnType<typeof globalThis.setTimeout> | number | undefined) => void

const setTimeoutSlot = testOverrideSlot<SetTimeoutCall>({
  read: () => globalThis.setTimeout,
  write: value => {
    globalThis.setTimeout = value as typeof globalThis.setTimeout
  },
})
const clearTimeoutSlot = testOverrideSlot<ClearTimeoutCall>({
  read: () => globalThis.clearTimeout,
  write: value => {
    globalThis.clearTimeout = value as typeof globalThis.clearTimeout
  },
})
const mutableProcessTree = ProcessTree as unknown as {
  groupMembers: typeof ProcessTree.groupMembers
  signalGroup: typeof ProcessTree.signalGroup
}
const groupMembersSlot = testOverrideSlot<typeof ProcessTree.groupMembers>({
  read: () => ProcessTree.groupMembers,
  write: value => {
    mutableProcessTree.groupMembers = value
  },
})
const signalGroupSlot = testOverrideSlot<typeof ProcessTree.signalGroup>({
  read: () => ProcessTree.signalGroup,
  write: value => {
    mutableProcessTree.signalGroup = value
  },
})

type VirtualTimeout = {
  callback: () => void
  cancelled: boolean
  dueAt: number
  fired: boolean
}

/** virtualIdleTimers replaces only one requested delay; all unrelated runner timers stay real. */
function virtualIdleTimers(idleOutputMs: number): {
  advanceTo: (now: number) => void
  clearTimeout: ClearTimeoutCall
  setTimeout: SetTimeoutCall
} {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const timeouts = new Map<ReturnType<typeof setTimeout>, VirtualTimeout>()
  let now = 0
  let nextId = 0
  const setTimeoutForTest: SetTimeoutCall = (...args) => {
    const [handler, timeout, ...callbackArgs] = args
    if (timeout !== idleOutputMs || typeof handler !== 'function') {
      return originalSetTimeout(...args)
    }
    const handle = { id: nextId++ } as unknown as ReturnType<typeof setTimeout>
    timeouts.set(handle, {
      callback: () => Reflect.apply(handler, undefined, callbackArgs),
      cancelled: false,
      dueAt: now + timeout,
      fired: false,
    })
    return handle
  }
  const clearTimeoutForTest: ClearTimeoutCall = handle => {
    const timeout = timeouts.get(handle as ReturnType<typeof setTimeout>)
    if (timeout) {
      timeout.cancelled = true
    } else {
      originalClearTimeout(handle as ReturnType<typeof setTimeout> | number | undefined)
    }
  }
  return {
    advanceTo(target) {
      Expect(target).toBeGreaterThanOrEqual(now)
      now = target
      while (true) {
        const next = [...timeouts.values()]
          .filter(timeout => !timeout.cancelled && !timeout.fired && timeout.dueAt <= now)
          .sort((left, right) => left.dueAt - right.dueAt)[0]
        if (!next) {
          return
        }
        next.fired = true
        next.callback()
      }
    },
    clearTimeout: clearTimeoutForTest,
    setTimeout: setTimeoutForTest,
  }
}

AfterEach(() => {
  for (const pid of abandoned.splice(0)) {
    Platform.signalProcess(pid, 'SIGKILL')
  }
})

/** A shell that reports the PID of a grandchild it backgrounds, then waits for it. */
const REPORT_GRANDCHILD = 'sleep 300 & echo $!; wait'

type StartedTree = {
  child: TrackedProcess
  command: CLI.StartedCommand
  grandchild: TrackedProcess
  output: () => string
}

/** startTree starts a shell with a backgrounded grandchild and resolves once both PIDs are known. */
async function startTree(spec: CLI.CommandSpec = {}): Promise<StartedTree> {
  let text = ''
  const command = CLI.start('/bin/sh', {
    args: ['-c', REPORT_GRANDCHILD],
    onOutput: (_stream, chunk) => {
      text += chunk.toString('utf8')
    },
    stdio: 'pipe',
    ...spec,
  })
  const childPid = command.pid ?? 0
  Expect(childPid).toBeGreaterThan(1)
  abandoned.push(childPid)
  const grandchildPid = await until(() => {
    const match = /^(\d+)\n/u.exec(text)
    return match?.[1] === undefined ? undefined : Number(match[1])
  }, { description: 'the backgrounded grandchild to report its PID' })
  abandoned.push(grandchildPid)
  const identities = await until(
    () => {
      const found = ProcessTree.identities([childPid, grandchildPid])
      return found.size === 2 ? found : undefined
    },
    { description: `processes ${childPid} and ${grandchildPid} to carry start identities` },
  )
  const child = identities.get(childPid)
  const grandchild = identities.get(grandchildPid)
  Expect(child?.pid).toBe(childPid)
  Expect(grandchild?.pid).toBe(grandchildPid)

  return { child: child!, command, grandchild: grandchild!, output: () => text }
}

/** isAlive reports whether the exact process that was tracked still runs, not merely that its PID exists. */
function isAlive(tracked: TrackedProcess): boolean {
  return ProcessTree.sameProcess(ProcessTree.identities([tracked.pid]).get(tracked.pid), tracked)
}

async function waitForGone(tracked: TrackedProcess, description: string): Promise<void> {
  await until(() => !isAlive(tracked), { description })
}

Describe('CLI process policy', () => {
  for (const verdict of [0, 7]) {
    Test(`reports failed cleanup inspection while retaining child verdict ${verdict}`, async () => {
      let output = ''
      const command = CLI.start('/bin/sh', {
        args: ['-c', `sleep 300 & echo $!; read reply; exit ${verdict}`],
        detached: true,
        processPolicy: 'test',
        onOutput: (_stream, chunk) => {
          output += chunk.toString()
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeoutMs: 30_000,
        timeoutPolicy: 'bounded',
      })
      let restore = () => {}
      let restoreSignal = () => {}
      try {
        const pid = await until(() => Number(/^(\d+)/.exec(output)?.[1]) || undefined, { timeoutPolicy: 'bounded' })
        abandoned.push(pid)
        const identity = ProcessTree.identities([pid]).get(pid)!
        restore = groupMembersSlot.install(() => Errors.throwHostEnvironment('fixture group inspection denied'))
        restoreSignal = signalGroupSlot.install(() => Errors.throwHostEnvironment('fixture group inspection denied'))
        command.writeStdin('exit\n')
        const result = await command.waitForClose()
        Expect(result.exitCode).toBe(verdict || 1)
        Expect(output).toContain('Test process cleanup could not be verified')
        Expect(output).toContain('fixture group inspection denied')
        Expect(isAlive(identity)).toBe(false)
      } finally {
        restore()
        restoreSignal()
        command.kill('SIGKILL')
        await command.waitForClose()
        command.dispose()
      }
    })
  }

  Test('stops an isolated child forked from the direct child termination handler', async () => {
    let output = ''
    const command = CLI.start('/bin/sh', {
      args: ['-c', 'trap \'trap "" TERM; sleep 300 & echo late:$!; exit 7\' TERM; echo ready; while :; do :; done'],
      detached: true,
      processPolicy: 'test',
      onOutput: (_stream, chunk) => {
        output += chunk.toString()
      },
      stdio: 'pipe',
      timeoutMs: 30_000,
      timeoutPolicy: 'bounded',
    })
    try {
      await until(() => output.includes('ready'), { timeoutPolicy: 'bounded' })
      command.kill('SIGTERM')
      const pid = await until(() => Number(/late:(\d+)/.exec(output)?.[1]) || undefined, { timeoutPolicy: 'bounded' })
      abandoned.push(pid)
      const result = await command.waitForClose()
      Expect(result.exitCode).toBe(7)
      Expect(Platform.processIsAlive(pid)).toBe(false)
    } finally {
      command.kill('SIGKILL')
      await command.waitForClose()
    }
  })

  Test('waits for a descendant that closes its pipes and ignores termination after its parent closes', async () => {
    let output = ''
    const command = CLI.start('/bin/sh', {
      args: ['-c', 'sh -c \'trap "" TERM; echo $$; exec >/dev/null 2>&1; while :; do :; done\' & wait'],
      processPolicy: 'test',
      onOutput: (_stream, chunk) => {
        output += chunk.toString()
      },
      stdio: 'pipe',
      timeoutMs: 30_000,
      timeoutPolicy: 'bounded',
    })
    try {
      const pid = await until(() => Number(/^(\d+)/.exec(output)?.[1]) || undefined)
      abandoned.push(pid)
      const identity = ProcessTree.identities([pid]).get(pid)!
      Expect(identity).toBeDefined()
      command.kill('SIGTERM')
      await command.waitForClose()
      // Assert at the join, with no later wait that could hide premature cleanup completion.
      Expect(isAlive(identity)).toBe(false)
    } finally {
      command.kill('SIGKILL')
      await command.waitForClose()
    }
  })

  Test('preserves a failed parent exit while stopping a child holding its output pipes', async () => {
    let output = ''
    const command = CLI.start('/bin/sh', {
      args: ['-c', 'sleep 300 & echo $!; read reply; echo "original suite failure" >&2; exit 7'],
      processPolicy: 'test',
      onOutput: (_stream, chunk) => {
        output += chunk.toString()
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeoutMs: 30_000,
      timeoutPolicy: 'bounded',
    })
    try {
      const pid = await until(() => Number(/^(\d+)/.exec(output)?.[1]) || undefined)
      abandoned.push(pid)
      const identity = ProcessTree.identities([pid]).get(pid)!
      Expect(identity).toBeDefined()
      command.writeStdin('exit\n')
      const result = await command.waitForClose()
      Expect(result.exitCode).toBe(7)
      Expect(result.signal).toBe(null)
      Expect(output).toContain('original suite failure')
      Expect(isAlive(identity)).toBe(false)
    } finally {
      command.kill('SIGKILL')
      await command.waitForClose()
    }
  })
  Test('no policy detaches a child; only the caller decides its process group', async () => {
    const ownGroup = ProcessTree.processGroupOf(Platform.runtimeProcess.pid)
    const toolChild = await startTree()
    const testChild = await startTree({ processPolicy: 'test' })
    const detachedChild = await startTree({ detached: true })

    Expect(ownGroup).toBeGreaterThan(0)
    // A child that stays in the caller's process group is one the terminal's Ctrl-C still reaches.
    Expect(ProcessTree.processGroupOf(toolChild.child.pid)).toBe(ownGroup)
    Expect(ProcessTree.processGroupOf(testChild.child.pid)).toBe(ownGroup)
    // Only the caller's own `detached` makes a child lead a group of its own.
    Expect(ProcessTree.processGroupOf(detachedChild.child.pid)).toBe(detachedChild.child.pid)

    for (const started of [toolChild, testChild, detachedChild]) {
      started.command.kill('SIGKILL')
      await waitForGone(started.grandchild, 'the process-group probe to be cleaned up')
    }
  })

  Test(`'test' policy stops a child's whole tree without detaching it`, async () => {
    const sibling = await startTree()
    const supervised = await startTree({ processPolicy: 'test' })

    // The teardown must not depend on a group leader: this child shares the caller's group, and
    // what reaches the grandchild is the tracked-descendant signalling, not the group signal.
    Expect(ProcessTree.processGroupOf(supervised.child.pid))
      .toBe(ProcessTree.processGroupOf(Platform.runtimeProcess.pid))
    Expect(supervised.command.kill()).toBe(true)

    await waitForGone(supervised.grandchild, 'the supervised grandchild to be gone')
    await waitForGone(supervised.child, 'the supervised child to be gone')
    // The grandchild inherited the child's pipes, so a close only arrives once it too has exited:
    // this await is what would hang if the teardown had reached the child alone.
    await supervised.command.waitForClose()
    Expect(supervised.command.exitCode ?? supervised.command.signalCode).not.toBe(null)
    // A lane may stop only what it started: the sibling tree was never handed to that command.
    Expect(isAlive(sibling.grandchild)).toBe(true)
    Expect(isAlive(sibling.child)).toBe(true)
    Expect(sibling.command.exitCode).toBe(null)

    sibling.command.kill('SIGKILL')
    await waitForGone(sibling.grandchild, 'the sibling tree to be cleaned up')
  })

  Test(`'server' policy signals the direct child only, so its grandchild survives`, async () => {
    const server = await startTree({ processPolicy: 'server' })

    Expect(server.command.kill('SIGTERM')).toBe(true)

    await waitForGone(server.child, 'the server child itself to exit')
    // Metro, Studio and the simulator idle legitimately; the opt-out has to be real, not advisory.
    Expect(isAlive(server.grandchild)).toBe(true)
  })

  Test('a wall-clock bound stops the tree and names the bound it hit', async () => {
    // This is the timeoutMs under test — it names the bound the tree gets stopped for hitting.
    // budget-ok: not a speed budget on the test itself.
    const bounded = await startTree({ processPolicy: 'test', timeoutMs: 600, timeoutPolicy: 'bounded' })

    const close = await bounded.command.waitForClose()

    Expect(close.signal).toBe('SIGTERM')
    Expect(bounded.output()).toContain('timed out after 600ms')
    await waitForGone(bounded.grandchild, 'the timed-out grandchild to be gone')
  })

  Test('an idle-output bound stops a child that printed and then went quiet', async () => {
    const bounded = await startTree({ idleOutputMs: 500, processPolicy: 'test', timeoutPolicy: 'bounded' })

    const close = await bounded.command.waitForClose()

    Expect(close.signal).toBe('SIGTERM')
    Expect(bounded.output()).toContain('timed out with no output for 500ms')
    await waitForGone(bounded.grandchild, 'the idle grandchild to be gone')
  })

  Test('output restarts the idle bound while the real child continues printing', async () => {
    const idleOutputMs = 8_731
    const timers = virtualIdleTimers(idleOutputMs)
    const restoreSetTimeout = setTimeoutSlot.install(timers.setTimeout)
    const restoreClearTimeout = clearTimeoutSlot.install(timers.clearTimeout)
    let output = ''
    let command: CLI.StartedCommand | undefined
    let waitedForClose = false
    try {
      command = CLI.start('/bin/sh', {
        args: ['-c', 'while IFS= read -r tick; do printf "%s\\n" "$tick"; done'],
        idleOutputMs,
        onOutput: (_stream, chunk) => {
          output += chunk.toString('utf8')
        },
        processPolicy: 'test',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeoutPolicy: 'bounded',
      })

      timers.advanceTo(idleOutputMs - 1)
      command.writeStdin('tick one\n')
      await until(() => output.includes('tick one\n'), { description: 'the child to print its first tick' })
      timers.advanceTo(idleOutputMs + 1)
      Expect(output).not.toContain('timed out with no output')

      command.writeStdin('tick two\n')
      await until(() => output.includes('tick two\n'), { description: 'the child to print its second tick' })
      timers.advanceTo(idleOutputMs * 2)
      Expect(output).not.toContain('timed out with no output')

      command.endStdin()
      const close = await command.waitForClose()
      waitedForClose = true
      Expect(close.exitCode).toBe(0)
      Expect(close.signal).toBe(null)
      Expect(output).toBe('tick one\ntick two\n')
    } finally {
      try {
        if (command && !waitedForClose) {
          command.kill('SIGKILL')
          await command.waitForClose()
        }
      } finally {
        try {
          await command?.closeOutput()
        } finally {
          try {
            restoreClearTimeout()
          } finally {
            restoreSetTimeout()
          }
        }
      }
    }
  })

  Test('run surfaces the bound it hit through its CommandResult', async () => {
    // This is the timeoutMs under test — the child sleeps 30s and the test proves the bound this run
    // surfaces, not that the run is fast.
    const result = await CLI.run('/bin/sh', {
      args: ['-c', 'sleep 30'],
      processPolicy: 'test',
      stdio: 'pipe',
      timeoutMs: 400, // budget-ok: the timeout value under test.
      timeoutPolicy: 'bounded',
    })

    Expect(result.signal).toBe('SIGTERM')
    Expect(result.stderr).toContain('timed out after 400ms')
  })

  Test('a bound reaches the terminal when the child has no wrapper output sink', async () => {
    // With inherited stdio the child writes straight to the terminal, so the reason line has no
    // captured buffer, no `onOutput` and no prefixed log to land in. It must not vanish.
    const captured = await withCapturedOutput(async () => {
      // This is the timeoutMs under test — the child sleeps 30s and the test proves the bound reaches
      // the terminal, not that the run is fast.
      const command = CLI.start('/bin/sh', {
        args: ['-c', 'sleep 30'],
        processPolicy: 'test',
        stdio: 'inherit',
        timeoutMs: 300, // budget-ok: the timeout value under test.
        timeoutPolicy: 'bounded',
      })
      return await command.waitForClose()
    })

    Expect(captured.result.signal).toBe('SIGTERM')
    Expect(captured.stderr).toContain('timed out after 300ms')
    Expect(captured.stdout).toBe('')
  })

  Test('a bound declared on a policy that cannot enforce it is refused', () => {
    // budget-ok: refused synchronously by validation before any process runs, so no wait starts.
    Expect(() => CLI.start('/bin/sh', { args: ['-c', 'exit 0'], processPolicy: 'server', timeoutMs: 100 }))
      .toThrow(/timeoutMs only on a 'test' process policy/u)
    Expect(() => CLI.start('/bin/sh', { args: ['-c', 'exit 0'], idleOutputMs: 100 }))
      .toThrow(/idleOutputMs only on a 'test' process policy/u)
    // budget-ok: refused synchronously by validation before any process runs, so no wait starts.
    Expect(() => CLI.start('/bin/sh', { args: ['-c', 'exit 0'], processPolicy: 'test', timeoutMs: 0 }))
      .toThrow(/a positive timeoutMs/u)
  })
})

Describe('ProcessTree', () => {
  Test('native signalling rejects broadcast IDs and reports a missing process', () => {
    for (const pid of [0, 1, -1, 1.5, NaN, 2_147_483_648]) {
      Expect(() => Platform.signalProcess(pid, 0)).toThrow(/Expected a process ID/u)
    }
    Expect(Platform.signalProcess(Platform.runtimeProcess.pid, 0)).toBe(true)
    Expect(Platform.signalProcess(2_147_483_647, 0)).toBe(false)
  })

  Test('descendants reports a grandchild with its start identity, deepest first', async () => {
    const started = await startTree({ processPolicy: 'server' })

    const direct = ProcessTree.descendants(started.child.pid)
    const own = ProcessTree.descendants(Platform.runtimeProcess.pid)
    const grandchildIndex = own.findIndex(entry => entry.pid === started.grandchild.pid)
    const childIndex = own.findIndex(entry => entry.pid === started.child.pid)

    Expect(direct.map(entry => entry.pid)).toEqual([started.grandchild.pid])
    Expect(direct[0]?.startedAt).toBe(started.grandchild.startedAt)
    Expect(grandchildIndex).toBeGreaterThanOrEqual(0)
    Expect(childIndex).toBeGreaterThanOrEqual(0)
    // Deepest first: a parent must not get the chance to replace a child already stopped.
    Expect(grandchildIndex).toBeLessThan(childIndex)

    started.command.kill('SIGKILL')
    await waitForGone(started.child, 'the inspected child to exit')
  })

  Test('signalTracked skips a PID whose start identity no longer matches', () => {
    const tracked: TrackedProcess[] = [
      { command: 'kept', pid: 4_001, startedAt: '100:0' },
      { command: 'reused', pid: 4_002, startedAt: '200:0' },
    ]
    const signalled: number[][] = []

    ProcessTree.signalTracked(tracked, 'SIGTERM', {
      identities: () =>
        new Map([
          [4_001, { command: 'kept', pid: 4_001, startedAt: '100:0' }],
          // The kernel handed 4002 to somebody else's work between the snapshot and the signal.
          [4_002, { command: 'reused', pid: 4_002, startedAt: '999:0' }],
        ]),
      signal: pids => signalled.push([...pids]),
    })

    Expect(signalled).toEqual([[4_001]])
  })

  Test("signalTracked still signals a descendant that exec'd since the snapshot", () => {
    // A shell backgrounding `sleep 300` reports the PID between the fork and the exec, so a tracked
    // descendant is routinely captured under the shell's own name and reads back under the command
    // it became. Treating that as a different process left the runaway alive — the exact failure
    // this module exists to prevent, and it widened with load, which is when it mattered most.
    const tracked: TrackedProcess[] = [{ command: 'bash', pid: 4_003, startedAt: '100:0' }]
    const signalled: number[][] = []

    ProcessTree.signalTracked(tracked, 'SIGTERM', {
      // Same PID, same start time, the name it took at exec.
      identities: () => new Map([[4_003, { command: 'coreutils', pid: 4_003, startedAt: '100:0' }]]),
      signal: pids => signalled.push([...pids]),
    })

    Expect(signalled).toEqual([[4_003]])
  })

  Test('signalTracked signals nothing when no tracked identity is still present', () => {
    const signalled: number[][] = []

    ProcessTree.signalTracked([{ command: 'gone', pid: 4_003, startedAt: '100:0' }], 'SIGKILL', {
      identities: () => new Map(),
      signal: pids => signalled.push([...pids]),
    })

    Expect(signalled).toEqual([])
  })

  Test('stopTree escalates past an ignored SIGTERM and resolves only once the tree has gone', async () => {
    // A tree that ignores SIGTERM is the case that made the grace period necessary: the Studio
    // canary's launch process survived cancellation and held the lane open through it.
    const started = await startTree({
      args: ['-c', `trap '' TERM; ${REPORT_GRANDCHILD}`],
      detached: true,
      processPolicy: 'server',
    })

    Expect(ProcessTree.isGroupAlive(started.child.pid)).toBe(true)
    const startedAtMs = Time.nowMs()
    await ProcessTree.stopTree(started.command.pid, { graceMs: 150 })
    const elapsedMs = Time.nowMs() - startedAtMs

    // stopTree does not resolve on a signal delivered; it resolves on the tree having exited.
    Expect(elapsedMs).toBeGreaterThanOrEqual(120)
    Expect(isAlive(started.grandchild)).toBe(false)
    Expect(isAlive(started.child)).toBe(false)
    Expect(ProcessTree.isGroupAlive(started.child.pid)).toBe(false)
  })
})

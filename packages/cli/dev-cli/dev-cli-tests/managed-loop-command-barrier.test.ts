import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import { Deferred, Expect, mkTestDir, Test } from '@shared/test'

// Engineering spike only. Empty groups cannot prove absence of unobserved escaped descendants.
// These fixed source children provide a known command contract; arbitrary native commands do not.
type Capture = {
  state: 'captured' | 'published' | 'retained' | 'closed'
  supervisor: TrackedProcess
  worker: TrackedProcess
  workerParentPid: number
  group: number
  owner: { identity: TrackedProcess; generation: string }
  trackedDescendants: TrackedProcess[]
}
async function barrier(mode: 'short' | 'escape' = 'short') {
  const root = await mkTestDir('managed-command-barrier-')
  const path = FS.resolvePath('capture.json', root)
  const owner = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)!
  const generation = Platform.randomUUID()
  let currentGeneration = generation
  let cancelled = false
  let observation: 'unreadable' | 'replacement' | undefined
  let output = ''
  let stderr = ''
  let capture: Capture | undefined
  let refusedAdmission = false
  let finished = false
  const child = CLI.start(Platform.runtimeProcess.execPath, {
    args: [
      Repo.resolvePath('packages/cli/dev-cli/dev-cli-tests/managed-loop-command-barrier-supervisor.ts'),
      mode,
      root,
    ],
    cwd: Repo.getRoot(),
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    processPolicy: 'test',
    timeoutMs: 30_000,
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') {
        output += chunk.toString('utf8')
      } else {
        stderr += chunk.toString('utf8')
      }
    },
  })
  const persist = async () => {
    const temporary = FS.resolvePath('capture-pending.json', root)
    await FS.writeJson(temporary, capture)
    await FS.chmod(temporary, 0o600)
    await FS.move(temporary, path)
  }
  const retain = async (error: unknown): Promise<never> => {
    refusedAdmission = true
    if (capture) {
      capture.state = 'retained'
      await persist()
    }
    Errors.throwHostEnvironment('The source command barrier retains uncertain admission or drain.', { cause: error })
  }
  const workerClosed = () => {
    const line = output.match(/worker-closed (\{[^\n]+\})\n/u)?.[1]
    return line === undefined ? undefined : JSON.parse(line) as CLI.CommandCloseResult
  }
  const captureAndPublish = async (publish?: () => Promise<void>) => {
    const ready = await Time.pollUntil(() => {
      const worker = output.match(/worker-ready (\d+) (\d+)\n/u)
      const handle = output.match(/supervisor-worker (\d+)\n/u)?.[1]
      return worker && handle
        ? { pid: Number(worker[1]), parentPid: Number(worker[2]), handlePid: Number(handle) }
        : undefined
    }, {
      intervalMs: 25,
      timeoutMs: 30_000,
    })
    if (!ready || !child.pid) {
      Errors.throwHostEnvironment(`Fixed source worker did not become ready: ${stderr}`)
    }
    const identities = ProcessTree.identities([child.pid, ready.pid])
    const supervisor = identities.get(child.pid)
    const worker = identities.get(ready.pid)
    const members = ProcessTree.groupMembers(child.pid)
    // The fixed shell reports its kernel-initialized PPID; kernel descendant inspection
    // independently checks ancestry. The sandbox's ps-backed process table is unavailable.
    if (
      !supervisor || !worker || ready.parentPid !== supervisor.pid || ready.handlePid !== worker.pid
      || !ProcessTree.descendants(supervisor.pid).some(process =>
        process.pid === worker.pid && ProcessTree.sameProcess(process, worker)
      )
      || ProcessTree.processGroupOf(supervisor.pid) !== supervisor.pid
      || ProcessTree.processGroupOf(worker.pid) !== supervisor.pid
      || members.length !== 2
      || !members.some(process => process.pid === supervisor.pid && ProcessTree.sameProcess(process, supervisor))
      || !members.some(process => process.pid === worker.pid && ProcessTree.sameProcess(process, worker))
    ) {
      Errors.throwHostEnvironment(
        `The source barrier could not prove its exact supervisor/worker relation and group: ${stderr}`,
      )
    }
    capture = {
      state: 'captured',
      supervisor,
      worker,
      workerParentPid: ready.parentPid,
      group: supervisor.pid,
      owner: { identity: owner, generation },
      trackedDescendants: [],
    }
    try {
      await persist()
      await publish?.()
      if (refusedAdmission) {
        Errors.throwHostEnvironment('Source barrier refusal remains latched after publication settles.')
      }
      capture.state = 'published'
      await persist()
      const saved = await FS.readJson<Capture>(path)
      Expect(saved).toEqual(capture)
    } catch (error) {
      await retain(error)
    }
    return capture!
  }
  const release = async () => {
    try {
      if (refusedAdmission || !capture || capture.state !== 'published') {
        Errors.throwHostEnvironment('Source mutation requires completed durable capture.')
      }
      const identities = ProcessTree.identities([capture.supervisor.pid, capture.worker.pid])
      const supervisor = identities.get(capture.supervisor.pid)
      let worker = identities.get(capture.worker.pid)
      const members = ProcessTree.groupMembers(capture.group)
      if (observation === 'unreadable') {
        worker = undefined
      }
      if (observation === 'replacement' && worker) {
        worker = { ...worker, startedAt: 'injected-replacement-kernel' }
      }
      if (
        cancelled || currentGeneration !== generation || child.error !== undefined || child.exitCode !== null
        || child.signalCode !== null
        || !ProcessTree.sameProcess(ProcessTree.identities([owner.pid]).get(owner.pid), owner)
        || !supervisor || !worker || supervisor.pid !== capture.supervisor.pid || worker.pid !== capture.worker.pid
        || !ProcessTree.sameProcess(supervisor, capture.supervisor) || !ProcessTree.sameProcess(worker, capture.worker)
        || capture.workerParentPid !== supervisor.pid
        || !ProcessTree.descendants(supervisor.pid).some(process =>
          process.pid === worker!.pid && ProcessTree.sameProcess(process, worker!)
        )
        || ProcessTree.processGroupOf(worker.pid) !== capture.group
        || ProcessTree.processGroupOf(supervisor.pid) !== capture.group
        || members.length !== 2
        || !members.some(process => process.pid === supervisor.pid && ProcessTree.sameProcess(process, supervisor))
        || !members.some(process => process.pid === worker!.pid && ProcessTree.sameProcess(process, worker!))
      ) {
        Errors.throwHostEnvironment(
          'Source barrier admission lost its owner, cancellation, original kernels, or group relation.',
        )
      }
      // No asynchronous boundary separates the fresh owner/kernel checks from physical release.
      if (!child.writeStdin('run\n')) {
        Errors.throwHostEnvironment('The fixed source worker release pipe refused its ACK.')
      }
    } catch (error) {
      await retain(error)
    }
  }
  const finish = async () => {
    try {
      const closed = await Time.pollUntil(workerClosed, { intervalMs: 25, timeoutMs: 30_000 })
      if (!closed || !capture) {
        Errors.throwHostEnvironment(`The source worker did not close: ${stderr}`)
      }
      const worker = ProcessTree.identities([capture.worker.pid]).get(capture.worker.pid)
      const descendants = ProcessTree.identities(capture.trackedDescendants.map(process => process.pid))
      const members = ProcessTree.groupMembers(capture.group)
      if (
        worker !== undefined || Platform.processIsAlive(capture.worker.pid)
        // A tracked descendant escaped the supervisor, so nothing in the group reaps it.
        || capture.trackedDescendants.some(process => descendants.has(process.pid) || escapedStillRuns(process.pid))
        || members.length !== 1 || members[0]!.pid !== capture.supervisor.pid
        || !ProcessTree.sameProcess(members[0], capture.supervisor)
        || child.exitCode !== null || child.signalCode !== null
      ) {
        Errors.throwHostEnvironment(
          'Source barrier drain lacks original worker/descendant absence and sole captured supervisor proof.',
        )
      }
      if (!child.writeStdin('finish\n')) {
        Errors.throwHostEnvironment('The captured supervisor refused its final drain ACK.')
      }
      const result = await child.waitForClose()
      Expect(result.exitCode).toBe(0)
      Expect(result.signal).toBe(null)
      Expect(
        await Time.pollUntil(() => ProcessTree.isGroupAlive(capture!.group) ? undefined : true, {
          intervalMs: 25,
          timeoutMs: 30_000,
        }),
      ).toBe(true)
      Expect(ProcessTree.groupMembers(capture.group)).toEqual([])
      capture.state = refusedAdmission ? 'retained' : 'closed'
      await persist()
      finished = true
      return closed
    } catch (error) {
      return await retain(error)
    }
  }
  const cleanup = async () => {
    try {
      if (!finished) {
        child.endStdin()
        await child.waitForClose()
      }
      await child.closeOutput()
    } finally {
      child.dispose()
      if (capture) {
        Expect(ProcessTree.isGroupAlive(capture.group)).toBe(false)
      }
      await FS.remove(root)
    }
  }
  return {
    root,
    path,
    child,
    captureAndPublish,
    release,
    finish,
    cleanup,
    workerClosed,
    cancel: () => {
      cancelled = true
      child.writeStdin('cancel\n')
    },
    rotateOwner: () => {
      currentGeneration = Platform.randomUUID()
    },
    observe: (kind: 'unreadable' | 'replacement') => {
      observation = kind
    },
    protocol: (line: string) => child.writeStdin(line),
    capture: () => capture!,
    persist,
  }
}

Test(
  'source command barrier publishes both kernels before ultrashort exec and joins only after independent drain proof',
  async () => {
    const f = await barrier()
    const publication = Deferred<void>()
    try {
      const pending = f.captureAndPublish(() => publication.promise)
      await Time.pollUntil(async () => await FS.isFile(f.path) ? true : undefined, {
        intervalMs: 25,
        timeoutMs: 30_000,
      })
      Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
      Expect(f.child.exitCode).toBe(null)
      publication.resolve()
      const captured = await pending
      await f.release()
      await Time.pollUntil(f.workerClosed, { intervalMs: 25, timeoutMs: 30_000 })
      const mutation = await FS.readJson<{ identity: TrackedProcess; publishedState: string }>(
        FS.resolvePath('mutation.json', f.root),
      )
      Expect(mutation.publishedState).toBe('published')
      Expect(mutation.identity.pid).toBe(captured.worker.pid)
      Expect(mutation.identity.startedAt).toBe(captured.worker.startedAt)
      Expect(f.child.exitCode).toBe(null)
      Expect(ProcessTree.groupMembers(captured.group).map(process => process.pid)).toEqual([captured.supervisor.pid])
      Expect((await f.finish()).exitCode).toBe(0)
      Expect((await FS.readJson<Capture>(f.path)).state).toBe('closed')
    } finally {
      publication.resolve()
      await f.cleanup()
    }
  },
)

for (const refusal of ['publication', 'cancel', 'owner', 'unreadable', 'replacement'] as const) {
  Test(`source command barrier ${refusal} refusal retains captured identities and has no mutation effect`, async () => {
    const f = await barrier()
    try {
      if (refusal === 'publication') {
        await Expect(
          f.captureAndPublish(async () => Errors.throwHostEnvironment('Injected durable publication denial')),
        ).rejects.toThrow('retains uncertain')
      } else {
        await f.captureAndPublish()
        if (refusal === 'cancel') {
          f.cancel()
        }
        if (refusal === 'owner') {
          f.rotateOwner()
        }
        if (refusal === 'unreadable' || refusal === 'replacement') {
          f.observe(refusal)
        }
        await Expect(f.release()).rejects.toThrow('retains uncertain')
      }
      const saved = await FS.readJson<Capture>(f.path)
      Expect(saved.state).toBe('retained')
      Expect(saved.worker.startedAt).toBe(f.capture().worker.startedAt)
      Expect(saved.supervisor.startedAt).toBe(f.capture().supervisor.startedAt)
      if (refusal !== 'cancel') {
        f.protocol('cancel\n')
      }
      Expect((await f.finish()).exitCode).not.toBe(0)
      Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
    } finally {
      await f.cleanup()
    }
  })
}

for (const control of ['eof', 'malformed', 'timeout'] as const) {
  Test(`fixed source worker ${control} before execution ACK cannot mutate`, async () => {
    const f = await barrier()
    try {
      await f.captureAndPublish()
      if (control === 'eof') {
        f.child.endStdin()
      }
      if (control === 'malformed') {
        f.protocol('execute-arbitrary-command\n')
      }
      if (control === 'timeout') {
        Expect((await f.finish()).exitCode).toBe(70)
      } else {
        Expect((await f.child.waitForClose()).exitCode).toBe(72)
        Expect(ProcessTree.isGroupAlive(f.capture().group)).toBe(false)
      }
      Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
    } finally {
      await f.cleanup()
    }
  })
}

Test(
  'source barrier refuses a visible escaped descendant despite a sole supervisor group and signals only its captured kernel',
  async () => {
    const f = await barrier('escape')
    let escaped: TrackedProcess | undefined
    const signalled: number[] = []
    try {
      await f.captureAndPublish()
      await f.release()
      await Time.pollUntil(
        async () => await FS.isFile(FS.resolvePath('escape-visible.json', f.root)) ? true : undefined,
        { intervalMs: 25, timeoutMs: 30_000 },
      )
      const reported = await FS.readJson<{ pid: number }>(FS.resolvePath('escape-visible.json', f.root))
      const candidate = ProcessTree.identities([reported.pid]).get(reported.pid)
      Expect(candidate).toBeDefined()
      Expect(
        ProcessTree.descendants(f.capture().worker.pid).some(process =>
          process.pid === candidate!.pid && ProcessTree.sameProcess(process, candidate!)
        ),
      ).toBe(true)
      Expect(ProcessTree.descendants(f.capture().supervisor.pid).some(process => process.pid === candidate?.pid)).toBe(
        true,
      )
      Expect(ProcessTree.processGroupOf(candidate!.pid)).not.toBe(f.capture().group)
      escaped = candidate!
      f.capture().trackedDescendants.push(escaped)
      await f.persist()
      await FS.writeJson(FS.resolvePath('escape-captured.json', f.root), true)
      await Time.pollUntil(f.workerClosed, { intervalMs: 25, timeoutMs: 30_000 })
      Expect(ProcessTree.groupMembers(f.capture().group).map(process => process.pid)).toEqual([
        f.capture().supervisor.pid,
      ])
      await Expect(f.finish()).rejects.toThrow('retains uncertain')
      Expect(f.child.exitCode).toBe(null)
      Expect((await FS.readJson<Capture>(f.path)).state).toBe('retained')
      ProcessTree.signalTracked([escaped], 'SIGTERM', {
        identities: pids => ProcessTree.identities(pids),
        signal: (pids, signal) => {
          signalled.push(...pids)
          ProcessTree.systemSignalSeams.signal(pids, signal)
        },
      })
      Expect(signalled).toEqual([escaped.pid])
      Expect(
        await Time.pollUntil(
          () =>
            escapedStillRuns(escaped!.pid)
              ? undefined
              : true,
          { intervalMs: 25, timeoutMs: 30_000 },
        ),
      ).toBe(true)
      Expect((await f.finish()).exitCode).toBe(0)
    } finally {
      if (escaped && escapedStillRuns(escaped.pid)) {
        ProcessTree.signalTracked([escaped], 'SIGTERM')
        Expect(
          await Time.pollUntil(
            () =>
              escapedStillRuns(escaped!.pid)
                ? undefined
                : true,
            { intervalMs: 25, timeoutMs: 30_000 },
          ),
        ).toBe(true)
      }
      await f.cleanup()
    }
  },
)

/**
 * A killed orphan stays an unreaped zombie in a container whose first process does not reap, and
 * kill(0) still succeeds on a zombie. Linux's proc table already leaves zombies out of identities,
 * so only Darwin, where launchd reaps promptly, also asks kill(0).
 */
function escapedStillRuns(pid: number): boolean {
  return ProcessTree.identities([pid]).has(pid) || (Platform.hostPlatform !== 'linux' && Platform.processIsAlive(pid))
}

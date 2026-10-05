import { EXPO_SDK_VERSION } from '@expo-host/dev-loop/expo-runner/expo-config'
import { Assert, CLI, Errors, FS, Platform, ProcessTree, Repo, Time } from '@shared'
import { Deferred, Expect, mkTestDir, Test } from '@shared/test'
import {
  managedIosCommandArguments,
  type ManagedIosCommandEvidence,
  type ManagedIosCommandPlan,
  type ManagedIosNativeExecution,
  runManagedIosCommandBarrier,
} from '../dev-cli-src/dev-loop/ManagedIosCommandBarrier'

// Real kernels execute fixed repository source children. These tests never release a native worker.
// Native ancestry plus the private child handle corroborates shell PPID; it is not authenticated direct PPID.
// Group emptiness cannot prove absence of unobserved escaped descendants.
async function fixture(
  mode: 'short' | 'hold' | 'nonzero' | 'escape' | 'metadata' | 'refuse-worker-ack' | 'reject-worker-close' = 'short',
  budgetMs = 20_000,
  stage: 'boot' | 'download' = 'boot',
) {
  const invocation = Platform.randomUUID()
  const parent = stage === 'download'
    ? Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}/source-barrier`)
    : await mkTestDir('managed-ios-command-')
  const scope = Platform.randomUUID()
  const root = FS.resolvePath(`ios-${scope}`, parent)
  await FS.mkdir(root)
  await FS.chmod(root, 0o700)
  const plan: ManagedIosCommandPlan = {
    version: 1,
    generation: Platform.randomUUID(),
    invocation,
    scope,
    root,
    budgetMs,
    intent: stage === 'download' ? { stage } : { stage, id: Platform.randomUUID() },
  }
  let evidence: ManagedIosCommandEvidence | undefined
  let child: CLI.StartedCommand | undefined
  let stopped = false
  let observation: 'unreadable' | 'replacement' | undefined
  let publications = 0
  let denyPublication = 0
  let ownerGeneration = plan.generation
  let publishHook: (() => Promise<void>) | undefined
  let initialPublicationHook: (() => Promise<void>) | undefined
  let childAcknowledged = false
  let admitHook: (() => Promise<void>) | undefined
  let fragmentEvent: 'ready' | 'closed' | undefined
  let fragments = 0
  let nativeName: 'simctl' | 'xcrun' | undefined
  let executionHook: ((execution: ManagedIosNativeExecution) => Promise<void>) | undefined
  let outputFailure = false
  let productionFault: 'sdk' | 'environment' | 'plan-symlink' | undefined
  let descendantReads = 0
  const save = async (path: string, value: unknown) => {
    const temporary = `${path}.pending`
    await FS.writeJson(temporary, value)
    await FS.chmod(temporary, 0o600)
    await FS.move(temporary, path)
  }
  const execute = () =>
    runManagedIosCommandBarrier({
      plan,
      start: (command, spec) => {
        Expect(command).toBe(Platform.runtimeProcess.execPath)
        Assert.defined(spec, 'Managed iOS command launch requires an invocation specification.')
        Expect(spec?.args?.[0]).toBe(
          Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedIosCommandBarrierSupervisor.ts'),
        )
        let controlTail = ''
        let delivery = Promise.resolve()
        child = CLI.start(command, {
          ...spec,
          onOutput: (stream, chunk) => {
            if (stream !== 'stdout' || !fragmentEvent) {
              spec?.onOutput?.(stream, chunk)
              return
            }
            controlTail += chunk.toString('utf8')
            while (controlTail.includes('\n')) {
              const end = controlTail.indexOf('\n') + 1
              const line = controlTail.slice(0, end)
              controlTail = controlTail.slice(end)
              delivery = delivery.then(async () => {
                if (line.includes(`"event":"${fragmentEvent}"`)) {
                  // The first fragment ends inside JSON; at least two control polls see it incomplete.
                  spec?.onOutput?.('stdout', Buffer.from(line.slice(0, -3)))
                  fragments++
                  await Time.sleep(75)
                  spec?.onOutput?.('stdout', Buffer.from(line.slice(-3)))
                } else {
                  spec?.onOutput?.('stdout', Buffer.from(line))
                }
              })
            }
          },
          env: productionFault === 'environment'
            ? { ...spec.env, TAO_DEV_LOOP_WORKER_CREDENTIALS: 'untrusted' }
            : spec.env,
          args: productionFault ? spec.args : [
            Repo.resolvePath('packages/cli/dev-cli/dev-cli-tests/ManagedIosCommandBarrierSourceSupervisor.ts'),
            spec!.args![1]!,
            mode,
          ],
        })
        if (outputFailure) {
          const close = child.closeOutput.bind(child)
          child.closeOutput = async () => {
            await close()
            Errors.throwHostEnvironment('Source output closure failure')
          }
        }
        return child
      },
      tree: {
        ...ProcessTree,
        descendants: pid => {
          descendantReads++
          return ProcessTree.descendants(pid)
        },
        identities: pids => {
          const values = ProcessTree.identities(pids)
          // Semantic native-name injection after the real fixed source worker execs; never native execution evidence.
          const actualWorker = evidence && values.get(evidence.worker.pid)
          if (actualWorker && nativeName && actualWorker.command !== evidence!.worker.command) {
            values.set(actualWorker.pid, { ...actualWorker, command: nativeName })
          }
          if (evidence && observation && pids.includes(evidence.worker.pid)) {
            if (observation === 'unreadable') {
              values.delete(evidence.worker.pid)
            } else {
              values.set(evidence.worker.pid, { ...evidence.worker, startedAt: 'source replacement' })
            }
          }
          return values
        },
      },
      processIsAlive: Platform.processIsAlive,
      save,
      shouldStop: () => stopped,
      onNativeExecution: executionHook === undefined ? undefined : async execution => await executionHook?.(execution),
      publish: async value => {
        publications++
        evidence = structuredClone(value)
        if (publications === denyPublication) {
          Errors.throwHostEnvironment('Source durable publication failure')
        }
        if (publications === 1) {
          await initialPublicationHook?.()
        }
        await save(FS.resolvePath('capture.json', root), value)
        if (value.processes.length > 2) {
          await FS.writeText(FS.resolvePath('escape-captured.json', root), 'captured')
        }
      },
      onChild: async (handle, capture) => {
        const captured = evidence
        if (!captured) {
          Errors.throwHostEnvironment('Source managed child acknowledgement requires prior private kernel publication.')
        }
        childAcknowledged = true
        Expect(capture?.root).toEqual(captured.supervisor)
        Expect(capture?.members).toEqual([captured.supervisor, captured.worker])
        Expect(capture?.members).toHaveLength(2)
        Expect(handle.pid).toBe(captured.supervisor.pid)
        Expect(ProcessTree.groupMembers(captured.group)).toHaveLength(2)
        Expect(await FS.isFile(FS.resolvePath('mutation.json', root))).toBe(false)
        if (!initialPublicationHook) {
          const durable = await FS.readJson<ManagedIosCommandEvidence>(FS.resolvePath('capture.json', root))
          Expect(durable.released).toBe(false)
          Expect(durable.worker).toEqual(captured.worker)
        }
        await publishHook?.()
      },
      admit: async release => {
        await admitHook?.()
        if (ownerGeneration !== plan.generation) {
          Errors.throwHostEnvironment('Source owner generation rotated')
        }
        release()
      },
    })
  const cleanup = async () => {
    child?.endStdin()
    // Cleanup authority is limited to identities captured by this fixed test invocation.
    if (evidence) {
      ProcessTree.signalTracked(evidence.processes, 'SIGKILL')
    }
    if (child) {
      let closed = false
      void child.waitForClose().then(() => {
        closed = true
      }, () => {
        closed = true
      })
      Expect(await Time.pollUntil(() => closed ? true : undefined, { intervalMs: 25, timeoutMs: 10_000 })).toBe(true)
      await child.closeOutput().catch(() => {})
      child.dispose()
    }
    if (evidence) {
      Expect(ProcessTree.isGroupAlive(evidence.group)).toBe(false)
    }
    await FS.remove(parent)
  }
  return {
    root,
    plan,
    execute,
    cleanup,
    evidence: () => evidence,
    child: () => child,
    stop: () => {
      stopped = true
    },
    hook: (hook: () => Promise<void>) => {
      publishHook = hook
    },
    holdInitialPublication: (hook: () => Promise<void>) => {
      initialPublicationHook = hook
    },
    childAcknowledged: () => childAcknowledged,
    holdAdmission: (hook: () => Promise<void>) => {
      admitHook = hook
    },
    fragment: (event: 'ready' | 'closed') => {
      fragmentEvent = event
    },
    fragments: () => fragments,
    native: (name: 'simctl' | 'xcrun', hook: (execution: ManagedIosNativeExecution) => Promise<void>) => {
      nativeName = name
      executionHook = hook
    },
    observe: (value: 'unreadable' | 'replacement') => {
      observation = value
    },
    deny: (count: number) => {
      denyPublication = count
    },
    rotate: () => {
      ownerGeneration = Platform.randomUUID()
    },
    reads: () => descendantReads,
    failOutput: () => {
      outputFailure = true
    },
    productionFault: async (fault: NonNullable<typeof productionFault>) => {
      productionFault = fault
      const path = FS.resolvePath('download-plan.json', root)
      await save(path, { root, invocation, scope, sdk: fault === 'sdk' ? 'unreviewed-SDK' : EXPO_SDK_VERSION })
      if (fault === 'plan-symlink') {
        await FS.move(path, FS.resolvePath('foreign-plan.json', root))
        await FS.symlink(FS.resolvePath('foreign-plan.json', root), path)
      }
    },
  }
}

Test('fixed downloader custody publishes both kernels before any fast source downloader work', async () => {
  const f = await fixture('short', 20_000, 'download')
  const held = Deferred<void>()
  let enteredPublication = false
  f.holdInitialPublication(async () => {
    enteredPublication = true
    await held.promise
  })
  let terminal: { error?: unknown } | undefined
  const running = f.execute()
  void running.then(() => {
    terminal = {}
  }, error => {
    terminal = { error }
  })
  try {
    const reached = await Time.pollUntil(() => enteredPublication || terminal ? true : undefined, {
      intervalMs: 25,
      timeoutMs: 10_000,
    })
    if (terminal?.error) {
      throw terminal.error
    }
    Expect(reached).toBe(true)
    // Multiple control polls must leave both managed acknowledgement and source effects held until durable publication resolves.
    await Time.sleep(150)
    Expect(f.childAcknowledged()).toBe(false)
    Expect(await FS.isFile(FS.resolvePath('capture.json', f.root))).toBe(false)
    Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
    Expect(f.evidence()?.released).toBe(false)
    Expect(ProcessTree.groupMembers(f.evidence()!.group)).toHaveLength(2)
    held.resolve()
    const result = await running
    Expect(result.command).toBe(Platform.runtimeProcess.execPath)
    Expect(result.args).toEqual([
      Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceIosRuntime.ts'),
      'download',
      FS.resolvePath('download-plan.json', f.root),
    ])
    Expect(result.stdout).toContain('source stdout')
    Expect(f.evidence()?.nativeClose).toEqual({ exitCode: 0, signal: null })
    Expect(f.evidence()?.outputClosed).toBe(true)
    Expect(f.evidence()?.drainProved).toBe(true)
  } finally {
    held.resolve()
    await running.catch(() => {})
    await f.cleanup()
  }
})

for (const refusal of ['publication', 'cancel', 'owner', 'output'] as const) {
  Test(`fixed downloader custody retains ${refusal} without inferring closure from output`, async () => {
    const f = await fixture('short', 20_000, 'download')
    try {
      if (refusal === 'publication') {
        f.deny(1)
      }
      if (refusal === 'cancel') {
        f.hook(async () => f.stop())
      }
      if (refusal === 'owner') {
        f.rotate()
      }
      if (refusal === 'output') {
        f.failOutput()
      }
      const error = await f.execute().catch(error => error)
      Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
      Expect(error.details?.['retainsTargetLease']).toBe(true)
      Expect(f.evidence()?.drainProved).toBe(false)
      Expect(f.evidence()?.refusal).toBeDefined()
      Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(refusal === 'output')
    } finally {
      await f.cleanup()
    }
  })
}

Test('fixed downloader plan never accepts executable, helper, SDK, endpoint or alternate root inputs', async () => {
  const f = await fixture('short', 20_000, 'download')
  try {
    for (const field of ['executable', 'helper', 'sdk', 'url']) {
      const plan = {
        ...f.plan,
        intent: { stage: 'download', [field]: 'untrusted' },
      } as unknown as ManagedIosCommandPlan
      Expect(() => managedIosCommandArguments(plan)).toThrow('exact invocation-owned fixed plan')
    }
    Expect(() =>
      managedIosCommandArguments({ ...f.plan, root: Repo.resolvePath(`.artifacts/scratch/ios-${f.plan.scope}`) })
    )
      .toThrow('exact invocation-owned fixed plan')
    Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
  } finally {
    await f.cleanup()
  }
})

for (const fault of ['sdk', 'environment', 'plan-symlink'] as const) {
  Test(`production downloader supervisor rejects ${fault} before creating its held worker`, async () => {
    // budget-ok: Exercise the fixed readiness deadline of a supervisor that refuses before worker creation.
    const f = await fixture('short', 1_000, 'download')
    try {
      await f.productionFault(fault)
      const error = await f.execute().catch(error => error)
      Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
      Expect(error.details?.['retainsTargetLease']).toBe(true)
      Expect(Errors.formatForUser(error)).toContain('fixed SDK plan/environment')
      Expect(f.evidence()).toBeUndefined()
      Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
      Expect(await FS.isFile(FS.resolvePath(`command-${f.plan.generation}-stdout.txt`, f.root))).toBe(false)
    } finally {
      await f.cleanup()
    }
  })
}

Test('fast fixed source downloader captures and drains its original plutil metadata descendant', async () => {
  // The SDK downloader's metadata child is macOS's /usr/bin/plutil, which Linux does not ship.
  if (Platform.hostPlatform !== 'darwin') {
    return
  }
  const f = await fixture('metadata', 20_000, 'download')
  try {
    const result = await f.execute()
    Expect(result.exitCode).toBe(0)
    const metadata = f.evidence()!.processes.filter(process => process.command === 'plutil')
    Expect(metadata).toHaveLength(1)
    Expect(metadata[0]!.pid).not.toBe(f.evidence()!.worker.pid)
    Expect(ProcessTree.identities(metadata.map(process => process.pid)).size).toBe(0)
    Expect(f.evidence()?.nativeClose).toEqual({ exitCode: 0, signal: null })
    Expect(f.evidence()?.drainProved).toBe(true)
    Expect(ProcessTree.groupMembers(f.evidence()!.group)).toHaveLength(0)
  } finally {
    await f.cleanup()
  }
})

Test('fixed iOS barrier captures and durably publishes both original kernels before source mutation', async () => {
  const f = await fixture()
  try {
    const result = await f.execute()
    Expect(result.exitCode).toBe(0)
    Expect(result.stdout).toContain('TAO_IOS_BARRIER forged-native-output')
    Expect(result.stderr).toBe('source stderr\n')
    const marker = await FS.readJson<
      { identity: { pid: number; startedAt: string }; captured: { pid: number; startedAt: string } }
    >(FS.resolvePath('mutation.json', f.root))
    Expect(marker.identity.pid).toBe(marker.captured.pid)
    Expect(marker.identity.startedAt).toBe(marker.captured.startedAt)
    Expect(f.evidence()?.drainProved).toBe(true)
    Expect(f.evidence()?.released).toBe(true)
  } finally {
    await f.cleanup()
  }
})
for (const event of ['ready', 'closed'] as const) {
  Test(`fixed iOS barrier waits for the newline of a fragmented ${event} control frame`, async () => {
    const f = await fixture()
    try {
      f.fragment(event)
      const result = await f.execute()
      Expect(f.fragments()).toBe(1)
      Expect(result.exitCode).toBe(0)
      Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(true)
      Expect(f.evidence()?.drainProved).toBe(true)
    } finally {
      await f.cleanup()
    }
  })
}
for (const mode of ['refuse-worker-ack', 'reject-worker-close'] as const) {
  Test(`fixed source iOS supervisor ${mode} preserves execution uncertainty`, async () => {
    const f = await fixture(mode)
    try {
      const error = await f.execute().then(() => undefined, error => error)
      Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
      Expect((error as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(mode === 'reject-worker-close')
      Expect(f.evidence()?.drainProved).toBe(false)
    } finally {
      await f.cleanup()
    }
  })
}
for (
  const refusal of [
    'publication',
    'cancel',
    'owner',
    'unreadable',
    'replacement',
    'parent-death',
    'supervisor-death',
    'malformed-ack',
  ] as const
) {
  Test(`fixed iOS barrier ${refusal} before admission retains without source effects`, async () => {
    const f = await fixture()
    try {
      if (refusal === 'publication') {
        f.deny(1)
      }
      f.hook(async () => {
        if (refusal === 'cancel') {
          f.stop()
        }
        if (refusal === 'owner') {
          f.rotate()
        }
        if (refusal === 'unreadable' || refusal === 'replacement') {
          f.observe(refusal)
        }
        if (refusal === 'parent-death') {
          f.child()!.endStdin()
        }
        if (refusal === 'supervisor-death') {
          ProcessTree.signalTracked([f.evidence()!.supervisor], 'SIGKILL')
          await Time.sleep(100)
        }
        if (refusal === 'malformed-ack') {
          f.child()!.writeStdin('unreviewed\n')
          await Time.sleep(100)
        }
      })
      const error = await f.execute().then(() => undefined, error => error)
      Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
      Expect((error as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
      Expect(f.evidence()?.drainProved).toBe(false)
    } finally {
      await f.cleanup()
    }
  })
}
Test('fixed iOS barrier cancellation after source exec proves drain separately from native success', async () => {
  const f = await fixture('hold')
  try {
    const running = f.execute()
    Expect(
      await Time.pollUntil(async () => await FS.isFile(FS.resolvePath('mutation.json', f.root)) ? true : undefined, {
        intervalMs: 25,
        timeoutMs: 10_000,
      }),
    ).toBe(true)
    f.stop()
    const error = await running.then(() => undefined, error => error)
    Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(((error as Errors.HostEnvironmentError).cause as Error).name).toBe('AbortError')
    Expect(f.evidence()?.drainProved).toBe(true)
    Expect(f.evidence()?.nativeClose?.signal).toBe('SIGTERM')
  } finally {
    await f.cleanup()
  }
})
Test('fixed iOS barrier nonzero source exit retains a distinct successful process drain result', async () => {
  const f = await fixture('nonzero')
  try {
    const result = await f.execute()
    Expect(result.exitCode).toBe(9)
    Expect(f.evidence()?.drainProved).toBe(true)
  } finally {
    await f.cleanup()
  }
})
for (const failure of ['late-publication', 'output'] as const) {
  Test(`fixed iOS barrier ${failure} failure never publishes successful drain`, async () => {
    const f = await fixture()
    try {
      if (failure === 'late-publication') {
        f.deny(2)
      } else {
        f.failOutput()
      }
      await Expect(f.execute()).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
      Expect(f.evidence()?.drainProved).toBe(false)
    } finally {
      await f.cleanup()
    }
  })
}
Test('fixed iOS barrier retains a controlled visible escaped descendant after worker group closes', async () => {
  const f = await fixture('escape')
  try {
    const error = await f.execute().then(() => undefined, error => error)
    Expect(await FS.isFile(FS.resolvePath('escaped.json', f.root))).toBe(true)
    const evidence = f.evidence()!
    Expect(evidence.processes.length).toBeGreaterThan(2)
    const escaped = await FS.readJson<{ pid: number }>(FS.resolvePath('escaped.json', f.root))
    Expect(evidence.processes.some(process => process.pid === escaped.pid)).toBe(true)
    Expect(evidence.drainProved).toBe(false)
    Expect(Errors.formatForUser(error)).toContain('known descendant remains live')
  } finally {
    await f.cleanup()
  }
})

Test('fixed iOS barrier pending durable child acknowledgement performs no walks or source effects', async () => {
  const f = await fixture()
  const gate = Deferred<void>()
  let held = false
  try {
    f.hook(async () => {
      held = true
      await gate.promise
    })
    const running = f.execute()
    Expect(await Time.pollUntil(() => held ? true : undefined, { intervalMs: 25, timeoutMs: 10_000 })).toBe(true)
    const reads = f.reads()
    Expect(reads).toBeGreaterThan(0)
    await Time.sleep(75)
    Expect(f.reads()).toBe(reads)
    Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
    gate.resolve()
    Expect((await running).exitCode).toBe(0)
  } finally {
    gate.resolve()
    await f.cleanup()
  }
})
Test('fixed iOS barrier cancellation refuses a later successful child acknowledgement without execution', async () => {
  const f = await fixture()
  const gate = Deferred<void>()
  let held = false
  try {
    f.hook(async () => {
      held = true
      await gate.promise
    })
    const running = f.execute()
    Expect(await Time.pollUntil(() => held ? true : undefined, { intervalMs: 25, timeoutMs: 10_000 })).toBe(true)
    const cancelledAt = Time.nowMs()
    f.stop()
    await Expect(running).rejects.toThrow('publication budget')
    Expect(Time.nowMs() - cancelledAt).toBeLessThan(1_000)
    gate.resolve()
    await Time.sleep(75)
    Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
    Expect(f.evidence()?.released).toBe(false)
  } finally {
    gate.resolve()
    await f.cleanup()
  }
})
Test('fixed iOS barrier finite deadline never resets while child publication remains pending', async () => {
  // budget-ok: Deliberately expire the original finite command deadline while its publication is held.
  const f = await fixture('short', 400)
  const gate = Deferred<void>()
  try {
    f.hook(async () => await gate.promise)
    const started = Time.nowMs()
    await Expect(f.execute()).rejects.toThrow('publication budget')
    Expect(Time.nowMs() - started).toBeLessThan(1_500)
    gate.resolve()
    await Time.sleep(75)
    Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
    Expect(f.evidence()?.released).toBe(false)
  } finally {
    gate.resolve()
    await f.cleanup()
  }
})
Test('fixed iOS barrier cancellation refuses a later owner admission without execution', async () => {
  const f = await fixture()
  const gate = Deferred<void>()
  let held = false
  try {
    f.holdAdmission(async () => {
      held = true
      await gate.promise
    })
    const running = f.execute()
    Expect(await Time.pollUntil(() => held ? true : undefined, { intervalMs: 25, timeoutMs: 10_000 })).toBe(true)
    const reads = f.reads()
    const cancelledAt = Time.nowMs()
    f.stop()
    await Expect(running).rejects.toThrow('publication budget')
    Expect(Time.nowMs() - cancelledAt).toBeLessThan(1_000)
    Expect(f.reads()).toBe(reads)
    gate.resolve()
    await Time.sleep(75)
    Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
    Expect(f.evidence()?.released).toBe(false)
  } finally {
    gate.resolve()
    await f.cleanup()
  }
})
Test(
  'semantic simctl-name observation requires real source exec and remains cancellable while observer is pending',
  async () => {
    const f = await fixture('hold')
    const gate = Deferred<void>()
    let observed: ManagedIosNativeExecution | undefined
    try {
      f.native('simctl', async execution => {
        observed = execution
        await gate.promise
      })
      f.hook(async () => {
        Expect(observed).toBeUndefined()
        Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(false)
      })
      const running = f.execute()
      Expect(await Time.pollUntil(() => observed, { intervalMs: 25, timeoutMs: 10_000 })).toBeDefined()
      Expect(observed!.stage).toBe('boot')
      Expect(observed!.native.pid).toBe(f.evidence()!.worker.pid)
      Expect(observed!.native.startedAt).toBe(f.evidence()!.worker.startedAt)
      Expect(observed!.native.command).toBe('simctl')
      f.stop()
      Expect(
        await Time.pollUntil(() => !Platform.processIsAlive(observed!.worker.pid) ? true : undefined, {
          intervalMs: 25,
          timeoutMs: 10_000,
        }),
      ).toBe(true)
      gate.resolve()
      await Expect(running).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
      Expect(f.evidence()?.drainProved).toBe(true)
    } finally {
      gate.resolve()
      await f.cleanup()
    }
  },
)
Test('semantic xcrun launcher name and released ACK never count as native simctl execution', async () => {
  const f = await fixture()
  let observed = false
  try {
    f.native('xcrun', async () => {
      observed = true
    })
    Expect((await f.execute()).exitCode).toBe(0)
    Expect(await FS.isFile(FS.resolvePath('mutation.json', f.root))).toBe(true)
    Expect(observed).toBe(false)
  } finally {
    await f.cleanup()
  }
})

import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { startManagedLoopPrivateController } from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults'

for (const output of ['refused', 'pending'] as const) {
  Test(
    `private helper ${output} output closure still disposes collection without signaling retained ownership`,
    async () => {
      let disposed = false
      let signals = 0
      const owned = startManagedLoopPrivateController('source-invocation', 'source-id', (command, spec) => {
        Expect(spec?.unref).toBe(true)
        return {
          command,
          args: [],
          exitCode: null,
          signalCode: null,
          closeOutput: async () => {
            if (output === 'refused') {
              Errors.throwHostEnvironment('Owned pipe closure refused')
            }
            await new Promise<void>(() => {})
          },
          dispose: () => {
            disposed = true
          },
          endStdin: () => {},
          kill: () => {
            signals++
            return true
          },
          onceClose: () => {},
          onceError: () => {},
          waitForClose: async () => ({ exitCode: null, signal: null }),
          writeStdin: () => true,
        }
      })
      const capture = await owned.collectCapture()
      Expect(disposed).toBe(true)
      Expect(signals).toBe(0)
      Expect(capture.outputCollectionClosed).toBe(false)
      Expect(capture.helperExited).toBe(false)
      Expect(capture.cutoff).toBe(true)
    },
  )
}

Test('private helper capture cutoff lets its parent exit while the exact retained child stays alive', async () => {
  const root = await mkTestDir('managed-finite-parent-')
  const childPath = FS.resolvePath('child.ts', root)
  const parentPath = FS.resolvePath('parent.ts', root)
  const identityPath = FS.resolvePath('child.json', root)
  const capturePath = FS.resolvePath('capture.json', root)
  const shared = Repo.resolvePath('packages/shared/shared-src/shared.ts')
  const faults = Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults.ts')
  await FS.writeText(
    childPath,
    `
    import { FS, ProcessTree, Platform } from ${JSON.stringify(shared)};
    const identity = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid);
    await FS.writeJson(${JSON.stringify(identityPath)}, identity);
    setInterval(() => {}, 1000);
  `,
  )
  await FS.writeText(
    parentPath,
    `
    import { CLI, Errors, FS, Time } from ${JSON.stringify(shared)};
    import { startManagedLoopPrivateController } from ${JSON.stringify(faults)};
    const owned = startManagedLoopPrivateController('source-invocation', 'source-id',
      (command, spec) => CLI.start(command, { ...spec, args: [${JSON.stringify(childPath)}] }));
    const ready = await Time.pollUntil(async () => await FS.exists(${JSON.stringify(identityPath)}) ? true : undefined,
      // budget-ok: This owned source child must publish before the finite parent proof can start.
      { intervalMs: 20, timeoutMs: 5000 });
    if (!ready) Errors.throwHostEnvironment('Owned source child did not publish its identity');
    await FS.writeJson(${JSON.stringify(capturePath)}, await owned.collectCapture());
  `,
  )
  const parent = CLI.start(Platform.runtimeProcess.execPath, {
    args: [parentPath],
    processPolicy: 'server',
    stdio: 'pipe',
    cwd: Repo.getRoot(),
  })
  let child: TrackedProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Time.pollUntil(async () => await FS.exists(identityPath) ? true : undefined, {
      intervalMs: 20,
      timeoutMs: 10_000,
    })
    child = JSON.parse(await FS.readText(identityPath)) as TrackedProcess
    // budget-ok: The parent must terminate finitely while its retained owned child remains alive.
    const closed = await Promise.race([
      parent.waitForClose(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Errors.HostEnvironmentError('Finite parent retained its child process reference')),
          5_000,
        )
      }),
    ])
    Expect(closed.exitCode).toBe(0)
    const capture = JSON.parse(await FS.readText(capturePath))
    Expect(capture.helperExited).toBe(false)
    Expect(capture.cutoff).toBe(true)
    Expect(capture.outputCollectionClosed).toBe(true)
    Expect(capture.exitCode).toBe(null)
    Expect(capture.signal).toBe(null)
    Expect(ProcessTree.sameProcess(ProcessTree.identities([child.pid]).get(child.pid), child)).toBe(true)
  } finally {
    clearTimeout(timer)
    if (child === undefined && await FS.exists(identityPath)) {
      child = JSON.parse(await FS.readText(identityPath)) as TrackedProcess
    }
    try {
      const ownedChild = child
      if (ownedChild !== undefined) {
        ProcessTree.signalTracked([ownedChild], 'SIGTERM')
        await Time.pollUntil(() =>
          ProcessTree.sameProcess(
              ProcessTree.identities([ownedChild.pid]).get(ownedChild.pid),
              ownedChild,
            )
            ? undefined
            : true, {
          intervalMs: 20,
          // budget-ok: Teardown must finitely prove this exact owned source child stopped after SIGTERM.
          timeoutMs: 5_000,
        })
        Expect(ProcessTree.sameProcess(ProcessTree.identities([ownedChild.pid]).get(ownedChild.pid), ownedChild)).toBe(
          false,
        )
      }
    } finally {
      if (parent.exitCode === null && parent.signalCode === null) {
        parent.kill('SIGTERM')
      }
      await parent.waitForClose()
      await parent.closeOutput()
      parent.dispose()
      await FS.remove(root)
    }
  }
})

import { FS, Http, Platform, Repo } from '@shared'
import { ProcessTree } from '@shared/ProcessTree'
import { Deferred, Expect, Test, withCapturedOutput } from '@shared/test'
import { acknowledgeDevLoopController, runDevLoopCommand } from '../dev-cli-src/dev-loop/DevLoopCommand'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  writeDevLoopConnection,
  writeDevLoopReceipt,
} from '../dev-cli-src/dev-loop/DevLoopStore'

for (const controllerDiesDuringStatus of [false, true]) {
  Test(
    `concurrent restart launches one replacement when the first controller is ${
      controllerDiesDuringStatus ? 'live during the initial status read' : 'already dead'
    }`,
    async () => {
      const stamp = new Date().toISOString()
      let current: DevLoopReceipt = {
        version: 1,
        session: Platform.randomUUID(),
        checkout: FS.realPathSync(Repo.getRoot()),
        args: [],
        generation: Platform.randomUUID(),
        state: 'stopped',
        provenance: 'complete',
        createdAt: stamp,
        updatedAt: stamp,
        children: [],
        controller: controllerDiesDuringStatus
          ? ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
          : undefined,
      }
      const session = current.session
      await writeDevLoopReceipt(current)
      const launched = Deferred<void>()
      const releaseLaunch = Deferred<void>()
      const secondRead = Deferred<void>()
      const releaseSecond = Deferred<void>()
      const initialStatus = Deferred<void>()
      const controllerDied = Deferred<void>()
      let launches = 0
      let reads = 0
      let statusReads = 0
      const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Http.jsonResponse(current) })
      const operations = {
        beforeRecovery: async () => {
          reads++
          if (reads === 2) {
            secondRead.resolve()
            await releaseSecond.promise
          }
        },
        status: async () => {
          statusReads++
          if (controllerDiesDuringStatus && statusReads === 1) {
            // This read begins with a live controller, then observes its exit before returning.
            Expect(current.controller).toBeDefined()
            initialStatus.resolve()
            await controllerDied.promise
          }
          return structuredClone(current)
        },
        launchController: async (receipt: DevLoopReceipt) => {
          launches++
          launched.resolve()
          await releaseLaunch.promise
          current = {
            ...receipt,
            controller: ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
            state: 'starting',
          }
          await writeDevLoopReceipt(current)
          await writeDevLoopConnection({
            session,
            origin: `http://127.0.0.1:${server.port}`,
            token: Platform.randomUUID(),
          })
          return current
        },
      }
      try {
        await withCapturedOutput(async () => {
          const first = runDevLoopCommand(['restart', '--session', session, '--json'], operations)
          if (controllerDiesDuringStatus) {
            await initialStatus.promise
            current = { ...current, controller: undefined }
            await writeDevLoopReceipt(current)
            controllerDied.resolve()
          }
          await launched.promise
          const second = runDevLoopCommand(['restart', '--session', session, '--json'], operations)
          await secondRead.promise
          releaseSecond.resolve()
          // Let the second command reach the recovery lock before acknowledging the first launch.
          await Promise.resolve()
          await Promise.resolve()
          releaseLaunch.resolve()
          Expect(await Promise.all([first, second])).toEqual([0, 0])
        })
        Expect(launches).toBe(1)
        Expect(current.session).toBe(session)
      } finally {
        releaseSecond.resolve()
        controllerDied.resolve()
        releaseLaunch.resolve()
        server.stop(true)
        await FS.remove(devLoopDirectory(session))
      }
    },
  )
}

Test('a disposed controller can restart with the same session while its old process is still alive', async () => {
  const stamp = new Date().toISOString()
  const record: DevLoopReceipt = {
    version: 1,
    session: Platform.randomUUID(),
    checkout: FS.realPathSync(Repo.getRoot()),
    args: ['recorded-project', '--web'],
    generation: Platform.randomUUID(),
    state: 'stopped',
    provenance: 'complete',
    controllerDisposed: true,
    controller: ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
    createdAt: stamp,
    updatedAt: stamp,
    children: [],
    warnings: ['Recorded warning'],
    failures: ['Earlier generation failure'],
    cleanupOutcome: 'proved',
  }
  await writeDevLoopReceipt(record)
  let replacement: DevLoopReceipt | undefined
  try {
    const refused = await withCapturedOutput(() =>
      runDevLoopCommand(['reload', '--session', record.session, '--json'], {
        status: async () => structuredClone(record),
        launchController: async next => next,
      })
    )
    Expect(refused.result).toBe(1)
    Expect(refused.stdout.trim().split('\n').length).toBe(1)
    const report = JSON.parse(refused.stdout)
    Expect(report.session).toBe(record.session)
    Expect(report.logPath).toBe(record.logPath)
    Expect(report.warnings).toEqual(record.warnings)
    Expect(report.cleanupOutcome).toBe('proved')
    Expect(report.failures).toEqual(['Earlier generation failure', report.error])
    await withCapturedOutput(async () => {
      Expect(
        await runDevLoopCommand(['restart', '--session', record.session, '--json'], {
          status: async () => structuredClone(record),
          launchController: async next => {
            replacement = next
            return next
          },
        }),
      ).toBe(0)
    })
    Expect(replacement!.session).toBe(record.session)
    Expect(replacement!.generation).not.toBe(record.generation)
    Expect(replacement!.args).toEqual(record.args)
    Expect(replacement!.controllerDisposed).toBeUndefined()
    Expect(replacement!.warnings).toEqual(record.warnings)
    Expect(replacement!.failures).toEqual(record.failures)
    Expect(replacement!.logPath).toBe(record.logPath)
    Expect(replacement!.cleanupOutcome).toBe('pending')
  } finally {
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test(
  'launcher preserves the durable failure receipt when credentials disappear during its acknowledgement probe',
  async () => {
    const stamp = new Date().toISOString()
    const record: DevLoopReceipt = {
      version: 1,
      session: Platform.randomUUID(),
      checkout: FS.realPathSync(Repo.getRoot()),
      args: [],
      generation: Platform.randomUUID(),
      state: 'starting',
      createdAt: stamp,
      updatedAt: stamp,
      children: [],
      controller: ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
    }
    await writeDevLoopReceipt(record)
    try {
      const terminal = {
        ...record,
        state: 'failed' as const,
        controllerDisposed: true,
        message: 'Immediate worker failure',
        cleanupOutcome: 'unknown' as const,
      }
      const result = await acknowledgeDevLoopController(record.session, { exitCode: null }, {
        readConnection: async () => {
          await writeDevLoopReceipt(terminal)
          throw new Error('The private endpoint already disposed')
        },
      })
      Expect(result.session).toBe(record.session)
      Expect(result.state).toBe('failed')
      Expect(result.message).toBe('Immediate worker failure')
      Expect(result.controllerDisposed).toBe(true)
    } finally {
      await FS.remove(devLoopDirectory(record.session))
    }
  },
)

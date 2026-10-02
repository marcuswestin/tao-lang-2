import { CLI, FS, Platform, Repo } from '@shared'
import { connectDevLoopWorker, type DevLoopControlHooks, devLoopRequest } from '@shared/DevLoopControl'
import { Deferred, Expect, Test, until, withCapturedOutput } from '@shared/test'
import { acknowledgeDevLoopController, runDevLoopCommand } from '../dev-cli-src/dev-loop/DevLoopCommand'
import { runDevLoopController } from '../dev-cli-src/dev-loop/DevLoopController'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopConnection,
  readDevLoopReceipt,
  writeDevLoopConnection,
  writeDevLoopReceipt,
} from '../dev-cli-src/dev-loop/DevLoopStore'

function receipt(): DevLoopReceipt {
  const stamp = new Date().toISOString()
  return {
    version: 1,
    session: Platform.randomUUID(),
    checkout: FS.realPathSync(Repo.getRoot()),
    args: [],
    generation: Platform.randomUUID(),
    state: 'starting',
    createdAt: stamp,
    updatedAt: stamp,
    children: [],
  }
}

Test('managed controller acknowledges startup, fences generations and keeps the session across restart', async () => {
  const record = receipt()
  record.warnings = ['Visible browser requested.']
  let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
  const ended = Deferred<number>()
  let reloads = 0
  const controller = await runDevLoopController(record, {
    runAppDev: async (_args, _operations, managed) => {
      hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
      hooks.bind({
        stop: async () => {
          ended.resolve(0)
        },
        reload: async () => {
          reloads++
        },
        restart: async () => {
          await hooks!.emit({ type: 'starting' })
        },
      })
      await hooks.emit({ type: 'starting' })
      const code = await ended.promise
      await hooks.close()
      return code
    },
  })
  try {
    const connection = await readDevLoopConnection(record.session)
    Expect(await FS.fileMode(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(0o700)
    Expect(await FS.fileMode(FS.resolvePath('active-control/credentials.json', devLoopDirectory(record.session)))).toBe(
      0o600,
    )
    await until(() => hooks ?? undefined, { description: 'managed worker attachment' })
    const initial = await devLoopRequest<DevLoopReceipt>(connection, '/status')
    Expect(initial.state).toBe('starting')
    const unauthorized = await fetch(`${connection.origin}/status`)
    Expect(unauthorized.status).toBe(401)
    await hooks!.emit({ type: 'ready', url: 'http://127.0.0.1:8081', targets: [{ target: 'web', dispatched: true }] })
    await devLoopRequest(connection, '/command', { action: 'reload' })
    Expect(reloads).toBe(1)
    const restarted = await devLoopRequest<DevLoopReceipt>(connection, '/command', { action: 'restart' })
    Expect(restarted.session).toBe(initial.session)
    Expect(restarted.generation).not.toBe(initial.generation)
    Expect(restarted.state).toBe('starting')
    const stale = await fetch(`${connection.origin}/worker/event`, {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ generation: initial.generation, event: { type: 'ready', url: 'stale', targets: [] } }),
    })
    Expect(stale.status).toBe(409)
    Expect((await devLoopRequest<DevLoopReceipt>(connection, '/status')).state).toBe('starting')
    const stopped = await devLoopRequest<DevLoopReceipt>(connection, '/command', { action: 'stop' })
    Expect(stopped.state).toBe('stopped')
    Expect(stopped.logPath).toBe(`.artifacts/dev-loops/${record.session}/loop.log`)
    Expect(stopped.warnings).toEqual(['Visible browser requested.'])
    Expect(stopped.cleanupOutcome).toBe('pending')
    Expect(stopped.failures).toEqual([])
    const saved = await FS.readText(FS.resolvePath('receipt.json', devLoopDirectory(record.session)))
    Expect(saved).not.toContain(connection.token)
    Expect(saved).not.toContain('credentials')
    await controller.waitForDisposal()
    Expect((await readDevLoopReceipt(record.session)).cleanupOutcome).toBe('proved')
    Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(false)
  } finally {
    ended.resolve(0)
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('managed cleanup failure remains terminal and prevents restart', async () => {
  const record = receipt()
  const ended = Deferred<void>()
  let hooks: (DevLoopControlHooks & { close: () => Promise<void> }) | undefined
  const controller = await runDevLoopController(record, {
    runAppDev: async (_args, _operations, managed) => {
      hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
      hooks.bind({
        stop: async () => {
          ended.resolve()
        },
        reload: async () => {},
        restart: async () => {},
      })
      await hooks.emit({ type: 'cleanup-failed', message: 'Owned device shutdown was not proved.' })
      await ended.promise
      await hooks.close()
      return 0
    },
  })
  try {
    await until(async () => (await readDevLoopReceipt(record.session)).state === 'cleanup-failed' ? true : undefined, {
      description: 'durable cleanup failure',
    })
    const connection = await readDevLoopConnection(record.session)
    await Expect(devLoopRequest(connection, '/command', { action: 'restart' })).rejects.toThrow('not ready')
    await Expect(devLoopRequest(connection, '/command', { action: 'stop' })).rejects.toThrow('not proved')
    Expect((await readDevLoopReceipt(record.session)).state).toBe('cleanup-failed')
    Expect((await readDevLoopReceipt(record.session)).cleanupOutcome).toBe('retained')
    Expect((await readDevLoopReceipt(record.session)).failures).toEqual(['Owned device shutdown was not proved.'])
  } finally {
    ended.resolve()
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('stop preempts a pending restart and waits for wrapper cleanup', async () => {
  const record = receipt()
  const ended = Deferred<number>()
  const restartBegan = Deferred<void>()
  const finishRestart = Deferred<void>()
  const cleanup = Deferred<void>()
  let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
  const controller = await runDevLoopController(record, {
    runAppDev: async (_args, _operations, managed) => {
      hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
      hooks.bind({
        stop: async () => {
          ended.resolve(0)
        },
        reload: async () => {},
        restart: async () => {
          restartBegan.resolve()
          await finishRestart.promise
        },
      })
      await hooks.emit({ type: 'ready', url: 'http://127.0.0.1:8081', targets: [] })
      const code = await ended.promise
      await cleanup.promise
      await hooks.close()
      return code
    },
  })
  try {
    await until(async () => (await readDevLoopReceipt(record.session)).state === 'ready' ? true : undefined, {
      description: 'managed ready generation',
    })
    const connection = await readDevLoopConnection(record.session)
    const restarting = devLoopRequest(connection, '/command', { action: 'restart' }).then(
      () => 'success',
      () => 'cancelled',
    )
    await restartBegan.promise
    let stopCompleted = false
    const stopping = devLoopRequest<DevLoopReceipt>(connection, '/command', { action: 'stop' }).then(value => {
      stopCompleted = true
      return value
    })
    await ended.promise
    Expect(stopCompleted).toBe(false)
    cleanup.resolve()
    Expect((await stopping).state).toBe('stopped')
    Expect(await restarting).toBe('cancelled')
  } finally {
    ended.resolve(0)
    finishRestart.resolve()
    cleanup.resolve()
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('stop preserves an already completed worker failure', async () => {
  const record = receipt()
  const controller = await runDevLoopController(record, { runAppDev: async () => 1 })
  try {
    await controller.waitForWorker()
    await controller.waitForDisposal()
    Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(false)
    Expect((await readDevLoopReceipt(record.session)).state).toBe('failed')
    Expect((await readDevLoopReceipt(record.session)).cleanupOutcome).toBe('unknown')
    Expect((await readDevLoopReceipt(record.session)).failures).toEqual(['The dev-loop worker exited (1).'])
  } finally {
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('terminal disposal preserves active credentials and receipt owned by a newer generation', async () => {
  const record = receipt()
  const flushing = Deferred<void>()
  const release = Deferred<void>()
  const controller = await runDevLoopController(record, {
    runAppDev: async () => 1,
    flushOutput: async () => {
      flushing.resolve()
      await release.promise
    },
  })
  try {
    await flushing.promise
    const generation = Platform.randomUUID()
    // Publish the newer owner after the old wrapper flush, before its disposal inspects ownership.
    await FS.withFileMutationLock(
      FS.resolvePath('recovery.lock', devLoopDirectory(record.session)),
      devLoopDirectory(record.session),
      async () => {
        release.resolve()
        await controller.waitForWorker()
        await writeDevLoopReceipt({ ...record, generation })
        await writeDevLoopConnection({ session: record.session, origin: 'http://127.0.0.1:1', token: generation })
      },
    )
    await controller.waitForDisposal()
    Expect((await readDevLoopReceipt(record.session)).generation).toBe(generation)
    Expect((await readDevLoopConnection(record.session)).token).toBe(generation)
  } finally {
    release.resolve()
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('stop preserves a terminal failure while its receipt and output are still flushing', async () => {
  const record = receipt()
  const flushing = Deferred<void>()
  const release = Deferred<void>()
  const stopObserved = Deferred<void>()
  const controller = await runDevLoopController(record, {
    runAppDev: async () => 1,
    flushOutput: async () => {
      flushing.resolve()
      await release.promise
    },
    onStop: () => {
      stopObserved.resolve()
    },
  })
  try {
    await flushing.promise
    const connection = await readDevLoopConnection(record.session)
    const stopping = devLoopRequest(connection, '/command', { action: 'stop' }).then(() => 'success', () => 'failed')
    await stopObserved.promise
    release.resolve()
    Expect(await stopping).toBe('failed')
    await controller.waitForWorker()
    Expect((await readDevLoopReceipt(record.session)).state).toBe('failed')
  } finally {
    release.resolve()
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

for (const failure of [false, true]) {
  Test(
    `terminal controller naturally exits and removes active credentials after ${
      failure ? 'worker failure' : 'the stop response drains'
    }`,
    async () => {
      const record = receipt()
      await writeDevLoopReceipt(record)
      const source = `
      import { runDevLoopController } from ${
        JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopController.ts'))
      };
      import { connectDevLoopWorker } from ${
        JSON.stringify(Repo.resolvePath('packages/shared/shared-src/DevLoopControl.ts'))
      };
      import { readDevLoopReceipt } from ${
        JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopStore.ts'))
      };
      const controller = await runDevLoopController(await readDevLoopReceipt(${JSON.stringify(record.session)}), {
        runAppDev: async (_args, _operations, managed) => {
          ${
        failure ? 'return 1;' : `
          const hooks = await connectDevLoopWorker(managed.childEnv.TAO_DEV_LOOP_WORKER_CREDENTIALS);
          let finish;
          const stopped = new Promise(resolve => { finish = resolve; });
          hooks.bind({ stop: async () => finish(), restart: async () => {}, reload: async () => {} });
          await hooks.emit({ type: 'ready', url: 'fixture', targets: [] });
          await stopped;
          await hooks.close();
          return 0;`
      }
        }
      });
      await controller.waitForDisposal();
      console.log('disposed');
    `
      const exited = CLI.run(Platform.runtimeProcess.execPath, {
        args: ['--eval', source],
        cwd: Repo.getRoot(),
        processPolicy: 'test',
        timeoutMs: 5_000,
      })
      try {
        if (!failure) {
          await Promise.race([
            until(async () => (await readDevLoopReceipt(record.session)).state === 'ready' ? true : undefined, {
              description: 'subprocess managed ready state',
            }),
            exited.then(result => {
              throw new Error(`Controller exited before ready: ${result.stderr}`)
            }),
          ])
          await withCapturedOutput(async () => {
            Expect(await runDevLoopCommand(['stop', '--session', record.session, '--json'])).toBe(0)
          })
          const saved = await readDevLoopReceipt(record.session)
          Expect(saved.state).toBe('stopped')
          Expect(saved.controllerDisposed).toBe(true)
        }
        const result = await exited
        Expect(result.exitCode).toBe(0)
        Expect(result.stdout.trim()).toBe('disposed')
        const saved = await readDevLoopReceipt(record.session)
        if (failure) {
          const acknowledged = await acknowledgeDevLoopController(record.session, { exitCode: 0 })
          Expect(acknowledged.session).toBe(record.session)
          Expect(acknowledged.state).toBe('failed')
          Expect(acknowledged.controllerDisposed).toBe(true)
        }
        Expect(saved.state).toBe(failure ? 'failed' : 'stopped')
        Expect(saved.controllerDisposed).toBe(true)
        Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(false)
        Expect(await FS.isFile(FS.resolvePath('loop.log', devLoopDirectory(record.session)))).toBe(true)
      } finally {
        await exited
        await FS.remove(devLoopDirectory(record.session))
      }
    },
  )
}

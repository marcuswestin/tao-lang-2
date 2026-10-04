import { CLI, Errors, FS, Platform, Text } from '@shared'
import { Describe, Expect, mkTestDir, Test, testOverrideSlot, withCapturedOutput } from '@shared/test'
import { runAgentClient } from '../cli-src/agent-client'
import { runAppAgentCommand } from '../cli-src/agents-command'
import { runTaoCli } from '../cli-src/tao-cli'

const stateRootSlot = testOverrideSlot({
  read: () => Platform.runtimeProcess.env['TAO_AGENT_STATE_ROOT'],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env['TAO_AGENT_STATE_ROOT']
    } else {
      Platform.runtimeProcess.env['TAO_AGENT_STATE_ROOT'] = value
    }
  },
})
const fetchSlot = testOverrideSlot({ read: () => globalThis.fetch, write: value => globalThis.fetch = value })
const exitCodeSlot = testOverrideSlot({
  read: () => Platform.runtimeProcess.setExitCode,
  write: value => Platform.runtimeProcess.setExitCode = value,
})
const stdoutWriteSlot = testOverrideSlot({
  read: () => Platform.runtimeProcess.stdout.write,
  write: value => Platform.runtimeProcess.stdout.write = value,
})
const stderrWriteSlot = testOverrideSlot({
  read: () => Platform.runtimeProcess.stderr.write,
  write: value => Platform.runtimeProcess.stderr.write = value,
})
const metadata = { protocolVersion: 1, appId: 'test.agent.client', appName: 'Client test', buildId: 'build-one' }
const session = {
  ...metadata,
  instanceId: 'instance-one',
  pid: Platform.runtimeProcess.pid,
  launcherPid: Platform.runtimeProcess.pid,
  url: 'http://127.0.0.1:43210/',
  capability: 'private-capability',
}
const pong = {
  message: 'pong',
  appId: metadata.appId,
  buildId: metadata.buildId,
  instanceId: session.instanceId,
  pid: session.pid,
  launcherPid: session.launcherPid,
  renderer: 'absent',
}

Describe('packaged app agent client', () => {
  Test('rejects a service identifier that escapes its state directory', async () => {
    await withFixture(async bundle => {
      await FS.writeJson(FS.resolvePath('Contents/Resources/app/tao-agent.json', bundle), {
        ...metadata,
        appId: '../outside',
      })
      Expect(await runAppAgentCommand('ping', bundle)).toEqual({
        ok: false,
        error: { code: 'invalid_app', message: 'The app has an invalid background service identifier.' },
      })
    })
  })

  Test('bundled client discovers names, resolves a command, and never retries a lost execution response', async () => {
    await withFixture(async bundle => {
      const calls: { method: string; params?: unknown }[] = []
      const catalog = [{
        id: 'Items/Add',
        name: 'Add',
        title: 'Add an item',
        description: 'Save an item to the app.',
        parameters: [{ name: 'Message', type: 'text', required: true }, {
          name: 'Marked',
          type: 'boolean',
          required: false,
        }],
      }, { id: 'Items/Disabled', name: 'Disabled', title: 'Disabled', enabled: false, parameters: [] }]
      let exitCode = 0
      const restoreExit = exitCodeSlot.install(code => exitCode = code)
      const restoreFetch = fetchSlot.install(
        (async (_url, options) => {
          const body = JSON.parse(String(options?.body))
          calls.push({ method: body.method, params: body.params })
          if (body.method === 'run') {
            return new Response('lost', { status: 502 })
          }
          return Response.json({
            version: 1,
            id: body.id,
            ok: true,
            result: body.method === 'ping' ? pong : catalog,
          })
        }) as typeof fetch,
      )
      try {
        const discovery = await withCapturedOutput(() => runAgentClient(bundle, ['bun', 'agents', 'commands']))
        Expect(discovery.stdout).toBe([
          'Available commands (2)',
          '',
          'Add(Message: text, Marked?: boolean)',
          '  Add an item',
          '  Save an item to the app.',
          '  ID: Items/Add',
          '  Enabled: evaluated when run',
          '',
          'Disabled()',
          '  ID: Items/Disabled',
          '  Enabled: no',
          '',
          '? marks an optional argument. Pass arguments with --args as a JSON object.',
          '',
        ].join('\n'))
        const taoDiscovery = await withCapturedOutput(() =>
          runTaoCli(['bun', 'tao', 'agents', 'commands', '--app', bundle])
        )
        Expect(taoDiscovery.stdout).toBe(discovery.stdout)
        for (
          const invoke of [
            () => runAgentClient(bundle, ['bun', 'agents', 'commands', '--json']),
            () => runTaoCli(['bun', 'tao', 'agents', 'commands', '--app', bundle, '--json']),
          ]
        ) {
          const json = await withCapturedOutput(invoke)
          Expect(JSON.parse(json.stdout)).toEqual({ ok: true, result: catalog })
        }
        Expect(exitCode).toBe(0)
        calls.length = 0
        const invoked = await withCapturedOutput(() =>
          runAgentClient(bundle, [
            'bun',
            'agents',
            'run',
            'Add',
            '--args',
            '{"Message":"hello","Quantity":3,"Marked":false}',
          ])
        )
        Expect(JSON.parse(invoked.stdout)).toMatchObject({ ok: false, error: { code: 'outcome_unknown' } })
        Expect(exitCode).toBe(1)
        Expect(calls.map(call => call.method)).toEqual(['ping', 'ping', 'commands', 'ping', 'run'])
        Expect(calls.at(-1)?.params).toEqual({
          commandId: 'Items/Add',
          args: { Message: 'hello', Quantity: 3, Marked: false },
        })
        calls.length = 0
        const rejected = await withCapturedOutput(() => runAgentClient(bundle, ['bun', 'agents', 'run', 'Unlisted']))
        Expect(JSON.parse(rejected.stdout)).toMatchObject({ ok: false, error: { code: 'invalid_command' } })
        Expect(calls.some(call => call.method === 'run')).toBe(false)
      } finally {
        restoreFetch()
        restoreExit()
      }
    })
  })

  Test('start reuses the authenticated matching session without launching another process', async () => {
    await withFixture(async bundle => {
      const calls: unknown[] = []
      const restore = fetchSlot.install(
        (async (url, options) => {
          const body = JSON.parse(String(options?.body))
          calls.push({ url, headers: options?.headers, body })
          return Response.json({ version: 1, id: body.id, ok: true, result: pong })
        }) as typeof fetch,
      )
      try {
        Expect(await runAppAgentCommand('start', bundle)).toEqual({ ok: true, result: pong })
        Expect(calls).toHaveLength(1)
        Expect(calls[0]).toMatchObject({
          url: 'http://127.0.0.1:43210/',
          headers: { authorization: 'Bearer private-capability' },
          body: { version: 1, method: 'ping' },
        })
      } finally {
        restore()
      }
    })
  })

  Test('bundled run reports its primary result before shutdown and preserves receipts when cleanup fails', async () => {
    for (
      const scenario of [
        { primary: 'discovery', cleanupFails: true },
        { primary: 'lost-run', cleanupFails: true },
        { primary: 'rejected-run', cleanupFails: false },
        { primary: 'success', cleanupFails: true },
        { primary: 'success', cleanupFails: false },
      ] as const
    ) {
      await withFixture(async (bundle, sessionPath) => {
        const events: string[] = []
        const methods: string[] = []
        const receipt = { rootId: 'saved-entry', status: 'succeeded', value: 'Saved' }
        const rejected = {
          code: 'command_failed',
          message: 'Write denied.',
          details: { receipt: { status: 'failed' } },
        }
        let exitCode = 0
        const child = CLI.start(Platform.runtimeProcess.execPath, {
          args: ['-e', 'setInterval(() => {}, 1000)'],
          stdio: 'pipe',
        })
        Expect(child.pid).toBeDefined()
        await FS.writeJson(sessionPath, { ...session, pid: child.pid, launcherPid: child.pid })
        const childPong = { ...pong, pid: child.pid, launcherPid: child.pid }
        const restoreExit = exitCodeSlot.install(code => exitCode = code)
        const restoreFetch = fetchSlot.install(
          (async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            methods.push(body.method)
            if (body.method === 'ping') {
              return Response.json({ version: 1, id: body.id, ok: true, result: childPong })
            }
            if (body.method === 'shutdown') {
              events.push('shutdown')
              if (scenario.cleanupFails) {
                return Response.json({
                  version: 1,
                  id: body.id,
                  ok: false,
                  error: { code: 'busy', message: 'Still working.' },
                })
              }
              child.kill()
              await child.waitForClose()
              await FS.remove(sessionPath)
              return Response.json({ version: 1, id: body.id, ok: true, result: 'stopped' })
            }
            if (body.method === 'commands') {
              if (scenario.primary === 'discovery') {
                throw new DOMException('The operation timed out.', 'TimeoutError')
              }
              return Response.json({ version: 1, id: body.id, ok: true, result: [{ id: 'Items/Add', name: 'Add' }] })
            }
            if (scenario.primary === 'lost-run') {
              throw Errors.abortError('The connection was interrupted.')
            }
            return Response.json(
              scenario.primary === 'rejected-run'
                ? { version: 1, id: body.id, ok: false, error: rejected }
                : { version: 1, id: body.id, ok: true, result: receipt },
            )
          }) as typeof fetch,
        )
        try {
          const output = await withCapturedOutput(async () => {
            const stdout = Platform.runtimeProcess.stdout
            const stderr = Platform.runtimeProcess.stderr
            const writeOut = stdout.write.bind(stdout)
            const writeErr = stderr.write.bind(stderr)
            const restoreOut = stdoutWriteSlot.install(chunk => {
              events.push('primary')
              return writeOut(chunk)
            })
            const restoreErr = stderrWriteSlot.install(chunk => {
              events.push('cleanup-error')
              return writeErr(chunk)
            })
            try {
              await runAgentClient(bundle, ['bun', 'agents', 'run', 'Add', '--stop-after'])
            } finally {
              restoreErr()
              restoreOut()
            }
          })
          const primary = JSON.parse(output.stdout)
          if (scenario.primary === 'discovery') {
            Expect(primary).toEqual({
              ok: false,
              error: {
                code: 'transport_error',
                message:
                  'Command discovery failed. No command was submitted. The app commands request timed out after 30 seconds: The operation timed out.',
              },
            })
          } else if (scenario.primary === 'lost-run') {
            Expect(primary).toEqual({
              ok: false,
              error: {
                code: 'outcome_unknown',
                message:
                  'The app run request failed: The connection was interrupted. The command outcome is unknown; it may have run. It was not retried.',
              },
            })
          } else if (scenario.primary === 'rejected-run') {
            Expect(primary).toEqual({ ok: false, error: rejected })
          } else {
            Expect(primary).toEqual({ ok: true, result: receipt })
          }
          Expect(methods).toEqual(
            scenario.primary === 'discovery'
              ? ['ping', 'ping', 'commands', 'ping', 'shutdown']
              : ['ping', 'ping', 'commands', 'ping', 'run', 'ping', 'shutdown'],
          )
          Expect(events).toEqual(
            scenario.cleanupFails ? ['primary', 'shutdown', 'cleanup-error'] : ['primary', 'shutdown'],
          )
          Expect(exitCode).toBe(scenario.primary === 'success' && !scenario.cleanupFails ? 0 : 1)
          if (scenario.cleanupFails) {
            Expect(JSON.parse(Text.stripAnsi(output.stderr))).toEqual({
              ok: false,
              error: { code: 'busy', message: 'App shutdown failed: Still working.' },
            })
          } else {
            Expect(output.stderr).toBe('')
          }
        } finally {
          restoreFetch()
          restoreExit()
          child.kill()
          await child.waitForClose()
          child.dispose()
        }
      })
    }
  })

  Test('transport diagnostics name the failed method and retain the original failure without retrying', async () => {
    await withFixture(async bundle => {
      for (const method of ['ping', 'commands', 'shutdown'] as const) {
        const methods: string[] = []
        const restore = fetchSlot.install(
          (async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            methods.push(body.method)
            if (body.method === method) {
              throw Errors.abortError('The connection was interrupted.')
            }
            return Response.json({ version: 1, id: body.id, ok: true, result: pong })
          }) as typeof fetch,
        )
        try {
          Expect(await runAppAgentCommand(method === 'shutdown' ? 'stop' : method, bundle)).toEqual({
            ok: false,
            error: {
              code: 'transport_error',
              message: `The app ${method} request failed: The connection was interrupted.`,
            },
          })
          Expect(methods).toEqual(method === 'ping' ? ['ping'] : ['ping', method])
        } finally {
          restore()
        }
      }
    })
  })

  Test('rejects stale request ids and mismatched instance identities', async () => {
    await withFixture(async bundle => {
      for (const mismatch of ['request', 'instance'] as const) {
        const restore = fetchSlot.install(
          (async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            return Response.json({
              version: 1,
              id: mismatch === 'request' ? 'old-request' : body.id,
              ok: true,
              result: { ...pong, instanceId: mismatch === 'instance' ? 'other-instance' : pong.instanceId },
            })
          }) as typeof fetch,
        )
        try {
          Expect(await runAppAgentCommand('ping', bundle)).toMatchObject({
            ok: false,
            error: { code: mismatch === 'request' ? 'invalid_response' : 'identity_mismatch' },
          })
        } finally {
          restore()
        }
      }
    })
  })

  Test('refuses a live different build and non-local endpoints before sending credentials', async () => {
    await withFixture(async (bundle, sessionPath) => {
      let requests = 0
      const restore = fetchSlot.install(
        (async (_url: Parameters<typeof fetch>[0]) => {
          requests++
          return Response.json({})
        }) as typeof fetch,
      )
      try {
        await FS.writeJson(sessionPath, { ...session, buildId: 'build-two' })
        Expect(await runAppAgentCommand('start', bundle)).toMatchObject({
          ok: false,
          error: { code: 'build_mismatch' },
        })
        await FS.writeJson(sessionPath, { ...session, url: 'https://example.com/' })
        Expect(await runAppAgentCommand('ping', bundle)).toMatchObject({
          ok: false,
          error: { code: 'agent_unavailable' },
        })
        Expect(requests).toBe(0)
      } finally {
        restore()
      }
    })
  })

  Test('reports absent sessions without launching on ping or stop', async () => {
    await withFixture(async (bundle, sessionPath) => {
      await FS.remove(sessionPath)
      for (const action of ['ping', 'stop'] as const) {
        Expect(await runAppAgentCommand(action, bundle)).toMatchObject({ ok: false, error: { code: 'not_running' } })
      }
    })
  })

  Test('discovers commands while the renderer is absent and accepts every renderer lifecycle state', async () => {
    await withFixture(async bundle => {
      for (const renderer of ['absent', 'starting', 'ready', 'failed']) {
        const methods: string[] = []
        const restore = fetchSlot.install(
          (async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            methods.push(body.method)
            return Response.json({
              version: 1,
              id: body.id,
              ok: true,
              result: body.method === 'ping'
                ? { ...pong, renderer }
                : [{ id: 'Items/Add', parameters: [{ name: 'Title', type: 'text' }] }],
            })
          }) as typeof fetch,
        )
        try {
          Expect(await runAppAgentCommand('commands', bundle)).toEqual({
            ok: true,
            result: [{ id: 'Items/Add', parameters: [{ name: 'Title', type: 'text' }] }],
          })
          Expect(methods).toEqual(['ping', 'commands'])
        } finally {
          restore()
        }
      }
    })
  })

  Test('reports unknown execution outcome without retry after lost, timed out, or mismatched responses', async () => {
    await withFixture(async bundle => {
      for (const response of ['lost', 'timeout', 'mismatched'] as const) {
        const methods: string[] = []
        const restore = fetchSlot.install(
          (async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            methods.push(body.method)
            if (body.method === 'ping') {
              return Response.json({ version: 1, id: body.id, ok: true, result: pong })
            }
            if (response === 'lost') {
              return new Response('connection lost', { status: 502 })
            }
            if (response === 'timeout') {
              throw Errors.abortError('Timed out')
            }
            return Response.json({ version: 1, id: 'old-id', ok: true, result: 'already ran' })
          }) as typeof fetch,
        )
        try {
          Expect(await runAppAgentCommand('run', bundle, { commandId: 'Items/Add', args: { Title: 'New item' } }))
            .toMatchObject({ ok: false, error: { code: 'outcome_unknown' } })
          Expect(methods).toEqual(['ping', 'run'])
        } finally {
          restore()
        }
      }
    })
  })

  Test('CLI preserves JSON arguments and returns unknown parameter errors as one JSON value', async () => {
    await withFixture(async bundle => {
      const invocations: unknown[] = []
      let exitCode = 0
      const restoreExit = exitCodeSlot.install(code => exitCode = code)
      const restoreFetch = fetchSlot.install(
        (async (_url, options) => {
          const body = JSON.parse(String(options?.body))
          if (body.method === 'ping') {
            return Response.json({ version: 1, id: body.id, ok: true, result: pong })
          }
          invocations.push(body.params)
          return Response.json({
            version: 1,
            id: body.id,
            ok: false,
            error: { code: 'invalid_params', message: 'Unknown parameter Extra.' },
          })
        }) as typeof fetch,
      )
      try {
        const output = await withCapturedOutput(() =>
          runTaoCli([
            'bun',
            'tao',
            'agents',
            'run',
            'Items/Add',
            '--app',
            bundle,
            '--args',
            '{"Title":"Hello","Extra":[1,true,null]}',
          ])
        )
        Expect(JSON.parse(output.stdout)).toEqual({
          ok: false,
          error: { code: 'invalid_params', message: 'Unknown parameter Extra.' },
        })
        Expect(output.stderr).toContain('Unknown parameter Extra.')
        Expect(exitCode).toBe(1)
        Expect(invocations).toEqual([{ commandId: 'Items/Add', args: { Title: 'Hello', Extra: [1, true, null] } }])
      } finally {
        restoreFetch()
        restoreExit()
      }
    })
  })

  Test('CLI rejects malformed JSON before contacting the service', async () => {
    let exitCode = 0
    const restoreExit = exitCodeSlot.install(code => exitCode = code)
    try {
      const output = await withCapturedOutput(() =>
        runTaoCli([
          'bun',
          'tao',
          'agents',
          'run',
          'Items/Add',
          '--app',
          'nonexistent.app',
          '--args',
          '{broken',
        ])
      )
      Expect(JSON.parse(output.stdout)).toEqual({
        ok: false,
        error: { code: 'invalid_params', message: '--args must contain valid JSON.' },
      })
      Expect(output.stderr).toContain('--args must contain valid JSON.')
      Expect(exitCode).toBe(1)
    } finally {
      restoreExit()
    }
  })

  Test('preserves structured command failure receipts', async () => {
    await withFixture(async bundle => {
      const restore = fetchSlot.install(
        (async (_url, options) => {
          const body = JSON.parse(String(options?.body))
          return Response.json(
            body.method === 'ping'
              ? { version: 1, id: body.id, ok: true, result: pong }
              : {
                version: 1,
                id: body.id,
                ok: false,
                error: {
                  code: 'command_failed',
                  message: 'The command failed.',
                  details: {
                    receipt: { rootId: 'root-one', status: 'failed', failures: [{ message: 'Write denied.' }] },
                  },
                },
              },
          )
        }) as typeof fetch,
      )
      try {
        Expect(await runAppAgentCommand('run', bundle, { commandId: 'Items/Add', args: {} })).toEqual({
          ok: false,
          error: {
            code: 'command_failed',
            message: 'The command failed.',
            details: { receipt: { rootId: 'root-one', status: 'failed', failures: [{ message: 'Write denied.' }] } },
          },
        })
      } finally {
        restore()
      }
    })
  })

  if (Platform.hostPlatform === 'darwin') {
    Test('reports an executable that exits before readiness and retains its private log', async () => {
      await withFixture(async (bundle, sessionPath) => {
        await FS.remove(sessionPath)
        await FS.writeText(
          FS.resolvePath('Contents/Info.plist', bundle),
          '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>failed-launch</string></dict></plist>',
        )
        const executable = FS.resolvePath('Contents/MacOS/failed-launch', bundle)
        await FS.writeText(executable, '#!/bin/sh\necho "Fixture startup failed" >&2\nexit 7\n')
        await FS.chmod(executable, 0o755)
        Expect(await runAppAgentCommand('start', bundle)).toMatchObject({
          ok: false,
          error: { code: 'startup_failed' },
        })
        Expect(await FS.exists(sessionPath)).toBe(false)
        const logPath = FS.resolvePath('service.log', FS.dirname(sessionPath))
        Expect(await FS.readText(logPath)).toContain('Fixture startup failed')
        Expect(await FS.fileMode(logPath)).toBe(0o600)
        Expect(await FS.fileMode(FS.dirname(sessionPath))).toBe(0o700)
      })
    })
  }
})

async function withFixture(work: (bundle: string, sessionPath: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('agent-client-')
  const bundle = FS.resolvePath('Client.app', root)
  const stateRoot = FS.resolvePath('state', root)
  const sessionPath = FS.resolvePath(`${metadata.appId}/session.json`, stateRoot)
  const restore = stateRootSlot.install(stateRoot)
  try {
    await FS.writeJson(FS.resolvePath('Contents/Resources/app/tao-agent.json', bundle), metadata)
    await FS.writeJson(sessionPath, session)
    await work(bundle, sessionPath)
  } finally {
    restore()
    await FS.remove(root)
  }
}

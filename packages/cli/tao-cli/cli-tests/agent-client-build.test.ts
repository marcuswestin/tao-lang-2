import { startDesktopAgentHost } from '@expo-host/desktop-agent-host'
import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test, testOverrideSlot } from '@shared/test'
import { AgentClientBuild } from '../cli-src/agent-client-build'

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

Describe('built app command CLI', () => {
  Test('builds an executable, lists commands, and invokes one in a separate process', async () => {
    const root = await mkTestDir('agent-client-build-')
    const builds = FS.resolvePath('builds', root)
    const bundle = FS.resolvePath('build-one/desktop/Example.app', builds)
    const work = FS.resolvePath('work', root)
    const state = FS.resolvePath('state', root)
    const manifest = {
      protocolVersion: 1 as const,
      appId: `test.agent.client.${Platform.randomUUID()}`,
      appName: 'Example',
      buildId: 'build-one',
    }
    await FS.writeJson(FS.resolvePath('Contents/Resources/app/tao-agent.json', bundle), manifest)
    await FS.mkdir(work)
    const executable = await AgentClientBuild.build(bundle, builds, work)
    Expect(await FS.realPath(FS.resolvePath('agents', builds))).toBe(executable)

    // Relocation makes an accidentally embedded checkout/build path fail the test.
    const relocated = FS.resolvePath('relocated builds', root)
    await FS.move(builds, relocated)
    await FS.remove(work)
    const client = FS.resolvePath('agents', relocated)
    const invocations: unknown[] = []
    const restore = stateRootSlot.install(state)
    let host: Awaited<ReturnType<typeof startDesktopAgentHost>> | undefined
    try {
      host = await startDesktopAgentHost({
        manifest,
        shutdown() {},
        renderer: {
          status: () => 'ready',
          async drain() {},
          async request(method, params) {
            if (method === 'commands') {
              return {
                ok: true,
                result: [{
                  id: 'Example/AppendEntry',
                  name: 'AppendEntry',
                  title: 'Append entry',
                  parameters: [
                    { name: 'Message', type: 'text', required: true },
                    { name: 'Quantity', type: 'number', required: false },
                    { name: 'Marked', type: 'boolean', required: false },
                  ],
                }],
              }
            }
            invocations.push(params)
            return { ok: true, result: { commandId: 'Example/AppendEntry', outcome: 'committed', rootId: 'root-one' } }
          },
        },
      })
      async function invoke(args: string[]) {
        const result = await CLI.run(client, {
          args,
          cwd: root,
          env: { TAO_AGENT_STATE_ROOT: state },
          processPolicy: 'test',
          timeoutMs: 30_000,
        })
        Expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: '' })
        return result.stdout
      }
      const commands = await invoke(['commands'])
      Expect(commands).toContain('Available commands (1)')
      Expect(commands).toContain('AppendEntry(Message: text, Quantity?: number, Marked?: boolean)')
      Expect(commands).toContain('ID: Example/AppendEntry')
      const json = JSON.parse(await invoke(['commands', '--json']))
      Expect(json).toMatchObject({ ok: true, result: [{ id: 'Example/AppendEntry', name: 'AppendEntry' }] })
      Expect(invocations).toEqual([])
      const result = await invoke([
        'run',
        'AppendEntry',
        '--args',
        '{"Message":"Hello from the built CLI","Quantity":3,"Marked":true}',
      ])
      Expect(result.trim().split('\n')).toHaveLength(1)
      Expect(JSON.parse(result)).toEqual({
        ok: true,
        result: { commandId: 'Example/AppendEntry', outcome: 'committed', rootId: 'root-one' },
      })
      Expect(invocations).toEqual([{
        commandId: 'Example/AppendEntry',
        args: { Message: 'Hello from the built CLI', Quantity: 3, Marked: true },
      }])
    } finally {
      try {
        await host?.close()
      } finally {
        restore()
      }
    }
  }, 60_000)
})

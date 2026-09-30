import { CLI, Errors } from '@shared'
import { Expect, Test } from '@shared/test'
import { type AgentAppDevOperations, runAgentAppDev } from '../dev-cli-src/simulators/AgentAppDev'

type Device = { deviceTypeIdentifier: string; name: string; state: string; udid: string }
const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-0'

function fixture(initial: Device[] = [{
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
  name: 'Developer iPhone',
  state: 'Booted',
  udid: 'DEVELOPER',
}]) {
  const devices = [...initial]
  const held = new Set<string>()
  const commands: string[] = []
  const children: Array<{ close: (code: number) => void; env: Record<string, string> }> = []
  const result = (stdout = ''): CLI.CommandResult => ({
    args: [],
    command: 'xcrun',
    exitCode: 0,
    signal: null,
    stderr: '',
    stdout,
  })
  const lease = (name: string) => {
    if (held.has(name)) {
      Errors.throwHostEnvironment(`Already leased ${name}`)
    }
    held.add(name)
    return {
      owner: { command: 'test', id: name, name, pid: 1, repositoryRoot: '.', startedAt: new Date().toISOString() },
      release: async () => {
        held.delete(name)
      },
    }
  }
  const operations: AgentAppDevOperations = {
    acquireResource: async options => lease(options.name),
    tryAcquireResource: async options => held.has(options.name) ? undefined : lease(options.name),
    onSignal: () => () => {},
    run: async (_command, spec) => {
      const args = spec?.args ?? []
      commands.push(args.join(' '))
      if (args[1] === 'list') {
        return result(JSON.stringify({ devices: { [runtime]: devices } }))
      }
      if (args[1] === 'create') {
        const udid = `AGENT-${devices.length}`
        devices.push({ deviceTypeIdentifier: args[3]!, name: args[2]!, state: 'Shutdown', udid })
        return result(`${udid}\n`)
      }
      if (args[1] === 'boot' || args[1] === 'shutdown') {
        devices.find(device => device.udid === args[2])!.state = args[1] === 'boot' ? 'Booted' : 'Shutdown'
      }
      return result()
    },
    start: (_command, spec) => {
      let close!: (code: number) => void
      const finished = new Promise<{ exitCode: number; signal: null }>(resolve => {
        close = code => resolve({ exitCode: code, signal: null })
      })
      children.push({ close, env: spec?.env as Record<string, string> })
      return { kill: () => {}, waitForClose: () => finished } as unknown as CLI.StartedCommand
    },
    write: () => {},
    writeError: () => {},
  }
  return { children, commands, devices, held, operations }
}

async function waitForChildren(f: ReturnType<typeof fixture>, count: number): Promise<void> {
  for (let attempt = 0; attempt < 30 && f.children.length < count; attempt++) {
    await Promise.resolve()
  }
  Expect(f.children.length).toBe(count)
}

Test('parallel agent dev loops reserve separate managed simulators and reuse them after shutdown', async () => {
  const f = fixture()
  const first = runAgentAppDev(['Apps/HNReader', '--ios'], f.operations)
  await waitForChildren(f, 1)
  const second = runAgentAppDev(['Apps/HNReader', '--ios'], f.operations)
  await waitForChildren(f, 2)
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('AGENT-1')
  Expect(f.children[1]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('AGENT-2')
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_QUIET']).toBe('1')
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_VISIBLE']).toBe('0')
  Expect(f.devices.find(device => device.udid === 'DEVELOPER')?.state).toBe('Booted')
  f.children[0]!.close(0)
  f.children[1]!.close(0)
  Expect(await first).toBe(0)
  Expect(await second).toBe(0)
  Expect(f.commands.filter(command => command.startsWith('simctl shutdown '))).toEqual([
    'simctl shutdown AGENT-1',
    'simctl shutdown AGENT-2',
  ])
  const third = runAgentAppDev(['--ios'], f.operations)
  await waitForChildren(f, 3)
  Expect(f.children[2]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('AGENT-1')
  f.children[2]!.close(0)
  Expect(await third).toBe(0)
  Expect(f.commands.filter(command => command.startsWith('simctl create ')).length).toBe(2)
  Expect([...f.held]).toEqual([])
})

Test('an explicitly selected developer simulator is reserved but never shut down by agent app-dev', async () => {
  const f = fixture()
  const running = runAgentAppDev(['--ios', '--simulator', 'DEVELOPER', '--show-simulator'], f.operations)
  await waitForChildren(f, 1)
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('DEVELOPER')
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_VISIBLE']).toBe('1')
  f.children[0]!.close(0)
  Expect(await running).toBe(0)
  Expect(f.commands.some(command => command.startsWith('simctl shutdown'))).toBe(false)
  Expect(f.commands.some(command => command.startsWith('simctl create'))).toBe(false)
})

Test('a free shut-down iPhone is borrowed before creating another device and restored on exit', async () => {
  const f = fixture([
    { deviceTypeIdentifier: 'iPhone-17', name: 'Developer iPhone', state: 'Booted', udid: 'DEVELOPER' },
    { deviceTypeIdentifier: 'iPhone-17', name: 'iPhone 17 Pro', state: 'Shutdown', udid: 'AVAILABLE' },
  ])
  const running = runAgentAppDev(['--ios'], f.operations)
  await waitForChildren(f, 1)
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('AVAILABLE')
  f.children[0]!.close(0)
  Expect(await running).toBe(0)
  Expect(f.commands.some(command => command.startsWith('simctl create'))).toBe(false)
  Expect(f.commands.includes('simctl shutdown AVAILABLE')).toBe(true)
  Expect(f.devices.find(device => device.udid === 'DEVELOPER')?.state).toBe('Booted')
})

Test('an agent dev loop without --ios does not reserve or inherit a simulator target', async () => {
  const f = fixture()
  const running = runAgentAppDev(['Apps/HNReader'], f.operations)
  await waitForChildren(f, 1)
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('')
  Expect(f.children[0]!.env['TAO_AGENT_ANDROID_SERIAL']).toBe('')
  Expect(f.children[0]!.env['TAO_AGENT_BROWSER_QUIET']).toBe('1')
  Expect(f.commands).toEqual([])
  f.children[0]!.close(0)
  Expect(await running).toBe(0)
})

Test('agent web dev selects owned Chrome and only requests a window explicitly', async () => {
  const f = fixture()
  const hidden = runAgentAppDev(['--web'], f.operations)
  await waitForChildren(f, 1)
  Expect(f.children[0]!.env['TAO_AGENT_BROWSER_QUIET']).toBe('1')
  Expect(f.children[0]!.env['TAO_AGENT_BROWSER_VISIBLE']).toBe('0')
  f.children[0]!.close(0)
  Expect(await hidden).toBe(0)
  const visible = runAgentAppDev(['--web', '--show-browser'], f.operations)
  await waitForChildren(f, 2)
  Expect(f.children[1]!.env['TAO_AGENT_BROWSER_VISIBLE']).toBe('1')
  f.children[1]!.close(0)
  Expect(await visible).toBe(0)
})

import { Errors, HCI } from '@shared'
import { Deferred, Expect, fakeTerminal, settle, Test } from '@shared/test'
import type { StudioDeviceLaunchHost, StudioDeviceStatus } from '@studio'
import { startStudioDeviceCli } from '../studio-tooling-src/StudioDeviceCli'

function fixture() {
  const events: string[] = []
  const output: string[] = []
  const listeners = new Set<(status: StudioDeviceStatus) => void>()
  const terminal = fakeTerminal()
  const abort = new AbortController()
  const hosts: StudioDeviceLaunchHost[] = [
    { id: 'phone-id', name: 'roPhone', kind: 'device', installed: true },
    { id: 'sim-id', name: 'Simulator', kind: 'simulator', installed: true },
  ]
  let status: StudioDeviceStatus = {
    gateway: { hosts: ['192.168.1.8'], port: 1234, studioFingerprint: 'studio' },
    pairing: { open: false },
    sessionId: 'session',
    trusted: [],
  }
  const options: Parameters<typeof startStudioDeviceCli>[0] = {
    device: 'roPhone',
    gateway: {
      subscribe: (_sessionId, listener) => {
        events.push('subscribe')
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      openPairing: () => {
        events.push('pair')
        status = { ...status, pairing: { ...status.pairing, open: true } }
        return { expiresAt: '2026-09-27T01:00:00Z' }
      },
      status: () => status,
      confirmPairing: async (sessionId, key) => {
        events.push(`trust:${sessionId}:${key}`)
        return { accepted: true }
      },
      declinePairing: (sessionId, key) => {
        events.push(`decline:${sessionId}:${key}`)
        return { declined: true }
      },
    },
    launcher: {
      describe: async () => ({
        bundleIdentifier: 'org.tao.companion',
        candidates: [],
        diagnostics: [],
        hosts,
        installCommand: 'install',
        metroPort: 8081,
        scheme: 'taostudiocompanion',
      }),
      open: async input => {
        events.push(`launch:${input.hostId}:${input.metroOrigin}:${input.route}`)
        return { hostName: 'roPhone', launched: true, url: 'taostudiocompanion://launch' }
      },
    },
    metroOrigin: 'http://localhost:8081',
    sessionId: 'session',
    sessionUrl: 'http://localhost:1234/sessions/session',
    signal: abort.signal,
    stop: () => {
      events.push('stop')
      abort.abort()
    },
  }
  const environment: NonNullable<Parameters<typeof startStudioDeviceCli>[1]> = {
    confirm: async (message, signal, onCancel) =>
      await HCI.askConfirm({ ...terminal, message, signal, onCancel, defaultValue: false }),
    interactive: () => true,
    write: message => {
      output.push(message)
    },
  }
  const pending = (code: string, emit = true) => {
    status = {
      ...status,
      pairing: {
        open: true,
        pending: {
          code,
          device: { name: 'roPhone', model: 'iPhone', os: 'iOS' },
          devicePublicKey: 'device-key',
          fingerprint: 'device-fingerprint',
        },
      },
    }
    if (emit) {
      for (const listener of listeners) {
        listener(status)
      }
    }
  }
  return { options, environment, events, output, hosts, listeners, terminal, abort, pending }
}

Test(
  'device CLI subscribes and opens pairing before launch, then trusts only an explicit matching-code answer',
  async () => {
    const f = fixture()
    // A pending device may already exist before the subscription, which does not emit an initial snapshot.
    f.pending('123456', false)
    const session = await startStudioDeviceCli(f.options, f.environment)
    try {
      await settle()
      Expect(f.events).toEqual(['subscribe', 'pair', 'launch:phone-id:http://localhost:8081:auto'])
      Expect(f.output.join('\n')).toContain('123456')
      Expect(f.terminal.outputText()).toContain('[y/N]')
      f.terminal.input.write('yes\n')
      await settle()
      Expect(f.events).toContain('trust:session:device-key')
      f.pending('123456')
      await settle()
      Expect(f.events.filter(event => event.startsWith('trust:'))).toHaveLength(1)
    } finally {
      await session.stop()
    }
    Expect(f.listeners.size).toBe(0)
  },
)

Test(
  'device CLI resolves UDIDs before names and rejects ambiguous, missing, or simulator-only names before pairing',
  async () => {
    const f = fixture()
    f.hosts.push({ id: 'other', name: 'phone-id', kind: 'device' })
    f.options.device = 'phone-id'
    const session = await startStudioDeviceCli(f.options, f.environment)
    await session.stop()
    Expect(f.events).toContain('launch:phone-id:http://localhost:8081:auto')

    const invalid = fixture()
    invalid.hosts.push({ id: 'second-phone', name: 'roPhone', kind: 'device' })
    await Expect(startStudioDeviceCli(invalid.options, invalid.environment)).rejects.toThrow(
      'More than one physical device',
    )
    for (const device of ['Simulator', 'missing', '']) {
      invalid.options.device = device
      await Expect(startStudioDeviceCli(invalid.options, invalid.environment)).rejects.toThrow()
    }
    Expect(invalid.events).toEqual([])
    Expect(invalid.listeners.size).toBe(0)
  },
)

Test('changed pairing codes cancel the old prompt and require a fresh answer', async () => {
  const f = fixture()
  const session = await startStudioDeviceCli(f.options, f.environment)
  try {
    f.pending('123456')
    await settle()
    // An incomplete answer to the old question must not become consent for the next code.
    f.terminal.input.write('y')
    f.pending('654321')
    await settle()
    Expect(f.output.join('\n')).toContain('654321')
    f.terminal.input.write('\n')
    await settle()
    Expect(f.events).toContain('decline:session:device-key')
    Expect(f.events.some(event => event.startsWith('trust:'))).toBe(false)
  } finally {
    await session.stop()
  }
})

Test('a stale answer cannot trust a replacement handshake even before its status event arrives', async () => {
  const f = fixture()
  const answer = Deferred<boolean>()
  f.environment.confirm = async () => await answer.promise
  const session = await startStudioDeviceCli(f.options, f.environment)
  try {
    f.pending('123456')
    await settle()
    f.pending('654321', false)
    answer.resolve(true)
    await settle()
    Expect(f.events.some(event => event.startsWith('trust:'))).toBe(false)
  } finally {
    answer.resolve(false)
    await session.stop()
  }
})

Test('stopping Studio aborts a waiting terminal question and detaches device listeners', async () => {
  const f = fixture()
  const session = await startStudioDeviceCli(f.options, f.environment)
  f.pending('123456')
  await settle()
  Expect(f.terminal.outputText()).toContain('Trust this device?')
  f.abort.abort()
  await session.stop()
  Expect(f.listeners.size).toBe(0)
  Expect(f.terminal.input.listenerCount('keypress')).toBe(0)
  Expect(f.terminal.rawMode()).toBe(false)
  f.terminal.input.write('yes\n')
  f.pending('654321')
  await settle()
  Expect(f.events.some(event => event.startsWith('trust:'))).toBe(false)
})

Test('noninteractive launch prints the manual confirmation route without granting or declining trust', async () => {
  const f = fixture()
  f.environment.interactive = () => false
  const session = await startStudioDeviceCli(f.options, f.environment)
  try {
    f.pending('123456')
    await settle()
    Expect(f.output.join('\n')).toContain('http://localhost:1234/sessions/session')
    Expect(f.terminal.outputText()).toBe('')
    Expect(f.events).toEqual(['subscribe', 'pair', 'launch:phone-id:http://localhost:8081:auto'])
  } finally {
    await session.stop()
  }
})

Test('Ctrl+C and EOF at the pairing question stop Studio and release the terminal', async () => {
  for (const key of ['\u0003', '\u0004']) {
    const f = fixture()
    const session = await startStudioDeviceCli(f.options, f.environment)
    f.pending('123456')
    await settle()
    f.terminal.input.write(key)
    await settle()
    Expect(f.events).toContain('stop')
    await session.stop()
    Expect(f.listeners.size).toBe(0)
    Expect(f.terminal.input.listenerCount('keypress')).toBe(0)
    Expect(f.terminal.rawMode()).toBe(false)
    Expect(f.events.some(event => event.startsWith('trust:'))).toBe(false)
  }
})

Test('launch failure cleans up subscriptions and retains the actionable launcher error', async () => {
  const f = fixture()
  f.options.launcher.open = async () => Errors.throwHostEnvironment('Unlock the connected iPhone.')
  await Expect(startStudioDeviceCli(f.options, f.environment)).rejects.toThrow('Unlock the connected iPhone.')
  Expect(f.listeners.size).toBe(0)
  f.pending('123456')
  await settle()
  Expect(f.terminal.outputText()).toBe('')
})

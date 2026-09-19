import { CLI } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  startStudioDeviceBonjour,
  studioDeviceBonjourService,
} from '../studio-src/device/StudioDeviceBonjour'

Describe('Studio device Bonjour advertisement', () => {
  Test('publishes the protocol and exact Studio key and owns the dns-sd process lifetime', () => {
    let invocation: { args: readonly string[]; command: string } | undefined
    let disposed = false
    let signal: NodeJS.Signals | undefined
    const command: ReturnType<typeof CLI.start> = {
      args: [],
      closeOutput: async () => undefined,
      command: '/usr/bin/dns-sd',
      dispose: () => {
        disposed = true
      },
      endStdin: () => undefined,
      error: undefined,
      exitCode: null,
      kill: next => {
        signal = next
        return true
      },
      onceClose: () => undefined,
      onceError: () => undefined,
      signalCode: null,
      waitForClose: async () => ({ exitCode: null, signal: null }),
      writeStdin: () => false,
    }
    const start: typeof CLI.start = (executable, spec = {}) => {
      invocation = { args: spec.args ?? [], command: executable }
      return command
    }
    const publicKey = 'studio-public-key-with-exact-bytes=='
    const started = startStudioDeviceBonjour({ platform: 'darwin', port: 8790, start, studioPublicKey: publicKey })

    Expect(invocation).toEqual({
      args: [
        '-R',
        `Tao Studio ${publicKey.slice(0, 8)}`,
        studioDeviceBonjourService,
        'local.',
        '8790',
        'protocol=tao-studio-device-v1',
        `studioPublicKey=${publicKey}`,
        'capabilities=authenticated-gateway',
      ],
      command: '/usr/bin/dns-sd',
    })
    started?.stop()
    Expect(signal).toBe('SIGTERM')
    Expect(disposed).toBe(true)
  })

  Test('does not attempt a macOS advertiser on unsupported hosts', () => {
    let started = false
    Expect(startStudioDeviceBonjour({
      platform: 'linux',
      port: 8790,
      start: () => {
        started = true
        return undefined as never
      },
      studioPublicKey: 'unused',
    })).toBeUndefined()
    Expect(started).toBe(false)
  })
})

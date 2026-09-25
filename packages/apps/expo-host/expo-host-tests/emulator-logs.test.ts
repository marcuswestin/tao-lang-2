import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { emulatorExitMessage } from '../expo-host-src/dev-loop/expo-runner/android'
import { EmulatorLogs } from '../expo-host-src/dev-loop/expo-runner/EmulatorLogs'

const runIds = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
]

Describe('Android emulator launch logs', () => {
  Test('isolates a later failed launch from an earlier processor refusal', async () => {
    const root = await FS.mkTmpDir('tao-emulator-logs-test-')
    const dependencies = fakeDependencies()
    try {
      const first = await EmulatorLogs.begin(root, dependencies)
      await FS.writeText(first.path, 'Incompatible processor. This Qt build requires neon\n')
      const second = await EmulatorLogs.begin(root, dependencies)
      await FS.writeText(second.path, 'FATAL | AVD is locked\n')

      Expect(first.path).not.toBe(second.path)
      Expect(emulatorExitMessage(await FS.readText(second.path), second.path))
        .toBe(`Android emulator exited before it booted: FATAL | AVD is locked. Its log is ${second.path}.`)
    } finally {
      await FS.remove(root)
    }
  })

  Test('retains an exact live child but retires a dead child even after PID reuse', async () => {
    const root = await FS.mkTmpDir('tao-emulator-logs-test-')
    const dependencies = fakeDependencies()
    try {
      const first = await EmulatorLogs.begin(root, dependencies)
      dependencies.setIdentity(501, 'emulator-501')
      await EmulatorLogs.recordChild(first, 501, dependencies)
      await FS.writeText(first.path, 'first launch\n')

      dependencies.advance(1_000)
      const second = await EmulatorLogs.begin(root, dependencies)
      dependencies.setIdentity(502, 'emulator-502')
      await EmulatorLogs.recordChild(second, 502, dependencies)
      await FS.writeText(second.path, 'second launch\n')

      dependencies.advance(8 * 24 * 60 * 60 * 1_000)
      dependencies.setIdentity(501, 'reused-501')
      await EmulatorLogs.prune(false, root, dependencies)
      Expect(await FS.isFile(first.path)).toBe(false)
      Expect(await FS.isFile(second.path)).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reclaims an interrupted allocation after grace while preserving uncertain live work', async () => {
    const root = await FS.mkTmpDir('tao-emulator-logs-test-')
    const dependencies = fakeDependencies()
    try {
      const interrupted = await EmulatorLogs.begin(root, dependencies)
      await FS.writeText(interrupted.path, 'incomplete launch\n')
      await FS.writeText(FS.resolvePath('legacy.log', root), 'unknown owner\n')
      dependencies.advance(8 * 24 * 60 * 60 * 1_000)
      dependencies.removeIdentity(100)

      await EmulatorLogs.prune(true, root, dependencies)
      Expect(await FS.isFile(interrupted.path)).toBe(true)
      await EmulatorLogs.prune(false, root, dependencies)
      Expect(await FS.isFile(interrupted.path)).toBe(false)
      Expect(await FS.isFile(FS.resolvePath('legacy.log', root))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps only the newest two dead failures and removes completed boot logs', async () => {
    const root = await FS.mkTmpDir('tao-emulator-logs-test-')
    const dependencies = fakeDependencies()
    try {
      const failures = []
      for (const pid of [501, 502, 503]) {
        const log = await EmulatorLogs.begin(root, dependencies)
        dependencies.setIdentity(pid, `emulator-${pid}`)
        await EmulatorLogs.recordChild(log, pid, dependencies)
        await EmulatorLogs.finish(log, 'failed')
        await FS.writeText(log.path, `failure ${pid}\n`)
        dependencies.removeIdentity(pid)
        failures.push(log)
        dependencies.advance(1_000)
      }
      const booted = await EmulatorLogs.begin(root, dependencies)
      await EmulatorLogs.finish(booted, 'booted')
      await FS.writeText(booted.path, 'booted\n')
      dependencies.removeIdentity(100)

      await EmulatorLogs.prune(false, root, dependencies)
      Expect(await FS.isFile(failures[0]!.path)).toBe(false)
      Expect(await FS.isFile(failures[1]!.path)).toBe(true)
      Expect(await FS.isFile(failures[2]!.path)).toBe(true)
      Expect(await FS.isFile(booted.path)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
})

function fakeDependencies() {
  let now = Date.parse('2026-09-25T12:00:00.000Z')
  let nextId = 0
  const identities = new Map<number, string>([[100, 'owner-100']])
  return {
    advance: (ms: number) => now += ms,
    identityOf: (pid: number) => {
      const startedAt = identities.get(pid)
      return startedAt === undefined ? undefined : { command: 'test', pid, startedAt }
    },
    isAlive: (pid: number) => identities.has(pid),
    now: () => now,
    ownerPid: 100,
    randomUUID: () => runIds[nextId++]!,
    removeIdentity: (pid: number) => identities.delete(pid),
    setIdentity: (pid: number, startedAt: string) => identities.set(pid, startedAt),
  }
}

import { FS, Platform, Repo } from '@shared'
import * as CLI from '@shared/CLI'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const DISPATCHER = Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/cli/agent-host-dispatch.ts')

Describe('named host command dispatch', () => {
  Test('opens Device Hub when Simulator.app is unavailable', async () => {
    const root = await mkTestDir('tao-simulator-open-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const bin = FS.resolvePath('bin', root)
      const log = FS.resolvePath('open.log', root)
      await FS.writeText(source, '{ "agentHostCommands": ["simulators open"] }')
      await FS.mkdir(bin)
      const open = FS.resolvePath('open', bin)
      await FS.writeText(
        open,
        '#!/bin/zsh\nprintf "%s\\n" "$*" >> "$TAO_HOST_LOG"\nif [[ "$2" == Simulator ]]; then exit 1; fi\n',
      )
      await FS.chmod(open, 0o755)
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [DISPATCHER, source, 'simulators', 'open'],
        cwd: root,
        env: { PATH: `${bin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`, TAO_HOST_LOG: log },
      })
      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual(['-a Simulator', '-a DeviceHub'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('runs an already booted simulator and falls back to its device URL', async () => {
    const root = await mkTestDir('tao-named-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const bin = FS.resolvePath('bin', root)
      const log = FS.resolvePath('commands.log', root)
      await FS.writeText(source, '{ "agentHostCommands": ["simulators run"] }')
      await FS.mkdir(bin)
      const xcrun = FS.resolvePath('xcrun', bin)
      const open = FS.resolvePath('open', bin)
      await FS.writeText(
        xcrun,
        '#!/bin/zsh\nprintf "xcrun:%s\\n" "$*" >> "$TAO_HOST_LOG"\nprint -u2 "Unable to boot device in current state: Booted"\nexit 1\n',
      )
      await FS.writeText(
        open,
        '#!/bin/zsh\nprintf "open:%s\\n" "$*" >> "$TAO_HOST_LOG"\nif [[ "$1" == -a && "$2" == Simulator ]]; then exit 1; fi\n',
      )
      await FS.chmod(xcrun, 0o755)
      await FS.chmod(open, 0o755)

      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [DISPATCHER, source, 'simulators', 'run', 'SIM PRO/27'],
        cwd: root,
        env: { PATH: `${bin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`, TAO_HOST_LOG: log },
      })
      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual([
        'xcrun:simctl boot SIM PRO/27',
        'open:-a Simulator --args -CurrentDeviceUDID SIM PRO/27',
        'open:devices://device/open?id=SIM%20PRO%2F27',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps process probes to their named read-only shapes', async () => {
    const root = await mkTestDir('tao-process-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const bin = FS.resolvePath('bin', root)
      const log = FS.resolvePath('ps.log', root)
      await FS.writeText(source, '{ "agentHostCommands": ["processes list", "processes started"] }')
      await FS.mkdir(bin)
      const ps = FS.resolvePath('ps', bin)
      await FS.writeText(ps, '#!/bin/zsh\nprintf "%s\\n" "$@" > "$TAO_HOST_LOG"\n')
      await FS.chmod(ps, 0o755)
      const env = { PATH: `${bin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`, TAO_HOST_LOG: log }

      const denied = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [DISPATCHER, source, 'processes', 'list', '-E'],
        cwd: root,
        env,
      })
      Expect(denied.exitCode).toBe(2)
      Expect(await FS.exists(log)).toBe(false)

      const started = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [DISPATCHER, source, 'processes', 'started', '1234'],
        cwd: root,
        env,
      })
      Expect(started.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual(['-o', 'lstart=', '-p', '1234'])
    } finally {
      await FS.remove(root)
    }
  })
})

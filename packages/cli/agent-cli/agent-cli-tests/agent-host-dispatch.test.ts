import { FS, Platform, Repo } from '@shared'
import * as CLI from '@shared/CLI'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const DISPATCHER = Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/cli/agent-host-dispatch.ts')

Describe('named host command dispatch', () => {
  Test('bounds Watchman management to fixed lifecycle actions', async () => {
    const root = await mkTestDir('tao-watchman-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const log = FS.resolvePath('dev.log', root)
      await FS.writeText(
        source,
        JSON.stringify({
          agentHostCommands: ['watchman start', 'watchman status', 'watchman stop'],
        }),
      )
      const dev = FS.resolvePath('dev', root)
      await FS.writeText(dev, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TAO_HOST_LOG"\nexit "${TAO_DEV_EXIT:-0}"\n')
      await FS.chmod(dev, 0o755)
      const invoke = (args: string[], exitCode = '0') =>
        CLI.run(Platform.runtimeProcess.execPath, {
          args: [DISPATCHER, source, 'watchman', ...args],
          cwd: root,
          env: { TAO_HOST_LOG: log, TAO_DEV_EXIT: exitCode },
        })
      for (const action of ['start', 'status', 'stop']) {
        Expect((await invoke([action])).exitCode).toBe(0)
        Expect(await FS.readText(log)).toBe(`watchman\n${action}\n`)
      }
      await FS.remove(log)
      for (const args of [[], ['watch-del-all'], ['start', '--sockname', '/foreign'], ['stop', '--help']]) {
        Expect((await invoke(args)).exitCode).toBe(2)
      }
      Expect(await FS.exists(log)).toBe(false)
      Expect((await invoke(['start'], '7')).exitCode).toBe(7)
    } finally {
      await FS.remove(root)
    }
  })

  Test('bounds Studio lifecycle selectors and preserves stop failures', async () => {
    const root = await mkTestDir('tao-studio-lifecycle-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const log = FS.resolvePath('dev.log', root)
      await FS.writeText(source, '{ "agentHostCommands": ["studio-ps", "studio-stop"] }')
      const dev = FS.resolvePath('dev', root)
      await FS.writeText(dev, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TAO_HOST_LOG"\nexit "${TAO_DEV_EXIT:-0}"\n')
      await FS.chmod(dev, 0o755)
      const invoke = (args: string[], exitCode = '0') =>
        CLI.run(Platform.runtimeProcess.execPath, {
          args: [DISPATCHER, source, ...args],
          cwd: root,
          env: { TAO_HOST_LOG: log, TAO_DEV_EXIT: exitCode },
        })
      const valid = [
        ['studio-ps'],
        ['studio-ps', '--json'],
        ['studio-ps', '--help'],
        ['studio-stop'],
        ['studio-stop', '--help'],
        ['studio-stop', '-h'],
        ['studio-stop', '--all'],
        ['studio-stop', '--json'],
        ['studio-stop', '--all', '--json'],
        ['studio-stop', '--json', '--all'],
        ['studio-stop', '--launch', 'browser-owned-id'],
        ['studio-stop', '--launch', 'browser-owned-id', '--json'],
        ['studio-stop', '--json', '--launch', 'browser-owned-id'],
      ]
      for (const args of valid) {
        Expect((await invoke(args)).exitCode).toBe(0)
        Expect((await FS.readText(log)).trim().split('\n')).toEqual(args)
      }
      await FS.remove(log)
      const invalid = [
        ['studio-ps', '--all'],
        ['studio-ps', '--launch', 'browser-owned-id'],
        ['studio-ps', '--json', '--json'],
        ['studio-ps', '--help', '--json'],
        ['studio-stop', '--launch'],
        ['studio-stop', '--launch', '--all'],
        ['studio-stop', '--all', '--launch', 'browser-owned-id'],
        ['studio-stop', '--launch', 'browser-owned-id', '--all'],
        ['studio-stop', '--all', '--all'],
        ['studio-stop', '--json', '--json'],
        ['studio-stop', '--launch', '../foreign'],
        ['studio-stop', '--launch', ''],
        ['studio-stop', '--launch', 'a'.repeat(129)],
        ['studio-stop', '--launch', 'first', '--launch', 'second'],
        ['studio-stop', '--pid', '123'],
        ['studio-stop', '--signal', 'KILL'],
        ['studio-stop', '--root', '/tmp'],
        ['studio-stop', '123'],
      ]
      for (const args of invalid) {
        Expect((await invoke(args)).exitCode).toBe(2)
      }
      Expect(await FS.exists(log)).toBe(false)
      Expect((await invoke(['studio-stop', '--launch', 'browser-owned-id'], '1')).exitCode).toBe(1)
    } finally {
      await FS.remove(root)
    }
  })

  Test('launches only Docker Desktop and propagates launch failure', async () => {
    const root = await mkTestDir('tao-docker-desktop-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const bin = FS.resolvePath('bin', root)
      const log = FS.resolvePath('open.log', root)
      await FS.writeText(source, '{ "agentHostCommands": ["docker-desktop start"] }')
      const open = FS.resolvePath('open', bin)
      await FS.writeText(open, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$TAO_HOST_LOG"\nexit "${TAO_OPEN_EXIT:-0}"\n')
      await FS.chmod(open, 0o755)
      const invoke = (args: string[], exitCode = '0') =>
        CLI.run(Platform.runtimeProcess.execPath, {
          args: [DISPATCHER, source, 'docker-desktop', ...args],
          cwd: root,
          env: {
            PATH: `${bin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
            TAO_HOST_LOG: log,
            TAO_OPEN_EXIT: exitCode,
          },
        })
      Expect((await invoke(['start'])).exitCode).toBe(0)
      Expect(await FS.readText(log)).toBe('-a\nDocker\n')
      Expect((await invoke(['start', '-a', 'Terminal'])).exitCode).toBe(2)
      Expect((await invoke(['stop'])).exitCode).toBe(2)
      Expect(await FS.readText(log)).toBe('-a\nDocker\n')
      Expect((await invoke(['start'], '1')).exitCode).toBe(1)
    } finally {
      await FS.remove(root)
    }
  })

  Test('routes only reclaim execution through the named host target', async () => {
    const root = await mkTestDir('tao-reclaim-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const log = FS.resolvePath('dev.log', root)
      await FS.writeText(source, '{ "agentHostCommands": ["reclaim --execute"] }')
      const dev = FS.resolvePath('dev', root)
      await FS.writeText(dev, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TAO_HOST_LOG"\n')
      await FS.chmod(dev, 0o755)
      const executed = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [DISPATCHER, source, 'reclaim', '--execute'],
        cwd: root,
        env: { TAO_HOST_LOG: log },
      })
      Expect(executed.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual(['reclaim', '--execute'])

      const rejected = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [DISPATCHER, source, 'reclaim', '--execute', '--report-json'],
        cwd: root,
        env: { TAO_HOST_LOG: log },
      })
      Expect(rejected.exitCode).toBe(2)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual(['reclaim', '--execute'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('forwards only the selected release preparation target as argv', async () => {
    const root = await mkTestDir('tao-release-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const log = FS.resolvePath('dev.log', root)
      await FS.writeText(source, '{ "agentHostCommands": ["prepare-release studio", "prepare-release ide-extension"] }')
      const dev = FS.resolvePath('dev', root)
      await FS.writeText(dev, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TAO_HOST_LOG"\n')
      await FS.chmod(dev, 0o755)
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [DISPATCHER, source, 'prepare-release', 'studio', '--repo', 'owner/repo', '--version', '0.0.1'],
        cwd: root,
        env: { TAO_HOST_LOG: log },
      })
      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual([
        'prepare-release',
        'studio',
        '--repo',
        'owner/repo',
        '--version',
        '0.0.1',
      ])
    } finally {
      await FS.remove(root)
    }
  })

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
        '#!/usr/bin/env zsh\nprintf "%s\\n" "$*" >> "$TAO_HOST_LOG"\nif [[ "$2" == Simulator ]]; then exit 1; fi\n',
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
        '#!/usr/bin/env zsh\nprintf "xcrun:%s\\n" "$*" >> "$TAO_HOST_LOG"\nprint -u2 "Unable to boot device in current state: Booted"\nexit 1\n',
      )
      await FS.writeText(
        open,
        '#!/usr/bin/env zsh\nprintf "open:%s\\n" "$*" >> "$TAO_HOST_LOG"\nif [[ "$1" == -a && "$2" == Simulator ]]; then exit 1; fi\n',
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

  Test('runs CocoaPods from the selected Podfile directory', async () => {
    const root = await mkTestDir('tao-pods-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const bin = FS.resolvePath('bin', root)
      const ios = FS.resolvePath('ios', root)
      const log = FS.resolvePath('pod.log', root)
      await FS.writeText(source, '{ "agentHostCommands": ["pods install"] }')
      await FS.mkdir(bin)
      await FS.mkdir(ios)
      await FS.writeText(FS.resolvePath('Podfile', ios), '')
      const pod = FS.resolvePath('pod', bin)
      await FS.writeText(pod, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" > "$TAO_HOST_LOG"\n')
      await FS.chmod(pod, 0o755)
      const env = { PATH: `${bin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`, TAO_HOST_LOG: log }

      const installed = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [DISPATCHER, source, 'pods', 'install', 'ios', '--repo-update'],
        cwd: root,
        env,
      })
      Expect(installed.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual([ios, 'install', '--repo-update'])

      const invalid = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [DISPATCHER, source, 'pods', 'install', '..'],
        cwd: root,
        env,
      })
      Expect(invalid.exitCode).toBe(2)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual([ios, 'install', '--repo-update'])
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
      await FS.writeText(ps, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TAO_HOST_LOG"\n')
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

  Test('validates VM recovery and base profiles before Just can interpret extra recipes or options', async () => {
    const root = await mkTestDir('tao-vm-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const log = FS.resolvePath('just.log', root)
      const just = FS.resolvePath('just', root)
      await FS.writeText(source, '{ "agentHostCommands": ["standalone-cli-clean-machine"] }')
      await FS.writeText(just, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TAO_HOST_LOG"\n')
      await FS.chmod(just, 0o755)
      const env = { PATH: root, TAO_HOST_LOG: log }
      for (
        const args of [
          ['--diagnose', 'tao-acceptance-1-2', 'fix'],
          ['--dry-run'],
          ['--justfile', '/tmp/untrusted'],
          ['--stop', '../other'],
          ['--recover-lease', '../other'],
          ['--audit-results', '../other'],
          ['--audit-results', 'tao-acceptance-1-2', 'fix'],
          ['--recover-lease', 'tao-acceptance-1-2', 'fix'],
          ['--diagnose', 'vanilla'],
          ['--prepare-base'],
          ['--base'],
          ['--prepare-base', 'unknown'],
          ['--base', 'unknown'],
          ['--prepare-base', 'tao-acceptance-1-2'],
          ['--base', 'tao-acceptance-1-2'],
          ['--prepare-base', 'vanilla', 'fix'],
          ['--base', 'xcode', 'fix'],
          ['--prepare-base', '--justfile'],
          ['--base', 'vanilla fix'],
          ['--base=vanilla'],
        ]
      ) {
        const denied = await CLI.run(Platform.runtimeProcess.execPath, {
          args: [DISPATCHER, source, 'standalone-cli-clean-machine', ...args],
          cwd: root,
          env,
        })
        Expect(denied.exitCode).toBe(2)
        Expect(denied.stderr).toContain('--prepare-base|--base <vanilla|xcode>')
        Expect(await FS.exists(log)).toBe(false)
      }
      for (
        const args of [
          [],
          ['--diagnose', 'tao-acceptance-1-2'],
          ['--stop', 'tao-acceptance-1-2'],
          ['--collect', 'tao-acceptance-1-2'],
          ['--recover-lease', 'tao-acceptance-1-2'],
          ['--audit-results', 'tao-acceptance-1-2'],
          ['--prepare-base', 'vanilla'],
          ['--prepare-base', 'xcode'],
          ['--base', 'vanilla'],
          ['--base', 'xcode'],
        ]
      ) {
        const accepted = await CLI.run(Platform.runtimeProcess.execPath, {
          args: [DISPATCHER, source, 'standalone-cli-clean-machine', ...args],
          cwd: root,
          env,
        })
        Expect(accepted.exitCode).toBe(0)
        Expect((await FS.readText(log)).trim().split('\n')).toEqual(['standalone-cli-clean-machine', ...args])
      }
    } finally {
      await FS.remove(root)
    }
  })
})

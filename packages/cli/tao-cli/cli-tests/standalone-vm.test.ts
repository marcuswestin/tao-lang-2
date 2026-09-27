import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const HELPER = Repo.resolvePath('packages/cli/tao-cli/cli-src/standalone-vm.ts')
const CLEAN_MACHINE = Repo.resolvePath('packages/cli/tao-cli/cli-src/standalone-clean-machine.sh')

Describe('standalone VM transport', () => {
  Test('checks for other guests at boot and always disables clipboard sharing', async () => {
    const root = await mkTestDir('standalone-vm-boot-')
    const log = FS.resolvePath('calls', root)
    try {
      await FS.writeText(
        FS.resolvePath('tart', root),
        `#!/bin/sh
if [ "$1" = list ]; then
  printf '[{"Name":"unrelated","Running":%s}]\\n' "$VM_RUNNING"
else
  printf '%s\\n' "$@" > "$VM_CALLS"
fi
`,
      )
      await FS.chmod(FS.resolvePath('tart', root), 0o755)
      const invoke = (running: string, operation: string) =>
        CLI.run(Platform.runtimeProcess.execPath, {
          args: ['run', HELPER, operation, 'tao-acceptance-1-2', root],
          env: { ...Platform.runtimeProcess.env, PATH: root, VM_RUNNING: running, VM_CALLS: log },
        })
      Expect((await invoke('false', 'idle')).exitCode).toBe(0)
      Expect((await invoke('true', 'boot')).exitCode).not.toBe(0)
      Expect(await FS.exists(log)).toBe(false)
      Expect((await invoke('false', 'boot')).exitCode).toBe(0)
      Expect(await FS.readText(log)).toBe('run\n--no-graphics\n--no-clipboard\ntao-acceptance-1-2\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('lease recovery refuses live owners and possibly mounted disks', async () => {
    const root = await mkTestDir('standalone-vm-recovery-')
    const ownerFile = FS.resolvePath('.tao/standalone-vm-lease/owner.txt', root)
    try {
      await FS.writeText(FS.resolvePath('tart', root), '#!/bin/sh\nprintf "[]\\n"\n')
      await FS.chmod(FS.resolvePath('tart', root), 0o755)
      await FS.writeText(FS.resolvePath('ps', root), '#!/bin/sh\nprintf "original process identity\\n"\n')
      await FS.chmod(FS.resolvePath('ps', root), 0o755)
      const tartHome = FS.resolvePath('.tart', root)
      await FS.mkdir(tartHome)
      const owner =
        `pid=1234\nstarted=original process identity\nrun=${root}\nvm=tao-acceptance-1-2\ntart_home=${await FS.realPath(
          tartHome,
        )}\n`
      await FS.writeText(ownerFile, owner)
      const invoke = (storage = tartHome) =>
        CLI.run(Platform.runtimeProcess.execPath, {
          args: ['run', HELPER, 'recover-lease', 'tao-acceptance-1-2', root],
          env: { ...Platform.runtimeProcess.env, HOME: root, PATH: root, TART_HOME: storage },
        })
      const live = await invoke()
      Expect(live.exitCode).not.toBe(0)
      Expect(live.stderr).toContain('owner is still alive')
      Expect(await FS.readText(ownerFile)).toBe(owner)
      await FS.writeText(ownerFile, owner.replace('original process identity', 'expired process identity'))
      const wrongStore = await invoke(root)
      Expect(wrongStore.exitCode).not.toBe(0)
      Expect(wrongStore.stderr).toContain('different or unrecorded Tart storage')
      Expect(await FS.exists(ownerFile)).toBe(true)
      await FS.writeText(FS.resolvePath('disk-attached', root), 'retained disk')
      const mounted = await invoke()
      Expect(mounted.exitCode).not.toBe(0)
      Expect(mounted.stderr).toContain('may have an attached disk')
      Expect(await FS.exists(ownerFile)).toBe(true)
      // Successful recovery also consults macOS's real, read-only mounted-image inventory.
      if (Platform.hostPlatform === 'darwin') {
        await FS.remove(FS.resolvePath('disk-attached', root))
        const recovered = await invoke()
        Expect(recovered.stderr).toBe('')
        Expect(recovered.exitCode).toBe(0)
        Expect(await FS.exists(FS.dirname(ownerFile))).toBe(false)
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses any running local VM without stopping it and permits stopped VMs', async () => {
    const root = await mkTestDir('standalone-vm-idle-')
    try {
      const tart = FS.resolvePath('tart', root)
      const state = FS.resolvePath('state.json', root)
      const calls = FS.resolvePath('calls', root)
      await FS.writeText(tart, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$VM_CALLS"\n/bin/cat "$VM_STATE"\n')
      await FS.chmod(tart, 0o755)
      const env = { PATH: root, VM_CALLS: calls, VM_STATE: state }
      await FS.writeJson(state, [
        { Name: 'someone-elses-work', Running: true },
        { Name: 'tao-acceptance-1-2', Running: false },
      ])
      const denied = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', HELPER, 'idle', 'tao-acceptance-1-2', root],
        env,
      })
      Expect(denied.exitCode).not.toBe(0)
      Expect(denied.stderr).toContain('Another Tart VM is running: someone-elses-work.')
      Expect(await FS.readText(calls)).toBe('list\n--source\nlocal\n--format\njson\n')

      await FS.writeJson(state, [{ Name: 'someone-elses-work', Running: false }])
      const idle = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', HELPER, 'idle', 'tao-acceptance-1-2', root],
        env,
      })
      Expect(idle.exitCode).toBe(0)
      Expect(await FS.readText(calls)).toBe(
        'list\n--source\nlocal\n--format\njson\nlist\n--source\nlocal\n--format\njson\n',
      )
    } finally {
      await FS.remove(root)
    }
  })

  Test(
    'qualifies Xcode only with pinned provenance and an available iOS runtime, retaining observed tools',
    async () => {
      const root = await mkTestDir('standalone-vm-qualification-')
      try {
        const run = FS.resolvePath('tao-acceptance-1-2', root)
        const logs = FS.resolvePath('logs', run)
        const manifest = FS.resolvePath('bases/xcode.json', root)
        const tart = FS.resolvePath('tart', root)
        const calls = FS.resolvePath('calls', root)
        const source = `ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:${'a'.repeat(64)}`
        await FS.writeText(
          tart,
          '#!/bin/sh\nprintf "%s\\n" "$@" >> "$VM_CALLS"\n[ "$1" = --version ] || exit 91\nprintf "2.32.1\\n"\n',
        )
        await FS.chmod(tart, 0o755)
        await FS.writeText(FS.resolvePath('profile.txt', logs), 'xcode\n')
        await FS.writeText(FS.resolvePath('source-image.txt', logs), `${source}\n`)
        await FS.writeJson(FS.resolvePath('transport-owner.json', logs), { kind: 'vendor', version: '0.10.0' })
        await FS.writeText(FS.resolvePath('guest/steps/guest-platform.log', logs), 'macOS 26.0 arm64\n')
        await FS.writeText(FS.resolvePath('guest/steps/xcode-version.log', logs), 'Xcode 26.0\nBuild version 17A324\n')
        await FS.writeText(FS.resolvePath('guest/steps/brew-version.log', logs), 'Homebrew 4.6.0\n')
        await FS.writeText(FS.resolvePath('guest/steps/vendor-node-version.log', logs), 'v22.19.0\n')
        const summaryPath = FS.resolvePath('guest/steps/acceptance-summary.json', logs)
        const summary = { format: 'tao-standalone-acceptance-v1', scenarios: [{ status: 'passed' }] }
        await FS.writeJson(summaryPath, summary)
        const runtimesPath = FS.resolvePath('guest/steps/simulator-runtimes.json', logs)
        await FS.writeJson(runtimesPath, {
          runtimes: [
            { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0', isAvailable: false },
            { identifier: 'com.apple.CoreSimulator.SimRuntime.tvOS-26-0', isAvailable: true },
          ],
        })
        const qualify = () =>
          CLI.run(Platform.runtimeProcess.execPath, {
            args: ['run', HELPER, 'qualify', 'tao-acceptance-1-2', run],
            env: { PATH: root, VM_CALLS: calls },
          })
        const unavailable = await qualify()
        Expect(unavailable.exitCode).not.toBe(0)
        Expect(unavailable.stderr).toContain('no available iOS Simulator runtime')
        Expect(await FS.exists(manifest)).toBe(false)
        Expect(await FS.exists(calls)).toBe(false)

        const runtimes = [{ identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0', isAvailable: true }]
        await FS.writeJson(runtimesPath, { runtimes })
        await FS.writeText(FS.resolvePath('source-image.txt', logs), 'ghcr.io/cirruslabs/macos-tahoe-xcode:latest\n')
        const unpinned = await qualify()
        Expect(unpinned.exitCode).not.toBe(0)
        Expect(unpinned.stderr).toContain('digest-pinned source')
        Expect(await FS.exists(manifest)).toBe(false)
        Expect(await FS.exists(calls)).toBe(false)

        await FS.writeText(FS.resolvePath('source-image.txt', logs), `${source}\n`)
        for (const scenarios of [[], [{ status: 'running' }], [{ status: 'failed' }], [{ status: 'unrun' }]]) {
          await FS.writeJson(summaryPath, { ...summary, scenarios })
          const incomplete = await qualify()
          Expect(incomplete.exitCode).not.toBe(0)
          Expect(incomplete.stderr).toContain('summary is not complete and passing')
          Expect(await FS.exists(manifest)).toBe(false)
          Expect(await FS.exists(calls)).toBe(false)
        }
        await FS.writeJson(summaryPath, summary)
        const qualified = await qualify()
        Expect(qualified.exitCode).toBe(0)
        Expect(await FS.readJson(manifest)).toMatchObject({
          format: 'tao-vm-base-qualification-v1',
          profile: 'xcode',
          source,
          evidence: logs,
          tartVersion: '2.32.1',
          platform: 'macOS 26.0 arm64',
          transport: { kind: 'vendor', version: '0.10.0' },
          tools: {
            xcode: 'Xcode 26.0\nBuild version 17A324',
            brew: 'Homebrew 4.6.0',
            'vendor-node': 'v22.19.0',
            simulatorRuntimes: [{ identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0', isAvailable: true }],
          },
        })
        Expect((await FS.readJson<{ qualifiedAt: string }>(manifest)).qualifiedAt)
          .toMatch(/^\d{4}-\d{2}-\d{2}T/)
        Expect(await FS.readText(calls)).toBe('--version\n')
      } finally {
        await FS.remove(root)
      }
    },
  )

  Test('preserves another workflow lease and releases its own lease after a preboot failure', async () => {
    const root = await mkTestDir('standalone-vm-lease-')
    const runLogs: string[] = []
    try {
      const tart = FS.resolvePath('tart', root)
      const calls = FS.resolvePath('calls', root)
      const home = FS.resolvePath('home', root)
      const lease = FS.resolvePath('.tao/standalone-vm-lease', home)
      const owner = FS.resolvePath('owner.txt', lease)
      await FS.writeText(
        tart,
        `#!/bin/sh
printf '%s\\n' "$@" >> "$VM_CALLS"
case "$1" in
  list) printf '[]\\n' ;;
  --version) printf '2.31.0\\n' ;;
  *) exit 91 ;;
esac
`,
      )
      await FS.chmod(tart, 0o755)
      await FS.writeText(owner, 'pid=12345\nvm=someone-elses-work\n')
      const run = async () => {
        const result = await CLI.run('/bin/bash', {
          args: [CLEAN_MACHINE],
          cwd: Repo.getRoot(),
          env: {
            HOME: home,
            PATH: `${root}:/usr/bin:/bin`,
            VM_CALLS: calls,
            TAO_STANDALONE_BUN: Platform.runtimeProcess.execPath,
          },
          processPolicy: 'test',
          timeoutMs: 30_000,
        })
        const logs = /^Clean-machine logs: (.+)$/m.exec(result.stdout)?.[1]
        if (logs !== undefined) {
          runLogs.push(logs)
        }
        return result
      }
      const denied = await run()
      Expect(denied.exitCode).not.toBe(0)
      Expect(denied.stderr).toContain('Another VM workflow owns')
      Expect(await FS.readText(owner)).toBe('pid=12345\nvm=someone-elses-work\n')
      Expect(await FS.exists(calls)).toBe(false)

      await FS.remove(lease)
      const preboot = await run()
      Expect(preboot.exitCode).not.toBe(0)
      Expect(preboot.stderr).toContain('Tart 2.32.1 or newer is required')
      Expect(await FS.exists(lease)).toBe(false)
      Expect(await FS.readText(calls)).toBe('list\n--source\nlocal\n--format\njson\n--version\n')
      Expect(runLogs).toHaveLength(2)
    } finally {
      for (const logs of runLogs) {
        const run = FS.dirname(logs)
        Expect(FS.pathIsWithin(run, Repo.resolvePath('.artifacts/standalone-vm'))).toBe(true)
        Expect(FS.basename(run)).toMatch(/^tao-acceptance-[0-9]+-[0-9]+$/)
        await FS.remove(run)
      }
      await FS.remove(root)
    }
  })

  Test('refuses to mount a running VM before touching its disk', async () => {
    const root = await mkTestDir('standalone-vm-running-')
    try {
      const tart = FS.resolvePath('tart', root)
      await FS.writeText(tart, '#!/bin/sh\nprintf \'{"Running":true,"State":"running"}\\n\'\n')
      await FS.chmod(tart, 0o755)
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', HELPER, 'collect', 'tao-acceptance-1-2', root],
        env: { ...Platform.runtimeProcess.env, PATH: root, TART_HOME: FS.resolvePath('absent', root) },
      })
      Expect(result.exitCode).not.toBe(0)
      Expect(result.stderr).toContain('expected a stopped VM')
      Expect(await FS.exists(FS.resolvePath('disk-attached', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('stops an owned VM without depending on guest RPC and refuses an unrelated name', async () => {
    const root = await mkTestDir('standalone-vm-stop-')
    try {
      const tart = FS.resolvePath('tart', root)
      const log = FS.resolvePath('calls', root)
      await FS.writeText(tart, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$VM_CALLS"\n[ "$1" = stop ]\n')
      await FS.chmod(tart, 0o755)
      await FS.mkdir(FS.resolvePath('.artifacts/standalone-vm/tao-acceptance-1-2/logs', root))
      const script = Repo.resolvePath('packages/cli/tao-cli/cli-src/standalone-clean-machine.sh')
      const env = { PATH: `${root}:/usr/bin:/bin`, VM_CALLS: log }
      const result = await CLI.run('/bin/bash', { args: [script, '--stop', 'tao-acceptance-1-2'], cwd: root, env })
      Expect(result.exitCode).toBe(0)
      Expect(await FS.readText(log)).toBe('stop\ntao-acceptance-1-2\n')
      const denied = await CLI.run('/bin/bash', { args: [script, '--stop', 'tao-acceptance-3-4'], cwd: root, env })
      Expect(denied.exitCode).toBe(2)
      Expect(await FS.readText(log)).toBe('stop\ntao-acceptance-1-2\n')
      await FS.mkdir(FS.resolvePath('.artifacts/standalone-vm/tao-acceptance-1-2/run-active', root))
      const collecting = await CLI.run('/bin/bash', {
        args: [script, '--collect', 'tao-acceptance-1-2'],
        cwd: root,
        env,
      })
      Expect(collecting.exitCode).not.toBe(0)
      Expect(collecting.stderr).toContain('original runner still owns')
      Expect(await FS.readText(log)).toBe('stop\ntao-acceptance-1-2\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('preserves binary stdout, literal arguments, stderr, and guest failure status', async () => {
    const root = await mkTestDir('standalone-vm-transport-')
    try {
      const tart = FS.resolvePath('tart', root)
      await FS.writeText(
        tart,
        `#!/bin/sh
test "$1" = exec && test "$2" = tao-acceptance-1-2 && test "$3" = /guest/tool && test "$4" = 'space $literal' || exit 91
printf '\\000\\377\\200'
printf 'guest error' >&2
exit 17
`,
      )
      await FS.chmod(tart, 0o755)
      const bytes: number[] = []
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', HELPER, 'exec', 'tao-acceptance-1-2', '30000', '/guest/tool', 'space $literal'],
        env: { ...Platform.runtimeProcess.env, PATH: root },
        onOutput: (stream, chunk) => {
          if (stream === 'stdout') {
            bytes.push(...chunk)
          }
        },
      })
      Expect(result.exitCode).toBe(17)
      Expect(bytes).toEqual([0, 255, 128])
      Expect(result.stderr).toBe('guest error')
    } finally {
      await FS.remove(root)
    }
  })

  Test('fails a stalled transport within its declared parent timeout', async () => {
    const root = await mkTestDir('standalone-vm-timeout-')
    try {
      const tart = FS.resolvePath('tart', root)
      await FS.writeText(tart, '#!/bin/sh\nexec /bin/sleep 30\n')
      await FS.chmod(tart, 0o755)
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        // A deliberately short child deadline exercises timeout handling, not performance.
        args: ['run', HELPER, 'exec', 'tao-acceptance-1-2', '100', '/usr/bin/true'],
        env: { ...Platform.runtimeProcess.env, PATH: root },
        processPolicy: 'test',
        timeoutMs: 30_000,
      })
      Expect(result.exitCode).not.toBe(0)
      Expect(result.stderr).toContain('timed out')
    } finally {
      await FS.remove(root)
    }
  })
})

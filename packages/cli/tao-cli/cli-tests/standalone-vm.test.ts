import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const HELPER = Repo.resolvePath('packages/cli/tao-cli/cli-src/standalone-vm.ts')

Describe('standalone VM transport', () => {
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

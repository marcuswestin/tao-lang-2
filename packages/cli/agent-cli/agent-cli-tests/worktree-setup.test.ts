import { CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('worktree setup hook', () => {
  Test('direct invocation enters its checkout and preserves the existing devenv setup contract', async () => {
    const base = await mkTestDir('tao-worktree-setup-')
    try {
      const root = FS.resolvePath("checkout with ' quote", base)
      const hook = FS.resolvePath('.cursor/worktree-setup.sh', root)
      await FS.writeText(hook, await FS.readText(Repo.resolvePath('.cursor/worktree-setup.sh')), { mode: 0o755 })
      const bin = FS.resolvePath('bin', base)
      await FS.writeText(
        FS.resolvePath('devenv', bin),
        `#!/bin/sh
printf '%s\\n' "$PWD" "$TAO_DEV_SHELL_SETUP" "$@"
exit 23
`,
        { mode: 0o755 },
      )
      const result = await CLI.run(hook, {
        cwd: base,
        env: { PATH: `${bin}:/usr/bin:/bin`, TAO_DEV_SHELL_SETUP: '1' },
      })
      Expect(result.stdout.trim().split('\n')).toEqual([
        await FS.realPath(root),
        '0',
        'shell',
        '--no-tui',
        './agent',
        'setup',
      ])
      Expect(result.stderr).toBe('')
      Expect(result.exitCode).toBe(23)
    } finally {
      await FS.remove(base)
    }
  })
})

import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const ENTRY = Repo.resolvePath('enter-tao-dev-env')

Describe('interactive Tao development shell', () => {
  Test('runs setup once in devenv before entering the interactive shell', async () => {
    const fixture = await mkTestDir('tao-dev-shell-')
    try {
      const bin = FS.resolvePath('bin', fixture)
      const log = FS.resolvePath('calls.log', fixture)
      const stub = FS.resolvePath('devenv', bin)
      await FS.writeText(stub, '#!/bin/sh\nprintf "%s|%s|%s\\n" "$PWD" "$DEVENV_TUI" "$*" >> "$TAO_TEST_DEVENV_LOG"\n')
      await FS.chmod(stub, 0o755)
      const result = await CLI.run('/bin/sh', {
        args: [ENTRY],
        cwd: fixture,
        env: {
          ...Platform.runtimeProcess.env,
          PATH: `${bin}:/usr/bin:/bin`,
          SHELL: '/bin/zsh',
          TAO_TEST_DEVENV_LOG: log,
        },
      })

      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual([
        `${Repo.getRoot()}|false|shell --no-tui ./agent setup`,
        `${Repo.getRoot()}|false|shell --no-tui -- zsh -i`,
      ])
    } finally {
      await FS.remove(fixture)
    }
  })
})

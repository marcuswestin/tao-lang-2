import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const ENTRY = Repo.resolvePath('enter-tao-dev-env')
const SHELL_SOURCE = 'packages/cli/dev-cli/dev-cli-src/shell'

async function prepareFixture(fixture: string): Promise<Record<string, string | undefined>> {
  const zsh = await CLI.commandPath('zsh')
  Assert.defined(zsh, 'the managed toolchain supplies zsh')
  const bin = FS.resolvePath('bin', fixture)
  const stub = FS.resolvePath('devenv', bin)
  await FS.copyFile(ENTRY, FS.resolvePath('enter-tao-dev-env', fixture))
  await FS.copyFile(Repo.resolvePath(`${SHELL_SOURCE}/.zshrc`), FS.resolvePath(`${SHELL_SOURCE}/.zshrc`, fixture))
  await FS.writeText(
    stub,
    `#!/bin/sh
printf '%s|%s|%s\\n' "$PWD" "$DEVENV_TUI" "$*" >> "$TAO_TEST_DEVENV_LOG"
if [ "$*" = 'shell --no-tui -- zsh -i' ]; then
  printf '%s\\n%s\\n' "$ZDOTDIR" "$TAO_ORIGINAL_ZDOTDIR" > "$TAO_TEST_STARTUP_ENV"
  if [ -n "$TAO_TEST_STARTUP_SCRIPT" ]; then
    exec "$TAO_TEST_ZSH" -f "$TAO_TEST_STARTUP_SCRIPT"
  fi
fi
`,
  )
  await FS.chmod(stub, 0o755)
  return {
    ...Platform.runtimeProcess.env,
    PATH: `${bin}:/usr/bin:/bin`,
    SHELL: zsh,
    TAO_TEST_ZSH: zsh,
    ZDOTDIR: undefined,
    DEVENV_ROOT: fixture,
    TAO_TEST_DEVENV_LOG: FS.resolvePath('calls.log', fixture),
    TAO_TEST_STARTUP_ENV: FS.resolvePath('startup-env.log', fixture),
  }
}

Describe('interactive Tao development shell', () => {
  Test('runs setup once in devenv before entering the interactive shell', async () => {
    const fixture = await mkTestDir('tao-dev-shell-')
    try {
      const log = FS.resolvePath('calls.log', fixture)
      const env = await prepareFixture(fixture)
      const result = await CLI.run('/bin/sh', {
        args: [FS.resolvePath('enter-tao-dev-env', fixture)],
        cwd: fixture,
        env,
      })

      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual([
        `${fixture}|false|shell --no-tui ./agent setup`,
        `${fixture}|false|shell --no-tui -- zsh -i`,
      ])
      Expect((await FS.readText(FS.resolvePath('startup-env.log', fixture))).trim().split('\n')).toEqual([
        FS.resolvePath('.artifacts/cache/dev-shell/zsh', fixture),
        Platform.runtimeProcess.env['HOME'],
      ])
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('keeps early compinit dumps in the cache while preserving user startup and dev completion', async () => {
    const fixture = await mkTestDir('tao-dev-shell-')
    try {
      const env = await prepareFixture(fixture)
      const original = FS.resolvePath('user-zsh', fixture)
      const cache = FS.resolvePath('.artifacts/cache/dev-shell/zsh', fixture)
      const startup = FS.resolvePath('startup.zsh', fixture)
      await FS.writeText(FS.resolvePath('.zshrc', original), 'export TAO_TEST_USER_STARTUP="$ZDOTDIR"\n')
      await FS.writeText(
        FS.resolvePath('dev', fixture),
        `#!/bin/sh
[ "$*" = 'completion zsh' ] || exit 1
printf 'export TAO_TEST_COMPLETION_LOADED=yes\\n'
`,
      )
      await FS.chmod(FS.resolvePath('dev', fixture), 0o755)
      // Model the system zshrc running compinit before the checkout's startup file is read.
      // -f avoids loading real user startup files; compinit itself chooses its default dump path.
      await FS.writeText(
        startup,
        `autoload -Uz compinit
compinit -u
source "$ZDOTDIR/.zshrc"
printf '%s\\n%s\\n%s\\n' "$ZDOTDIR" "$TAO_TEST_USER_STARTUP" "$TAO_TEST_COMPLETION_LOADED" > "$DEVENV_ROOT/startup-result.log"
`,
      )
      const initialStarts = await Promise.all([1, 2].map(() =>
        CLI.run('/bin/sh', {
          args: [FS.resolvePath('enter-tao-dev-env', fixture)],
          cwd: fixture,
          env: { ...env, ZDOTDIR: original },
        })
      ))
      Expect(initialStarts.map(result => result.exitCode)).toEqual([0, 0])
      for (const _attempt of [1, 2]) {
        const result = await CLI.run('/bin/sh', {
          args: [FS.resolvePath('enter-tao-dev-env', fixture)],
          cwd: fixture,
          env: { ...env, ZDOTDIR: original, TAO_TEST_STARTUP_SCRIPT: startup },
        })
        Expect(result.exitCode).toBe(0)
        Expect(await FS.isFile(FS.resolvePath('.zcompdump', cache))).toBe(true)
        Expect(await FS.listDir(FS.resolvePath(SHELL_SOURCE, fixture))).toEqual(['.zshrc'])
        Expect((await FS.readText(FS.resolvePath('startup-env.log', fixture))).trim().split('\n')).toEqual([
          cache,
          original,
        ])
        Expect((await FS.readText(FS.resolvePath('startup-result.log', fixture))).trim().split('\n')).toEqual([
          original,
          original,
          'yes',
        ])
        Expect(await FS.realPath(FS.resolvePath('.zshrc', cache))).toBe(
          FS.resolvePath(`${SHELL_SOURCE}/.zshrc`, fixture),
        )
      }
      await FS.remove(FS.resolvePath('.zshrc', original))
      const withoutPersonalStartup = await CLI.run('/bin/sh', {
        args: [FS.resolvePath('enter-tao-dev-env', fixture)],
        cwd: fixture,
        env: { ...env, ZDOTDIR: original, TAO_TEST_STARTUP_SCRIPT: startup },
      })
      Expect(withoutPersonalStartup.exitCode).toBe(0)
      Expect((await FS.readText(FS.resolvePath('startup-result.log', fixture))).trim().split('\n')).toEqual([
        original,
        '',
        'yes',
      ])
    } finally {
      await FS.remove(fixture)
    }
  })
})

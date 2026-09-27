import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir } from '@shared/test'
import { ShellStartupFileTest } from './fixtures/shell-startup-files'

const ENTRY = Repo.resolvePath('enter-tao-dev-env')
const SHELL_SOURCE = 'packages/cli/dev-cli/dev-cli-src/shell'

async function prepareFixture(fixture: string): Promise<Record<string, string | undefined>> {
  const zsh = await CLI.commandPath('zsh')
  Assert.defined(zsh, 'the managed toolchain supplies zsh')
  const bin = FS.resolvePath('bin', fixture)
  const stub = FS.resolvePath('devenv', bin)
  const shellHook = (await FS.readText(Repo.resolvePath('devenv.nix'))).match(/enterShell = ''([\s\S]*?)'';/)?.[1]
  Expect(shellHook).toBeDefined()
  await FS.copyFile(ENTRY, FS.resolvePath('enter-tao-dev-env', fixture))
  await FS.copyFile(Repo.resolvePath(`${SHELL_SOURCE}/.zshrc`), FS.resolvePath(`${SHELL_SOURCE}/.zshrc`, fixture))
  await FS.writeText(
    stub,
    `#!/bin/sh
printf 'devenv|%s|%s\\n' "$PWD" "$DEVENV_TUI" >> "$TAO_TEST_DEVENV_LOG"
[ "$1" = shell ] && [ "$2" = --no-tui ] || exit 90
shift 2
if [ "\${1:-}" = -- ]; then shift; fi
export TAO_TEST_PINNED_ENV=yes
export TAO_DEVENV=1
export DEVENV_ROOT="$PWD"
export SHELL=/bin/false
${shellHook}
exec "$@"
`,
  )
  await FS.chmod(stub, 0o755)
  await FS.writeText(
    FS.resolvePath('agent', fixture),
    `#!/bin/sh
printf 'setup|%s|%s\\n' "$TAO_TEST_PINNED_ENV" "$*" >> "$TAO_TEST_DEVENV_LOG"
if [ "$TAO_TEST_COLD_SETUP" = yes ]; then
  for bin in "$DEVENV_ROOT/node_modules/.bin" "$DEVENV_ROOT/packages/shared/node_modules/.bin"; do
    mkdir -p "$bin"
    printf '#!/bin/sh\\nexit 0\\n' > "$bin/fixture-tool"
    chmod +x "$bin/fixture-tool"
  done
fi
exit "\${TAO_TEST_SETUP_EXIT:-0}"
`,
  )
  await FS.chmod(FS.resolvePath('agent', fixture), 0o755)
  for (const shell of ['zsh', 'bash']) {
    await FS.writeText(
      FS.resolvePath(shell, bin),
      `#!/bin/sh
printf 'interactive|%s|%s\\n' "$TAO_TEST_PINNED_ENV" "$*" >> "$TAO_TEST_DEVENV_LOG"
printf '%s\\n%s\\n' "$ZDOTDIR" "$TAO_ORIGINAL_ZDOTDIR" > "$TAO_TEST_STARTUP_ENV"
if [ "$TAO_TEST_REENTER" = yes ]; then
  /bin/sh "$DEVENV_ROOT/enter-tao-dev-env" || exit "$?"
  printf 'resumed\\n' >> "$TAO_TEST_DEVENV_LOG"
fi
if [ "$TAO_TEST_COLD_SETUP" = yes ]; then
  cd "$DEVENV_ROOT/packages"
  printf '%s\\n' "$PATH" > "$DEVENV_ROOT/interactive-path.log"
  command -v fixture-tool > "$DEVENV_ROOT/installed-tool.log"
fi
if [ -n "$TAO_TEST_STARTUP_SCRIPT" ]; then
  exec "$TAO_TEST_ZSH" -f "$TAO_TEST_STARTUP_SCRIPT"
fi
exit "\${TAO_TEST_SHELL_EXIT:-0}"
`,
    )
    await FS.chmod(FS.resolvePath(shell, bin), 0o755)
  }
  return {
    ...Platform.runtimeProcess.env,
    PATH: `${bin}:/usr/bin:/bin`,
    SHELL: FS.resolvePath('zsh', bin),
    TAO_TEST_ZSH: zsh,
    ZDOTDIR: undefined,
    TAO_DEVENV: undefined,
    DEVENV_ROOT: undefined,
    TAO_TEST_DEVENV_LOG: FS.resolvePath('calls.log', fixture),
    TAO_TEST_STARTUP_ENV: FS.resolvePath('startup-env.log', fixture),
  }
}

Describe('interactive Tao development shell', () => {
  ShellStartupFileTest(
    'explicit setup-only refreshes the environment once without a shell even when already active',
    async () => {
      const root = await mkTestDir('tao-dev-shell-')
      try {
        for (const active of [false, true]) {
          for (const setupExit of ['0', '23']) {
            const fixture = FS.resolvePath(`${active}-${setupExit}`, root)
            const env = await prepareFixture(fixture)
            const result = await CLI.run('/bin/sh', {
              args: [FS.resolvePath('enter-tao-dev-env', fixture), '--setup-only'],
              cwd: fixture,
              env: {
                ...env,
                TAO_DEVENV: active ? '1' : undefined,
                DEVENV_ROOT: active ? fixture : undefined,
                TAO_TEST_SETUP_EXIT: setupExit,
              },
            })
            Expect(result.exitCode).toBe(Number(setupExit))
            Expect((await FS.readText(FS.resolvePath('calls.log', fixture))).trim().split('\n')).toEqual([
              `devenv|${fixture}|false`,
              'setup|yes|setup',
            ])
            Expect(await FS.exists(FS.resolvePath('startup-env.log', fixture))).toBe(false)
            Expect(await FS.exists(FS.resolvePath('.artifacts/cache/dev-shell', fixture))).toBe(false)
          }
        }
      } finally {
        await FS.remove(root)
      }
    },
  )

  ShellStartupFileTest('returns to the active shell without repeating setup or entering another shell', async () => {
    const fixture = await mkTestDir('tao-dev-shell-')
    try {
      const env = await prepareFixture(fixture)
      const result = await CLI.run('/bin/sh', {
        args: [FS.resolvePath('enter-tao-dev-env', fixture)],
        cwd: fixture,
        env: { ...env, TAO_TEST_REENTER: 'yes' },
      })
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('already active')
      Expect((await FS.readText(FS.resolvePath('calls.log', fixture))).trim().split('\n')).toEqual([
        `devenv|${fixture}|false`,
        'setup|yes|setup',
        'interactive|yes|-i',
        'resumed',
      ])
    } finally {
      await FS.remove(fixture)
    }
  })

  ShellStartupFileTest(
    'recognizes an existing environment through a checkout alias before requiring devenv',
    async () => {
      const root = await mkTestDir('tao-dev-shell-')
      const fixture = FS.resolvePath('checkout with spaces', root)
      const alias = FS.resolvePath('checkout alias', root)
      try {
        const env = await prepareFixture(fixture)
        await FS.symlink(fixture, alias)
        const result = await CLI.run('/bin/sh', {
          args: [FS.resolvePath('enter-tao-dev-env', alias)],
          cwd: root,
          env: { ...env, PATH: '/usr/bin:/bin', TAO_DEVENV: '1', DEVENV_ROOT: alias },
        })
        Expect(result.exitCode).toBe(0)
        Expect(result.stdout).toContain('already active')
        Expect(await FS.exists(FS.resolvePath('calls.log', fixture))).toBe(false)
        Expect(await FS.exists(FS.resolvePath('.artifacts/cache/dev-shell/zsh', fixture))).toBe(false)
      } finally {
        await FS.remove(root)
      }
    },
  )

  ShellStartupFileTest(
    'enters the checkout when environment markers are incomplete or belong to a different checkout',
    async () => {
      const root = await mkTestDir('tao-dev-shell-')
      try {
        for (
          const [index, markers] of ([
            { active: undefined, root: 'same' },
            { active: '0', root: 'same' },
            { active: '1', root: 'unset' },
            { active: '1', root: 'missing' },
            { active: '1', root: 'other' },
          ] as const).entries()
        ) {
          const fixture = FS.resolvePath(`checkout-${index}`, root)
          const env = await prepareFixture(fixture)
          const roots = { same: fixture, unset: undefined, missing: FS.resolvePath('missing', root), other: root }
          const result = await CLI.run('/bin/sh', {
            args: [FS.resolvePath('enter-tao-dev-env', fixture)],
            cwd: fixture,
            env: { ...env, TAO_DEVENV: markers.active, DEVENV_ROOT: roots[markers.root] },
          })
          Expect(result.exitCode).toBe(0)
          Expect((await FS.readText(FS.resolvePath('calls.log', fixture))).trim().split('\n')).toEqual([
            `devenv|${fixture}|false`,
            'setup|yes|setup',
            'interactive|yes|-i',
          ])
        }
      } finally {
        await FS.remove(root)
      }
    },
  )

  ShellStartupFileTest('finds freshly installed dependency tools from a subdirectory after first setup', async () => {
    const fixture = await mkTestDir('tao-dev-shell-')
    try {
      const env = await prepareFixture(fixture)
      Expect(await FS.exists(FS.resolvePath('node_modules', fixture))).toBe(false)
      const result = await CLI.run('/bin/sh', {
        args: [FS.resolvePath('enter-tao-dev-env', fixture)],
        cwd: fixture,
        env: { ...env, TAO_TEST_COLD_SETUP: 'yes' },
      })
      Expect(result.exitCode).toBe(0)
      const path = (await FS.readText(FS.resolvePath('interactive-path.log', fixture))).trim().split(':')
      Expect(path).toContain(FS.resolvePath('node_modules/.bin', fixture))
      Expect(path).toContain(FS.resolvePath('packages/shared/node_modules/.bin', fixture))
      Expect((await FS.readText(FS.resolvePath('installed-tool.log', fixture))).trim()).toBe(
        FS.resolvePath('packages/shared/node_modules/.bin/fixture-tool', fixture),
      )
    } finally {
      await FS.remove(fixture)
    }
  })

  ShellStartupFileTest('enters devenv once and completes setup before starting the interactive shell', async () => {
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
        `devenv|${fixture}|false`,
        'setup|yes|setup',
        'interactive|yes|-i',
      ])
      Expect((await FS.readText(FS.resolvePath('startup-env.log', fixture))).trim().split('\n')).toEqual([
        FS.resolvePath('.artifacts/cache/dev-shell/zsh', fixture),
        Platform.runtimeProcess.env['HOME'],
      ])
    } finally {
      await FS.remove(fixture)
    }
  })

  ShellStartupFileTest(
    'does not start an interactive shell when setup fails and preserves its exit status',
    async () => {
      const fixture = await mkTestDir('tao-dev-shell-')
      try {
        const env = await prepareFixture(fixture)
        const result = await CLI.run('/bin/sh', {
          args: [FS.resolvePath('enter-tao-dev-env', fixture)],
          cwd: fixture,
          env: { ...env, TAO_TEST_SETUP_EXIT: '23' },
        })
        Expect(result.exitCode).toBe(23)
        Expect((await FS.readText(FS.resolvePath('calls.log', fixture))).trim().split('\n')).toEqual([
          `devenv|${fixture}|false`,
          'setup|yes|setup',
        ])
        Expect(await FS.exists(FS.resolvePath('startup-env.log', fixture))).toBe(false)
      } finally {
        await FS.remove(fixture)
      }
    },
  )

  ShellStartupFileTest('honors a non-zsh shell in a checkout with spaces and returns its exit status', async () => {
    const root = await mkTestDir('tao-dev-shell-')
    const fixture = FS.resolvePath('checkout with spaces', root)
    try {
      const env = await prepareFixture(fixture)
      const result = await CLI.run('/bin/sh', {
        args: [FS.resolvePath('enter-tao-dev-env', fixture)],
        cwd: root,
        env: {
          ...env,
          SHELL: FS.resolvePath('bin/bash', fixture),
          TAO_TEST_SHELL_EXIT: '7',
          ZDOTDIR: FS.resolvePath('user-startup', fixture),
        },
      })
      Expect(result.exitCode).toBe(7)
      Expect((await FS.readText(FS.resolvePath('calls.log', fixture))).trim().split('\n')).toEqual([
        `devenv|${fixture}|false`,
        'setup|yes|setup',
        'interactive|yes|-i',
      ])
      Expect((await FS.readText(FS.resolvePath('startup-env.log', fixture))).split('\n')[0]).toBe(
        FS.resolvePath('user-startup', fixture),
      )
      Expect(await FS.exists(FS.resolvePath('.artifacts/cache/dev-shell/zsh', fixture))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  ShellStartupFileTest(
    'keeps early compinit dumps in the cache while preserving user startup and dev completion',
    async () => {
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
    },
  )
})

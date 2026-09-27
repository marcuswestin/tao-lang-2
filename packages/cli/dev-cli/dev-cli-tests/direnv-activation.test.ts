import { CLI, FS, Platform, Repo, Text } from '@shared'
import { Describe, Expect, initGitTestRepository, mkTestDir, Test } from '@shared/test'

const HOOK = Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/shell/direnv-activation.zsh')
const COMPLETION = `print -r -- "completion|$PWD|$TAO_TEST_ACTIVE" >> "$TAO_TEST_LOG"
export TAO_TEST_COMPLETED=yes
`
const POISON_DEV = `#!/bin/sh
printf 'unexpected-dev|%s\\n' "$PWD" >> "$TAO_TEST_LOG"
exit 99
`

// Exercise the sourceable hook with real Git identities; only direnv's export protocol is faked.
const DIRENV = `#!/bin/zsh -f
case "$1" in
  hook)
    cat <<'HOOK'
_direnv_hook() {
  local previous_exit_status=$?
  print -r -- "status|$previous_exit_status" >> "$TAO_TEST_LOG"
  eval "$("$HOME/.tao-dev/shell/direnv/bin/direnv" export zsh)"
  return "$previous_exit_status"
}
typeset -ga precmd_functions chpwd_functions
precmd_functions+=(_direnv_hook)
chpwd_functions+=(_direnv_hook)
HOOK
    ;;
  allow)
    print -r -- "allow|$2" >> "$TAO_TEST_LOG"
    key=$(print -r -- "$2" | git hash-object --stdin)
    git hash-object -- "$2" > "$HOME/allowed/$key"
    ;;
  export)
    print -r -- "export|$PWD" >> "$TAO_TEST_LOG"
    candidate=$PWD
    while [[ "$candidate" != / && ! -f "$candidate/.envrc" ]]; do candidate=\${candidate:h}; done
    key=$(print -r -- "$candidate/.envrc" | git hash-object --stdin)
    if [[ -f "$candidate/.envrc" && -f "$HOME/allowed/$key" && "$(git hash-object -- "$candidate/.envrc")" == "$(<"$HOME/allowed/$key")" ]]; then
      print -r -- "export DIRENV_DIR=\${(q):-"-$candidate"}"
      cat "$candidate/.envrc"
    else
      print -r -- 'unset DIRENV_DIR TAO_TEST_ACTIVE'
    fi
    ;;
esac
`

async function fixture(realDirenv = false) {
  // Git fixtures must live outside a worktree's protected .git boundary. Removed in finally.
  const base = await mkTestDir('tao-direnv-hook-', { location: 'host' })
  const root = FS.resolvePath("repo with ' quote", base)
  const home = FS.resolvePath('home', base)
  await initGitTestRepository(root, {
    commit: { files: { '.envrc': 'export TAO_TEST_ACTIVE=first\n', dev: POISON_DEV } },
  })
  await FS.chmod(FS.resolvePath('dev', root), 0o755)
  await FS.writeText(FS.resolvePath('.artifacts/cache/dev-shell/completion.zsh', root), COMPLETION)
  await FS.writeText(FS.resolvePath('.tao-dev/shell/completion.zsh', home), COMPLETION.replace('=yes', '=fallback'))
  await FS.mkdir(FS.resolvePath('allowed', home))
  const direnv = FS.resolvePath('.tao-dev/shell/direnv/bin/direnv', home)
  if (realDirenv) {
    await FS.symlink(await FS.realPath(Repo.resolvePath('.devenv/profile/bin/direnv')), direnv)
  } else {
    await FS.writeText(direnv, DIRENV)
    await FS.chmod(direnv, 0o755)
  }
  await FS.writeText(FS.resolvePath('.tao-dev/shell/envrc', home), 'export TAO_TEST_ACTIVE=generated\n')
  const common = await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const idResult = await CLI.run('git', { args: ['hash-object', '--stdin'], stdin: `${common}\n` })
  Expect(idResult.exitCode).toBe(0)
  const marker = FS.resolvePath(`.tao-dev/shell/repositories/${idResult.stdout.trim()}`, home)
  await FS.writeText(FS.resolvePath('common-dir', marker), `${common}\n`)
  await FS.writeText(FS.resolvePath('choice', marker), 'enabled\n')
  return { base, root, home, marker, common }
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await CLI.run('git', { args, cwd: root })
  Expect(result.exitCode).toBe(0)
  return result.stdout.trim()
}

async function runShell(
  test: Awaited<ReturnType<typeof fixture>>,
  script: string,
  interactive = true,
  expectedStderr = '',
) {
  const startup = FS.resolvePath('probe.zsh', test.base)
  await FS.writeText(startup, script)
  const result = await CLI.run('/bin/zsh', {
    args: ['-f', ...(interactive ? ['-i'] : []), startup],
    cwd: test.root,
    env: {
      ...Platform.runtimeProcess.env,
      HOME: test.home,
      ZDOTDIR: test.home,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      DIRENV_DIR: undefined,
      DIRENV_FILE: undefined,
      DIRENV_DIFF: undefined,
      DIRENV_WATCHES: undefined,
      DIRENV_CONFIG: FS.resolvePath('.tao-dev/test/config/direnv', test.home),
      DIRENV_LOG_FORMAT: '',
      XDG_CONFIG_HOME: FS.resolvePath('.tao-dev/test/config', test.home),
      XDG_DATA_HOME: FS.resolvePath('.tao-dev/test/data', test.home),
      XDG_CACHE_HOME: FS.resolvePath('.tao-dev/test/cache', test.home),
      XDG_STATE_HOME: FS.resolvePath('.tao-dev/test/state', test.home),
      TAO_TEST_HOOK: HOOK,
      TAO_TEST_ROOT: test.root,
      TAO_TEST_BASE: test.base,
      TAO_TEST_MARKER: test.marker,
      TAO_TEST_LOG: FS.resolvePath('calls.log', test.base),
    },
  })
  Expect(Text.stripAnsi(result.stderr)).toBe(expectedStderr)
  Expect(result.exitCode).toBe(0)
  Expect((await calls(test)).filter(line => line.startsWith('unexpected-dev|'))).toEqual([])
  return result.stdout.trim().split('\n')
}

async function calls(test: Awaited<ReturnType<typeof fixture>>) {
  const path = FS.resolvePath('calls.log', test.base)
  return await FS.exists(path) ? (await FS.readText(path)).trim().split('\n') : []
}

Describe('automatic development shell activation', () => {
  Test('creates the installed loader only for an opted-in old devenv checkout without a tracked envrc', async () => {
    const test = await fixture()
    try {
      await FS.writeText(FS.resolvePath('devenv.nix', test.root), '{}\n')
      await FS.writeText(FS.resolvePath('devenv.yaml', test.root), '{}\n')
      await FS.remove(FS.resolvePath('.envrc', test.root))
      await runShell(test, 'source "$TAO_TEST_HOOK"\n_tao_dev_direnv_hook')
      Expect(await FS.exists(FS.resolvePath('.envrc', test.root))).toBe(false)
      await git(test.root, ['rm', '--cached', '--', '.envrc'])
      Expect(
        await runShell(
          test,
          `
source "$TAO_TEST_HOOK"
print disabled > "$TAO_TEST_MARKER/choice"
_tao_dev_direnv_hook
[[ -e .envrc ]] && print premature
print enabled > "$TAO_TEST_MARKER/choice"
_tao_dev_direnv_hook
_tao_dev_direnv_hook
print -r -- "created|$TAO_TEST_ACTIVE"
`,
          true,
          `Development shell: created ${test.root}/.envrc\n`,
        ),
      ).toEqual(['created|generated'])
      Expect(await FS.readText(FS.resolvePath('.envrc', test.root))).toBe('export TAO_TEST_ACTIVE=generated\n')
      Expect((await calls(test)).filter(line => line.startsWith('allow|'))).toEqual([`allow|${test.root}/.envrc`])
    } finally {
      await FS.remove(test.base)
    }
  })

  Test('preserves existing files and dangling symlinks and skips checkouts without devenv', async () => {
    const test = await fixture()
    try {
      await FS.writeText(FS.resolvePath('devenv.nix', test.root), '{}\n')
      await FS.writeText(FS.resolvePath('devenv.yaml', test.root), '{}\n')
      await runShell(test, 'source "$TAO_TEST_HOOK"\n_tao_dev_direnv_hook')
      Expect(await FS.readText(FS.resolvePath('.envrc', test.root))).toBe('export TAO_TEST_ACTIVE=first\n')
      await git(test.root, ['rm', '--', '.envrc'])
      const missing = FS.resolvePath('missing-target', test.base)
      await FS.symlink(missing, FS.resolvePath('.envrc', test.root))
      Expect(await runShell(test, 'source "$TAO_TEST_HOOK"\n_tao_dev_direnv_hook\n[[ -L .envrc ]] && print symlink'))
        .toEqual(['symlink'])
      Expect(await FS.exists(missing)).toBe(false)
      await FS.remove(FS.resolvePath('.envrc', test.root))
      await FS.remove(FS.resolvePath('devenv.nix', test.root))
      await runShell(test, 'source "$TAO_TEST_HOOK"\n_tao_dev_direnv_hook')
      Expect(await FS.exists(FS.resolvePath('.envrc', test.root))).toBe(false)
    } finally {
      await FS.remove(test.base)
    }
  })

  Test('uses real direnv to authorize a root, preserve status, update exports, and unload', async () => {
    const test = await fixture(true)
    try {
      Expect(
        await runShell(
          test,
          `
source "$TAO_TEST_HOOK"
_tao_dev_preserve_status 9
_tao_dev_direnv_hook
print -r -- "real|$?|$TAO_TEST_ACTIVE|$TAO_TEST_COMPLETED"
print 'export TAO_TEST_ACTIVE=changed_with_real_direnv' > .envrc
_tao_dev_direnv_hook
print -r -- "changed|$TAO_TEST_ACTIVE"
cd "$TAO_TEST_BASE"
_tao_dev_direnv_hook
print -r -- "outside|$+TAO_TEST_ACTIVE"
`,
          true,
          [
            `direnv: loading ${test.root}/.envrc`,
            'direnv: export +TAO_TEST_ACTIVE',
            `direnv: loading ${test.root}/.envrc`,
            'direnv: export +TAO_TEST_ACTIVE',
            'direnv: unloading',
            '',
          ].join('\n'),
        ),
      ).toEqual(['real|9|first|yes', 'changed|changed_with_real_direnv', 'outside|0'])
      Expect((await calls(test)).filter(line => line.startsWith('completion|'))).toEqual([
        `completion|${test.root}|first`,
      ])
    } finally {
      await FS.remove(test.base)
    }
  })

  Test('allows current and future registered worktrees, loads completion after activation, and unloads', async () => {
    const test = await fixture()
    try {
      const lines = await runShell(
        test,
        `
eval "$("$HOME/.tao-dev/shell/direnv/bin/direnv" hook zsh)"
source "$TAO_TEST_HOOK"
source "$TAO_TEST_HOOK"
print -r -- "hooks|\${(j:,:)precmd_functions}|\${(j:,:)chpwd_functions}"
_tao_dev_preserve_status 7
_tao_dev_direnv_hook
print -r -- "active|$?|$TAO_TEST_ACTIVE|$TAO_TEST_COMPLETED"
_tao_dev_direnv_hook
git worktree add -q -b future "$TAO_TEST_BASE/future worktree"
chmod +x "$TAO_TEST_BASE/future worktree/dev"
cd "$TAO_TEST_BASE/future worktree"
_tao_dev_direnv_hook
print -r -- "future|$TAO_TEST_ACTIVE|$TAO_TEST_COMPLETED"
cd "$TAO_TEST_ROOT"
_tao_dev_direnv_hook
print -r -- "return|$TAO_TEST_ACTIVE|$TAO_TEST_COMPLETED"
cd "$TAO_TEST_BASE"
_tao_dev_direnv_hook
print -r -- "outside|\${TAO_TEST_ACTIVE-unset}"
cd "$TAO_TEST_ROOT"
_tao_dev_direnv_hook
print -r -- "back|$TAO_TEST_ACTIVE"
`,
      )
      Expect(lines).toEqual([
        'hooks|_tao_dev_direnv_hook|_tao_dev_direnv_hook',
        'active|7|first|yes',
        'future|first|fallback',
        'return|first|yes',
        'outside|unset',
        'back|first',
      ])
      const log = await calls(test)
      Expect(log.filter(line => line.startsWith('allow|'))).toEqual([
        `allow|${test.root}/.envrc`,
        `allow|${test.base}/future worktree/.envrc`,
      ])
      Expect(log.filter(line => line.startsWith('completion|'))).toEqual([
        `completion|${test.root}|first`,
        `completion|${test.base}/future worktree|first`,
        `completion|${test.root}|first`,
        `completion|${test.root}|first`,
      ])
      Expect(log.slice(0, 4)).toEqual([
        `allow|${test.root}/.envrc`,
        'status|7',
        `export|${test.root}`,
        `completion|${test.root}|first`,
      ])
    } finally {
      await FS.remove(test.base)
    }
  })

  Test('reallows changed root files without trusting nested envrc files', async () => {
    const test = await fixture()
    try {
      await FS.writeText(FS.resolvePath('nested/.envrc', test.root), 'export TAO_TEST_ACTIVE=unsafe\n')
      Expect(
        await runShell(
          test,
          `
source "$TAO_TEST_HOOK"
_tao_dev_direnv_hook
print 'export TAO_TEST_ACTIVE=changed' > "$TAO_TEST_ROOT/.envrc"
_tao_dev_direnv_hook
print -r -- "changed|$TAO_TEST_ACTIVE"
cd nested
_tao_dev_direnv_hook
print -r -- "nested|\${TAO_TEST_ACTIVE-unset}"
cd ..
_tao_dev_direnv_hook
print disabled > "$TAO_TEST_MARKER/choice"
print 'export TAO_TEST_ACTIVE=disabled_change' > "$TAO_TEST_ROOT/.envrc"
_tao_dev_direnv_hook
print -r -- "disabled|\${TAO_TEST_ACTIVE-unset}"
`,
        ),
      ).toEqual(['changed|changed', 'nested|unset', 'disabled|unset'])
      Expect((await calls(test)).filter(line => line.startsWith('allow|'))).toEqual([
        `allow|${test.root}/.envrc`,
        `allow|${test.root}/.envrc`,
      ])
    } finally {
      await FS.remove(test.base)
    }
  })

  Test('rejects unrelated repositories and unregistered roots pointing at the trusted common directory', async () => {
    const test = await fixture()
    try {
      const unrelated = FS.resolvePath('unrelated', test.base)
      await initGitTestRepository(unrelated, {
        commit: { files: { '.envrc': 'export TAO_TEST_ACTIVE=unsafe\n', dev: POISON_DEV } },
      })
      await FS.chmod(FS.resolvePath('dev', unrelated), 0o755)
      const fake = FS.resolvePath('fake', test.base)
      await FS.writeText(FS.resolvePath('.git', fake), `gitdir: ${test.common}\n`)
      await FS.writeText(FS.resolvePath('.envrc', fake), 'export TAO_TEST_ACTIVE=unsafe\n')
      await FS.writeText(FS.resolvePath('dev', fake), POISON_DEV)
      await FS.chmod(FS.resolvePath('dev', fake), 0o755)
      Expect(await git(fake, ['rev-parse', '--show-toplevel'])).toBe(fake)
      Expect(
        await runShell(
          test,
          `
source "$TAO_TEST_HOOK"
cd "$TAO_TEST_BASE/unrelated"
_tao_dev_direnv_hook
print -r -- "unrelated|\${TAO_TEST_ACTIVE-unset}"
cd "$TAO_TEST_BASE/fake"
_tao_dev_direnv_hook
print -r -- "fake|\${TAO_TEST_ACTIVE-unset}"
`,
        ),
      ).toEqual(['unrelated|unset', 'fake|unset'])
      Expect((await calls(test)).filter(line => line.startsWith('allow|') || line.startsWith('completion|'))).toEqual(
        [],
      )
    } finally {
      await FS.remove(test.base)
    }
  })

  Test('requires the enabled matching common directory marker and does nothing noninteractively', async () => {
    const test = await fixture()
    try {
      Expect(
        await runShell(test, 'source "$TAO_TEST_HOOK"\nprint -r -- "hook|$+functions[_tao_dev_direnv_hook]"', false),
      )
        .toEqual(['hook|0'])
      Expect(await calls(test)).toEqual([])
      Expect(
        await runShell(
          test,
          `
source "$TAO_TEST_HOOK"
print disabled > "$TAO_TEST_MARKER/choice"
_tao_dev_direnv_hook
print -r -- "disabled|\${TAO_TEST_ACTIVE-unset}"
print enabled > "$TAO_TEST_MARKER/choice"
print /different/repository > "$TAO_TEST_MARKER/common-dir"
_tao_dev_direnv_hook
print -r -- "mismatch|\${TAO_TEST_ACTIVE-unset}"
`,
        ),
      ).toEqual(['disabled|unset', 'mismatch|unset'])
      Expect((await calls(test)).filter(line => line.startsWith('allow|') || line.startsWith('completion|'))).toEqual(
        [],
      )
    } finally {
      await FS.remove(test.base)
    }
  })
})

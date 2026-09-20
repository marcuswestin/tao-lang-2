import { CLI, FS, Repo, Text } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const SHELL_HABITS = Repo.resolvePath('packages/dev/dev-src/cli/agent-shell-habits.zsh')
const SUBAGENT_BRIEF = Repo.resolvePath('packages/dev/dev-src/cli/agent-subagent-brief.zsh')
const GIT_HOOKS = Repo.resolvePath('packages/dev/dev-src/cli/agent-git-hooks.zsh')

/** The habits the shell hook reports, as the codes the fixture below prints for each. */
type Habit = 'PREFIX' | 'SEARCH' | 'PIPE'

/** Each case is one Bash command and every habit it should be warned about, in report order. */
const SHELL_CASES: ReadonlyArray<readonly [string, readonly Habit[]]> = [
  // Searching a tree.
  ['grep -r todo packages', ['SEARCH']],
  ['grep -rn todo packages', ['SEARCH']],
  ['grep -R todo packages', ['SEARCH']],
  ['grep --recursive todo packages', ['SEARCH']],
  ['find . -name "*.ts"', ['SEARCH']],
  ['find packages/dev -type f', ['SEARCH']],
  ['rg -n todo packages', []],
  ['grep -n todo one-file.ts', []],
  // `find` that removes what it finds is not a search.
  ['find .artifacts/tmp -name "*.log" -delete', []],
  // A prefix that leaves the allow rule.
  ['cd packages/dev && bun test', ['PREFIX']],
  ['export TAO_OUTPUT_MODE=lines', ['PREFIX']],
  ['TAO_OUTPUT_MODE=lines ./dev gates', ['PREFIX']],
  ['./agent test', []],
  // Judging a gate through a pipe.
  ['./agent verify | tail -20', ['PIPE']],
  ['just check 2>&1 | rg FAIL', ['PIPE']],
  ['./dev gates | head', ['PIPE']],
  ['bun test packages/dev | tail -5', ['PIPE']],
  ['bunx tsc --noEmit | rg error', ['PIPE']],
  // The same mistake inside a command substitution, with its assignment prefix.
  ['result=$(just --dry-run verify | rg parser)', ['PREFIX', 'PIPE']],
  // Piping something whose status nobody reads as a verdict.
  ['rg -n todo packages | head -5', []],
  ['git log --oneline | head -5', []],
  ['bun run packages/dev/dev-src/dev.ts | head', []],
  // Reading the real status back makes the pipe safe.
  ['set -o pipefail; ./agent verify | tail', []],
  ['./agent verify > out.txt 2>&1; echo "EXIT=$?"', []],
  // Quoted text is text, not a command.
  ['git commit -m "replace grep -r and stop doing just check | tail"', []],
  ['echo "cd elsewhere"', []],
]

/** Commit messages and how many warnings each should produce. */
const COMMIT_MESSAGE_CASES: ReadonlyArray<readonly [string, string, number]> = [
  ['an ordinary subject', 'Simplify the dispatch tables', 0],
  ['generated paths as subjects', 'Regenerate .codex/hooks.json and .claude/settings.json', 0],
  ['a human co-author', 'Fix it\n\nCo-Authored-By: Marcus Westin <marcus@example.com>', 0],
  ['a generator that is not an agent', 'Generated with the Langium parser generator', 0],
  ['an automated co-author trailer', 'Fix it\n\nCo-Authored-By: A Model <noreply@anthropic.com>', 1],
  ['a generated-with line', 'Fix it\n\nGenerated with Copilot', 1],
  ['the robot marker alone', 'Fix it 🤖', 1],
  ['an identity in the body', 'Fix it\n\nAsked chatgpt about the parser', 1],
  ['commented-out git help', 'Fix it\n# Co-Authored-By: A Model <noreply@anthropic.com>', 0],
]

Describe('agent hooks', () => {
  Test('reports the shell habits a command shows, and stays silent otherwise', async () => {
    const codes = await shellHabitCodes(SHELL_CASES.map(([command]) => command))

    Expect(codes).toEqual(SHELL_CASES.map(([command, habits]) => `${command}\t${habits.join(',')}`))
  })

  Test('carries a warning to the model without touching the permission decision', async () => {
    const warned = await runHook(SHELL_HABITS, preToolUsePayload('./agent verify | tail -20'))

    Expect(warned.exitCode).toBe(0)
    const output = JSON.parse(warned.stdout) as {
      hookSpecificOutput: { additionalContext: string; hookEventName: string; permissionDecision?: string }
    }
    Expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    // A `permissionDecision` of any value is a decision. Warning means deciding nothing.
    Expect(output.hookSpecificOutput.permissionDecision).toBeUndefined()
    Expect(output.hookSpecificOutput.additionalContext).toContain('exit status of its last stage')
  })

  Test('says nothing at all when the command shows no habit', async () => {
    const quiet = await runHook(SHELL_HABITS, preToolUsePayload('ls -la packages'))

    Expect(quiet.exitCode).toBe(0)
    Expect(quiet.stdout).toBe('')
    Expect(quiet.stderr).toBe('')
  })

  Test('never fails the tool call on a payload it cannot read', async () => {
    // A hook that exits non-zero on a shape it does not recognise turns every future harness
    // change into a hook error beside every Bash command.
    for (const payload of ['', 'not json', '{}', '{"tool_input":{}}', '{"tool_input":{"command":""}}']) {
      const result = await runHook(SHELL_HABITS, payload)

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toBe('')
    }
  })

  Test('gives every subagent the repository boilerplate its caller no longer pastes in', async () => {
    const result = await runHook(SUBAGENT_BRIEF, '{"hook_event_name":"SubagentStart","agent_type":"scout"}')

    Expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout) as {
      hookSpecificOutput: { additionalContext: string; hookEventName: string }
    }
    Expect(output.hookSpecificOutput.hookEventName).toBe('SubagentStart')
    const brief = output.hookSpecificOutput.additionalContext
    for (const rule of ['worktree root', '`rg`', 'stage, unstage', 'developer environment', 'no agent identity']) {
      Expect(brief).toContain(rule)
    }
  })

  Test('reports what a commit message will carry into history, without echoing it back', async () => {
    const root = await mkTestDir('tao-commit-msg-')
    try {
      const reported: string[] = []
      for (const [name, message] of COMMIT_MESSAGE_CASES) {
        const path = FS.resolvePath('message.txt', root)
        await FS.writeText(path, message)
        const result = await sourceGitHooks(`tao_commit_message_warnings "$2"\nprint -r -- "\${#reply}"`, [path])

        Expect(result.exitCode).toBe(0)
        reported.push(`${name}\t${result.stdout.trim()}`)
        // The rule is named; the offending line is not repeated anywhere in the warning.
        Expect(result.stdout).not.toContain('noreply@')
      }

      Expect(reported).toEqual(COMMIT_MESSAGE_CASES.map(([name, , expected]) => `${name}\t${expected}`))
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports a detached HEAD and a branch outside the two work prefixes', async () => {
    const root = await mkTestDir('tao-branch-warn-')
    try {
      const repository = await initRepository(root, 'repo')
      const warnings = async () => {
        const result = await sourceGitHooks('tao_branch_warnings "$2"\nprint -rl -- "${reply[@]}"', [repository])
        Expect(result.exitCode).toBe(0)
        return result.stdout.trim()
      }

      Expect(await warnings()).toContain('is not a `feat/<name>` or `dev/<name>` branch')
      await git(repository, ['switch', '--quiet', '-c', 'feat/hooks'])
      Expect(await warnings()).toBe('')
      await git(repository, ['switch', '--quiet', '-c', 'dev/spike'])
      Expect(await warnings()).toBe('')
      await git(repository, ['checkout', '--quiet', '--detach', 'HEAD'])
      Expect(await warnings()).toContain('detached HEAD')
    } finally {
      await FS.remove(root)
    }
  })

  Test('warns through a real commit without ever failing one', async () => {
    const root = await mkTestDir('tao-commit-warn-')
    try {
      const repository = await initRepository(root, 'repo')
      await addHookScript(repository)
      await installGitHooks(repository)

      const commit = await commitChange(
        repository,
        'two',
        'Change it\n\nCo-Authored-By: A Model <noreply@anthropic.com>',
      )

      // Both hooks speak, the commit lands, and `git commit` reports success.
      Expect(commit.exitCode).toBe(0)
      Expect(commit.stderr).toContain('is not a `feat/<name>` or `dev/<name>` branch')
      Expect(commit.stderr).toContain('automated attribution trailer')
      Expect((await git(repository, ['log', '-1', '--format=%s'])).stdout.trim()).toBe('Change it')
    } finally {
      await FS.remove(root)
    }
  })

  Test('stays silent in a worktree whose commit predates the hook script', async () => {
    // Fifteen or more worktrees share one hooks directory here, and most sit on older commits.
    // An entry script that assumed its own implementation existed would break every one of them.
    const root = await mkTestDir('tao-old-worktree-')
    try {
      const repository = await initRepository(root, 'repo')
      const before = (await git(repository, ['rev-parse', 'HEAD'])).stdout.trim()
      await addHookScript(repository)
      await installGitHooks(repository)

      const older = FS.resolvePath('older', root)
      await git(repository, ['worktree', 'add', '--quiet', '-b', 'feat/older', older, before])
      Expect(await FS.exists(FS.resolvePath('packages/dev/dev-src/cli/agent-git-hooks.zsh', older))).toBe(false)
      const commit = await commitChange(older, 'older', 'Change it 🤖')

      Expect(commit.exitCode).toBe(0)
      Expect(commit.stderr).toBe('')
    } finally {
      await FS.remove(root)
    }
  })

  Test('leaves the squash commit a landing builds alone', async () => {
    // `merge-with-main` lands through `git commit-tree`, which is plumbing and runs no hook. A
    // hook that fired there would sit between a verified branch and `main`.
    const root = await mkTestDir('tao-plumbing-')
    try {
      const repository = await initRepository(root, 'repo')
      await addHookScript(repository)
      await installGitHooks(repository)
      await FS.writeText(FS.resolvePath('f.txt', repository), 'two')
      await git(repository, ['add', '-A'])
      const tree = (await git(repository, ['write-tree'])).stdout.trim()
      const parent = (await git(repository, ['rev-parse', 'HEAD'])).stdout.trim()

      const built = await git(repository, [
        '-c',
        'user.email=t@t',
        '-c',
        'user.name=T',
        'commit-tree',
        tree,
        '-p',
        parent,
        '-m',
        'Landing 🤖 on main',
      ])

      Expect(built.exitCode).toBe(0)
      Expect(built.stderr).toBe('')
    } finally {
      await FS.remove(root)
    }
  })

  Test('installs into the directory every worktree shares, and leaves a foreign hook there', async () => {
    const root = await mkTestDir('tao-hook-install-')
    try {
      const repository = await initRepository(root, 'repo')
      const hooksDir = FS.resolvePath('.git/hooks', repository)

      Expect((await installGitHooks(repository)).stdout.trim().split('\n'))
        .toEqual(['Installed commit-msg.', 'Installed pre-commit.'])
      // Re-running setup rewrites its own entry scripts rather than refusing or duplicating them.
      Expect((await installGitHooks(repository)).stdout.trim().split('\n'))
        .toEqual(['Installed commit-msg.', 'Installed pre-commit.'])
      const entry = await FS.readText(FS.resolvePath('commit-msg', hooksDir))
      Expect(entry).toContain('git rev-parse --show-toplevel')
      Expect(entry).toContain('packages/dev/dev-src/cli/agent-git-hooks.zsh')
      Expect(entry.trimEnd().endsWith('exit 0')).toBe(true)

      await FS.writeText(FS.resolvePath('pre-commit', hooksDir), '#!/bin/sh\nexit 0\n')
      Expect((await installGitHooks(repository)).stdout.trim().split('\n'))
        .toEqual(['Installed commit-msg.', 'Left pre-commit in place: it was not written by this repository.'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('names a hook script that exists for every command the hook source declares', async () => {
    const hooks = JSON.parse(
      Text.stripJsonc(await FS.readText(Repo.resolvePath('.rulesync/hooks.jsonc'))),
    ) as { hooks: Record<string, Array<{ command: string; matcher?: string }>> }
    const commands = Object.values(hooks.hooks).flat()

    for (const entry of commands) {
      const script = entry.command.match(/packages\/dev\/dev-src\/cli\/[\w-]+\.zsh/)?.[0]
      Expect(script).toBeDefined()
      Expect(await FS.exists(Repo.resolvePath(script!))).toBe(true)
    }
    // The warning hooks must keep their stdout: it is the only channel that reaches the model.
    const warning = commands.filter(entry =>
      entry.command.includes('agent-shell-habits') || entry.command.includes('agent-subagent-brief')
    )
    Expect(warning.length).toBe(2)
    for (const entry of warning) {
      // Only stderr is discarded. Sending stdout to /dev/null, as the logging hooks do, would
      // silence the warning without silencing the hook.
      Expect(entry.command).toContain('2>/dev/null')
      Expect(entry.command).not.toContain('> /dev/null')
      Expect(entry.command.endsWith('|| true')).toBe(true)
    }
    Expect(hooks.hooks['preToolUse']?.some(entry => entry.matcher === 'Bash')).toBe(true)
  })
})

/** shellHabitCodes runs every case in one shell, so the table costs one process rather than one each. */
async function shellHabitCodes(commands: readonly string[]): Promise<string[]> {
  const script = [
    'source "$1"',
    'for command in "${@:2}"; do',
    '  tao_shell_habit_warnings "$command"',
    '  codes=()',
    '  for warning in "${reply[@]}"; do',
    // Quoted comparisons, not `case` patterns: the warning texts hold `*`, `[`, and backticks.
    '    if [[ "$warning" == "$TAO_PREFIX_WARNING" ]]; then codes+=(PREFIX)',
    '    elif [[ "$warning" == "$TAO_SEARCH_WARNING" ]]; then codes+=(SEARCH)',
    '    elif [[ "$warning" == "$TAO_PIPE_WARNING" ]]; then codes+=(PIPE)',
    '    else codes+=(UNKNOWN)',
    '    fi',
    '  done',
    '  printf "%s\\t%s\\n" "$command" "${(j:,:)codes}"',
    'done',
  ].join('\n')
  const result = await CLI.run('zsh', { args: ['-c', script, 'habits', SHELL_HABITS, ...commands] })

  Expect(result.stderr).toBe('')
  Expect(result.exitCode).toBe(0)
  // Not `trimEnd`: a case with no warnings ends its line in the separator, which trimming eats.
  return result.stdout.split('\n').slice(0, -1)
}

/** runHook feeds a harness payload to a hook script the way a harness does. */
async function runHook(script: string, payload: string): Promise<CLI.CommandResult> {
  return await CLI.run(script, { stdin: payload })
}

function preToolUsePayload(command: string): string {
  return JSON.stringify({
    cwd: Repo.getRoot(),
    hook_event_name: 'PreToolUse',
    session_id: 'test',
    tool_input: { command, description: 'a description' },
    tool_name: 'Bash',
  })
}

/** sourceGitHooks calls one of the hook script's functions, which is where its logic lives. */
async function sourceGitHooks(script: string, args: readonly string[]): Promise<CLI.CommandResult> {
  return await CLI.run('zsh', { args: ['-c', `source "$1"\n${script}`, 'git-hooks', GIT_HOOKS, ...args] })
}

async function initRepository(root: string, name: string): Promise<string> {
  const repository = FS.resolvePath(name, root)
  await FS.writeText(FS.resolvePath('f.txt', repository), 'one')
  await git(repository, ['init', '--quiet', '--initial-branch', 'main'])
  await git(repository, ['add', '-A'])
  await commitStaged(repository, 'initial')
  return repository
}

/** addHookScript commits the implementation the installed entry scripts look for. */
async function addHookScript(repository: string): Promise<void> {
  const path = FS.resolvePath('packages/dev/dev-src/cli/agent-git-hooks.zsh', repository)
  await FS.writeText(path, await FS.readText(GIT_HOOKS))
  await FS.chmod(path, 0o755)
  await git(repository, ['add', '-A'])
  await commitStaged(repository, 'add the hook script')
}

async function commitStaged(repository: string, message: string): Promise<void> {
  const result = await git(repository, [
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=T',
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    message,
  ])
  Expect(result.exitCode).toBe(0)
}

async function installGitHooks(worktree: string): Promise<CLI.CommandResult> {
  const result = await CLI.run(GIT_HOOKS, { args: ['install'], cwd: worktree })
  Expect(result.exitCode).toBe(0)
  return result
}

async function commitChange(worktree: string, content: string, message: string): Promise<CLI.CommandResult> {
  await FS.writeText(FS.resolvePath('f.txt', worktree), content)
  await git(worktree, ['add', '-A'])
  return await CLI.run('git', {
    args: ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '--quiet', '-m', message],
    cwd: worktree,
  })
}

async function git(cwd: string, args: readonly string[]): Promise<CLI.CommandResult> {
  return await CLI.run('git', { args: [...args], cwd })
}

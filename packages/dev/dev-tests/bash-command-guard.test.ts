import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { bashGuardDenial, guardResponse, splitStages } from '../dev-src/cli/BashCommandGuard'

const GUARD_SCRIPT = 'packages/dev/dev-src/cli/agent-bash-guard.zsh'

function denialFor(command: string): string {
  return bashGuardDenial(command) ?? ''
}

function isAllowed(command: string): boolean {
  return bashGuardDenial(command) === undefined
}

Describe('bash command guard', () => {
  Test('splits a pipeline without splitting the arguments inside it', () => {
    const stages = splitStages(`rg -n 'a;b|c' packages && git status`)

    Expect(stages.map(stage => stage.words)).toEqual([
      ['rg', '-n', 'a;b|c', 'packages'],
      ['git', 'status'],
    ])
    Expect(stages.every(stage => stage.reachesContext)).toEqual(true)
  })

  Test('knows which stage of a pipeline is the one the model would read', () => {
    const stages = splitStages('cat notes.md | rg todo')

    Expect(stages.map(stage => stage.reachesContext)).toEqual([false, true])
  })

  Test('treats a redirected stage as one whose output never reaches the model', () => {
    Expect(splitStages('git diff > "$TMPDIR/x.diff"')[0]?.reachesContext).toEqual(false)
  })

  Test('stops reading at a heredoc, because the document is data and not commands', () => {
    const stages = splitStages("python3 - <<'EOF'\ncat /etc/passwd; git show\nEOF")

    Expect(stages.map(stage => stage.words)).toEqual([['python3', '-']])
    Expect(stages[0]?.heredoc).toEqual(true)
  })

  Test('refuses a prefix that takes the command out of its permission allow rule', () => {
    Expect(denialFor('cd packages/dev && bun test').includes('worktree root')).toEqual(true)
    Expect(denialFor('R=/tmp/x; rg -n foo "$R"').includes('worktree root')).toEqual(true)
    Expect(denialFor('export FOO=1 && ./agent verify').includes('worktree root')).toEqual(true)
  })

  Test('leaves the directory change an agent has to make inside a subshell', () => {
    Expect(isAllowed(`sh -c 'cd ../other-worktree && git status'`)).toEqual(true)
    Expect(isAllowed('git -C ../other-worktree status')).toEqual(true)
  })

  Test('sends a shell file read to the tool that takes a range', () => {
    Expect(denialFor('sed -n "1,120p" packages/dev/dev-src/dev.ts').includes('Read tool')).toEqual(true)
    Expect(denialFor('cat -n AGENTS.md').includes('Read tool')).toEqual(true)
  })

  Test('sends an in-place substitution to the tool that shows Ro a diff', () => {
    Expect(denialFor('sed -i "" s/a/b/ AGENTS.md').includes('Edit tool')).toEqual(true)
  })

  Test('leaves a shell read whose output the model never sees', () => {
    Expect(isAllowed('cat notes.md | rg -n todo')).toEqual(true)
    Expect(isAllowed('cat packages/dev/package.json > "$TMPDIR/pkg.json"')).toEqual(true)
    Expect(isAllowed("cat <<'EOF' > $TMPDIR/note.txt\nhello\nEOF")).toEqual(true)
    Expect(isAllowed('rg -n "cat" packages')).toEqual(true)
  })

  Test('refuses a Git command that would print a whole patch into context', () => {
    Expect(denialFor('git show 7b7dc0bc').includes('whole patch')).toEqual(true)
    Expect(denialFor('git diff --cached').includes('whole patch')).toEqual(true)
    Expect(denialFor('git log -p -3').includes('whole patch')).toEqual(true)
  })

  Test('leaves a Git command that asks for the shape, a file, or a filter', () => {
    Expect(isAllowed('git show --stat 7b7dc0bc')).toEqual(true)
    Expect(isAllowed('git diff --name-only main')).toEqual(true)
    Expect(isAllowed('git log --oneline -10')).toEqual(true)
    Expect(isAllowed('git diff > "$TMPDIR/branch.diff"')).toEqual(true)
    Expect(isAllowed('git show 7b7dc0bc | rg -n AGENTS')).toEqual(true)
    Expect(isAllowed('git status --short')).toEqual(true)
  })

  Test('answers a Bash call the harness asked about with the documented decision shape', () => {
    const response = guardResponse(JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_input: { command: 'cd packages && ls' },
      tool_name: 'Bash',
    }))

    Expect(JSON.parse(response)).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
    })
  })

  Test('stays silent for a payload it does not recognise, rather than refusing work no rule covers', () => {
    Expect(guardResponse('not json at all')).toEqual('')
    Expect(guardResponse(JSON.stringify({ tool_input: { file_path: 'x' }, tool_name: 'Read' }))).toEqual('')
    Expect(guardResponse(JSON.stringify({ tool_input: {}, tool_name: 'Bash' }))).toEqual('')
    Expect(guardResponse(JSON.stringify({ tool_input: { command: 'ls' }, tool_name: 'Bash' }))).toEqual('')
  })

  Test('runs as the hook does, from the script the generated settings name', async () => {
    const run = async (payload: string): Promise<{ exitCode: number; stdout: string }> => {
      const hook = Bun.spawn(['zsh', `${Repo.getRoot()}/${GUARD_SCRIPT}`], {
        stderr: 'pipe',
        stdin: new TextEncoder().encode(payload),
        stdout: 'pipe',
      })
      const stdout = await new Response(hook.stdout).text()
      return { exitCode: await hook.exited, stdout }
    }

    const denied = await run(JSON.stringify({ tool_input: { command: 'git show HEAD' }, tool_name: 'Bash' }))
    Expect(denied.exitCode).toEqual(0)
    Expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toEqual('deny')

    const allowed = await run(JSON.stringify({ tool_input: { command: 'git status --short' }, tool_name: 'Bash' }))
    Expect(allowed.exitCode).toEqual(0)
    Expect(allowed.stdout.trim()).toEqual('')

    const unreadable = await run('')
    Expect(unreadable.exitCode).toEqual(0)
    Expect(unreadable.stdout.trim()).toEqual('')
  })
})

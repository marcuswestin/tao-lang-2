import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { outputDisciplineRefusal, splitStages } from '../dev-src/agent-hooks/OutputDiscipline'
import { outputDisciplineDecision } from '../dev-src/agent-hooks/OutputDisciplineEntry'

const HOOK_SCRIPT = 'packages/dev/dev-src/cli/agent-output-discipline.zsh'

function refusalFor(command: string): string {
  return outputDisciplineRefusal(command) ?? ''
}

function isAllowed(command: string): boolean {
  return outputDisciplineRefusal(command) === undefined
}

Describe('output discipline', () => {
  Test('splits a pipeline without splitting the arguments inside it', () => {
    const stages = splitStages(`rg -n 'a;b|c' packages && git status`)

    Expect(stages.map(stage => stage.words)).toEqual([
      ['rg', '-n', 'a;b|c', 'packages'],
      ['git', 'status'],
    ])
    Expect(stages.every(stage => stage.reachesContext)).toEqual(true)
  })

  Test('knows which stage of a pipeline is the one the model would read', () => {
    Expect(splitStages('cat notes.md | rg todo').map(stage => stage.reachesContext)).toEqual([false, true])
  })

  Test('treats a redirected stage as one whose output never reaches the model', () => {
    Expect(splitStages('git diff > "$TMPDIR/x.diff"')[0]?.reachesContext).toEqual(false)
  })

  Test('stops reading at a heredoc, because the document is data and not commands', () => {
    const stages = splitStages("python3 - <<'EOF'\ncat /etc/passwd; git show\nEOF")

    Expect(stages.map(stage => stage.words)).toEqual([['python3', '-']])
    Expect(stages[0]?.heredoc).toEqual(true)
  })

  Test('sends a shell file read to the tool that takes a range', () => {
    Expect(refusalFor('sed -n "1,120p" packages/dev/dev-src/dev.ts').includes('Read tool')).toEqual(true)
    Expect(refusalFor('cat -n AGENTS.md').includes('Read tool')).toEqual(true)
  })

  Test('sends an in-place substitution to the tool that shows Ro a diff', () => {
    Expect(refusalFor('sed -i "" s/a/b/ AGENTS.md').includes('Edit tool')).toEqual(true)
  })

  Test('leaves a shell read whose output the model never sees', () => {
    Expect(isAllowed('cat notes.md | rg -n todo')).toEqual(true)
    Expect(isAllowed('cat packages/dev/package.json > "$TMPDIR/pkg.json"')).toEqual(true)
    Expect(isAllowed("cat <<'EOF' > $TMPDIR/note.txt\nhello\nEOF")).toEqual(true)
    Expect(isAllowed('rg -n "cat" packages')).toEqual(true)
  })

  Test('refuses a Git command that would print a whole patch into context', () => {
    Expect(refusalFor('git show 7b7dc0bc').includes('whole patch')).toEqual(true)
    Expect(refusalFor('git diff --cached').includes('whole patch')).toEqual(true)
    Expect(refusalFor('git log -p -3').includes('whole patch')).toEqual(true)
  })

  Test('leaves a Git command that asks for the shape, a file, or a filter', () => {
    Expect(isAllowed('git show --stat 7b7dc0bc')).toEqual(true)
    Expect(isAllowed('git diff --name-only main')).toEqual(true)
    Expect(isAllowed('git log --oneline -10')).toEqual(true)
    Expect(isAllowed('git diff > "$TMPDIR/branch.diff"')).toEqual(true)
    Expect(isAllowed('git show 7b7dc0bc | rg -n AGENTS')).toEqual(true)
    Expect(isAllowed('git status --short')).toEqual(true)
  })

  Test('leaves the habits ShellHabits owns to ShellHabits, which warns instead', () => {
    Expect(isAllowed('cd packages/dev && bun test')).toEqual(true)
    Expect(isAllowed('R=/tmp/x; rg -n foo "$R"')).toEqual(true)
    Expect(isAllowed('grep -r foo .')).toEqual(true)
  })

  Test('answers a Bash call the harness asked about with the documented decision shape', () => {
    const decision = outputDisciplineDecision(JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_input: { command: 'git show HEAD' },
      tool_name: 'Bash',
    }))

    Expect(JSON.parse(decision)).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
    })
  })

  Test('stays silent for a payload it cannot read, rather than refusing work no rule covers', () => {
    Expect(outputDisciplineDecision('not json at all')).toEqual('')
    Expect(outputDisciplineDecision(JSON.stringify({ tool_input: {} }))).toEqual('')
    Expect(outputDisciplineDecision(JSON.stringify({ tool_input: { command: 'ls' } }))).toEqual('')
  })

  Test('runs as the hook does, from the script the generated settings name', async () => {
    const run = async (payload: string): Promise<{ exitCode: number; stdout: string }> => {
      const hook = Bun.spawn(['zsh', `${Repo.getRoot()}/${HOOK_SCRIPT}`], {
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

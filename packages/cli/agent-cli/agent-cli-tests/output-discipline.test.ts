import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { OVERRIDE_LOG } from '../agent-cli-src/agent-hooks/HookOverrides'
import { hookOverrideReason, outputDisciplineRefusal, splitStages } from '../agent-cli-src/agent-hooks/OutputDiscipline'
import { outputDisciplineDecision } from '../agent-cli-src/agent-hooks/OutputDisciplineEntry'

const HOOK_SCRIPT = 'packages/cli/agent-cli/agent-cli-src/cli/agent-output-discipline.zsh'

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
    Expect(splitStages('cat notes.md | rg todo').map(stage => stage.feedsPipe)).toEqual([true, false])
  })

  Test('treats a redirected stage as one whose output never reaches the model', () => {
    Expect(splitStages('git diff > "$TMPDIR/x.diff"')[0]?.reachesContext).toEqual(false)
  })

  Test('records where a stage redirects, and does not mistake a descriptor for a file', () => {
    Expect(splitStages('./agent verify > out.txt 2>&1')[0]?.redirectTargets).toEqual(['out.txt'])
    Expect(splitStages('echo hi >> packages/x.ts')[0]?.redirectTargets).toEqual(['packages/x.ts'])
  })

  Test('stops reading at a heredoc, because the document is data and not commands', () => {
    const stages = splitStages("python3 - <<'EOF'\ncat /etc/passwd; git show\nEOF")

    Expect(stages.map(stage => stage.words)).toEqual([['python3', '-']])
    Expect(stages[0]?.heredoc).toEqual(true)
  })

  Test('sends a shell file read to the tool that takes a range', () => {
    Expect(refusalFor('sed -n "1,120p" packages/cli/dev-cli/dev-cli-src/dev.ts').includes('Read tool')).toEqual(true)
    Expect(refusalFor('cat -n AGENTS.md').includes('Read tool')).toEqual(true)
  })

  Test('sends an in-place substitution to the tool that shows Ro a diff', () => {
    Expect(refusalFor('sed -i "" s/a/b/ AGENTS.md').includes('Edit tool')).toEqual(true)
  })

  Test('leaves a shell read whose output the model never sees', () => {
    Expect(isAllowed('cat notes.md | rg -n todo')).toEqual(true)
    Expect(isAllowed('cat packages/cli/dev-cli/package.json > "$TMPDIR/pkg.json"')).toEqual(true)
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

  Test("refuses ripgrep's replace flag, which a grep habit spells by accident", () => {
    // `rg -rn match file` prints `beta n` and exits 0: the match replaced, no line numbers, no error.
    Expect(refusalFor('rg -rn match packages').includes('--replace')).toEqual(true)
    Expect(refusalFor('rg -r n match packages').includes('--replace')).toEqual(true)
    Expect(refusalFor('rg -L todo packages').includes('--files-without-match')).toEqual(true)
  })

  Test('leaves the ripgrep flags that mean what they say', () => {
    Expect(isAllowed('rg -n todo packages')).toEqual(true)
    Expect(isAllowed('rg -l todo packages')).toEqual(true)
    Expect(isAllowed("rg --replace '$1' 'x(y)' packages")).toEqual(true)
    Expect(isAllowed('rg --files-without-match todo packages')).toEqual(true)
    Expect(isAllowed('rg --follow todo packages')).toEqual(true)
  })

  Test('refuses a recursive search over a tree that is mostly not this repository', () => {
    Expect(refusalFor('grep -r todo .').includes('120,000')).toEqual(true)
    Expect(refusalFor('grep -rn todo packages').includes('120,000')).toEqual(true)
    Expect(refusalFor('grep -R todo .').includes('120,000')).toEqual(true)
    Expect(refusalFor('grep --recursive todo .').includes('120,000')).toEqual(true)
    Expect(refusalFor('find . -name "*.ts"').includes('120,000')).toEqual(true)
  })

  Test('leaves a search that is bounded, scratch-rooted, or not a tree walk at all', () => {
    Expect(isAllowed('find . -maxdepth 1 -name "*.json"')).toEqual(true)
    Expect(isAllowed('find .artifacts/tmp -name "*.log" -delete')).toEqual(true)
    Expect(isAllowed('find "$TMPDIR" -name "*.log"')).toEqual(true)
    Expect(isAllowed('grep -n todo one-file.ts')).toEqual(true)
  })

  Test('refuses a gate whose verdict a filter would replace with its own', () => {
    Expect(refusalFor('./agent verify | tail -20').includes('EXIT=$?')).toEqual(true)
    Expect(refusalFor('just check 2>&1 | rg FAIL').includes('EXIT=$?')).toEqual(true)
    Expect(refusalFor('./agent test-file packages/cli/dev-cli | head').includes('EXIT=$?')).toEqual(true)
    Expect(refusalFor('bunx tsc --noEmit | rg error').includes('EXIT=$?')).toEqual(true)
  })

  Test('leaves a pipe over a command whose output is the product rather than a verdict', () => {
    // `./agent help` lists both families; only the gates have a verdict worth preserving.
    Expect(isAllowed('./agent board | rg hungry')).toEqual(true)
    Expect(isAllowed('./agent report-test-stats | rg flake')).toEqual(true)
    Expect(isAllowed('./agent doctor --json | jq .')).toEqual(true)
    Expect(isAllowed('set -o pipefail; ./agent verify | tail')).toEqual(true)
    Expect(isAllowed('./agent verify > out.txt 2>&1; echo "EXIT=$?"')).toEqual(true)
  })

  Test('routes the two Bun commands this repository owns through `./agent`', () => {
    Expect(refusalFor('bun test packages/parser').includes('test-file')).toEqual(true)
    Expect(refusalFor('bun install').includes('setup')).toEqual(true)
    Expect(isAllowed('bun test --cwd ../other packages/parser')).toEqual(true)
    Expect(isAllowed('./agent test-file packages/parser/parser-tests/Parser.test.ts')).toEqual(true)
    Expect(isAllowed('bun run packages/cli/dev-cli/dev-cli-src/dev.ts')).toEqual(true)
  })

  Test('refuses the index operations that would carry away work this agent did not make', () => {
    Expect(refusalFor('git add .').includes('exact reviewed paths')).toEqual(true)
    Expect(refusalFor('git add -A').includes('exact reviewed paths')).toEqual(true)
    Expect(refusalFor('git add -u').includes('exact reviewed paths')).toEqual(true)
    Expect(refusalFor('git add packages/').includes('exact reviewed paths')).toEqual(true)
    Expect(refusalFor('git stash').includes('shared with every other worktree')).toEqual(true)
    Expect(refusalFor('git stash pop').includes('shared with every other worktree')).toEqual(true)
    Expect(refusalFor('git stash push -u').includes('shared with every other worktree')).toEqual(true)
  })

  Test('leaves the index operations that name what they touch', () => {
    Expect(isAllowed('git add -- packages/cli/agent-cli/agent-cli-src/agent-hooks/OutputDiscipline.ts')).toEqual(true)
    Expect(isAllowed('git stash push -u -m "hooks-wip"')).toEqual(true)
    Expect(isAllowed('git stash apply 7b7dc0bc')).toEqual(true)
    Expect(isAllowed('git stash list --format="%H %gs"')).toEqual(true)
  })

  Test('refuses a shell redirect that writes content belonging in the diff Ro reads', () => {
    Expect(refusalFor("cat > packages/stdlib/@tao/text/Text.tao <<'EOF'\nx\nEOF").includes('Write or Edit'))
      .toEqual(true)
    Expect(refusalFor('echo "x" > Docs/Spec/Units.md').includes('Write or Edit')).toEqual(true)
    Expect(refusalFor('echo "x" >> Apps/WordFlower/README.md').includes('Write or Edit')).toEqual(true)
  })

  Test('leaves a redirect to scratch, and a heredoc that feeds a command rather than a file', () => {
    Expect(isAllowed("cat > $TMPDIR/probe.test.ts <<'EOF'\nx\nEOF")).toEqual(true)
    Expect(isAllowed('echo "x" > .artifacts/tmp/note.txt')).toEqual(true)
    Expect(isAllowed("git commit -F- <<'EOF'\nSubject\nEOF")).toEqual(true)
    Expect(isAllowed("jq . <<'EOF'\n{}\nEOF")).toEqual(true)
  })

  Test('reads the justification an agent attaches to work a rule wrongly catches', () => {
    Expect(hookOverrideReason('grep -r x . # hook-ok: the ignored trees are the subject here'))
      .toEqual('the ignored trees are the subject here')
    Expect(hookOverrideReason('grep -r x .')).toBeUndefined()
    Expect(hookOverrideReason('grep -r x . # hook-ok:')).toBeUndefined()
    Expect(isAllowed('git add -A # hook-ok: single-agent worktree, everything here is mine')).toEqual(true)
  })

  Test('answers a Bash call the harness asked about with the documented decision shape', async () => {
    const decision = await outputDisciplineDecision(JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_input: { command: 'git show HEAD' },
      tool_name: 'Bash',
    }))

    Expect(JSON.parse(decision)).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
    })
  })

  Test('lets an override through and writes down why, so a misfiring rule can be found later', async () => {
    const root = await mkTestDir('tao-hook-override-')
    try {
      const decision = await outputDisciplineDecision(JSON.stringify({
        cwd: root,
        tool_input: { command: 'grep -r todo . # hook-ok: auditing the generated tree on purpose' },
        tool_name: 'Bash',
      }))

      Expect(decision).toEqual('')
      const logged = JSON.parse((await FS.readText(FS.resolvePath(OVERRIDE_LOG, root))).trim()) as {
        command: string
        reason: string
        refusal: string
      }
      Expect(logged.reason).toEqual('auditing the generated tree on purpose')
      Expect(logged.refusal).toContain('120,000')
      Expect(logged.command).toContain('grep -r todo')
    } finally {
      await FS.remove(root)
    }
  })

  Test('never fails a call because it could not write its own log', async () => {
    const decision = await outputDisciplineDecision(JSON.stringify({
      cwd: '/proc/nonexistent-directory',
      tool_input: { command: 'git add -A # hook-ok: reviewed every path already' },
      tool_name: 'Bash',
    }))

    Expect(decision).toEqual('')
  })

  Test('stays silent for a payload it cannot read, rather than refusing work no rule covers', async () => {
    Expect(await outputDisciplineDecision('not json at all')).toEqual('')
    Expect(await outputDisciplineDecision(JSON.stringify({ tool_input: {} }))).toEqual('')
    Expect(await outputDisciplineDecision(JSON.stringify({ tool_input: { command: 'ls' } }))).toEqual('')
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

import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  agentChildEnv,
  AgentCliGenerationProvider,
  type AgentCliRunResult,
  type AgentCliRunSpec,
  sharedAgentCliRunner,
} from '../generation-src/agent-cli-provider'
import type { GenerationJsonSchema, JsonObject } from '../generation-src/generation'

const schema: GenerationJsonSchema = {
  type: 'object',
  properties: {
    Title: { type: 'string' },
    Servings: { type: 'number' },
  },
  required: ['Title', 'Servings'],
  additionalProperties: false,
}

type RecordedRun = { command: string; spec: AgentCliRunSpec }

function ok(stdout: string): AgentCliRunResult {
  return { exitCode: 0, stderr: '', stdout, timedOut: false }
}

Describe('agent CLI generation provider', () => {
  Test('drives Claude Code in print mode with a JSON schema and reads its structured output', async () => {
    const root = await mkTestDir('tao-agent-provider-')
    const shot = FS.resolvePath('pictures/shot.png', root)
    const other = FS.resolvePath('pictures/other.png', root)
    await FS.writeText(shot, 'shot')
    await FS.writeText(other, 'other')
    const runs: RecordedRun[] = []
    const provider = new AgentCliGenerationProvider({
      attachments: [shot, other],
      env: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', PATH: '/usr/bin' },
      kind: 'claude',
      run: async (command, spec) => {
        runs.push({ command, spec })
        if (spec.args.includes('--help')) {
          return ok('--json-schema --no-session-persistence --safe-mode --permission-mode --tools\n')
        }
        return ok(JSON.stringify({
          type: 'result',
          is_error: false,
          result: 'Done.',
          structured_output: { Title: 'Mushroom Toast', Servings: 2 },
        }))
      },
    })

    Expect(await provider.availability()).toEqual({ status: 'available' })
    const result = await provider.generate<JsonObject>(schema, [{ name: 'Mood', value: 'cozy' }], 'Create a recipe.')
      .final
    Expect(result).toEqual({ status: 'success', value: { Title: 'Mushroom Toast', Servings: 2 } })

    const generate = runs[1]!
    Expect(generate.command).toBe('claude')
    Expect(generate.spec.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(schema),
      '--no-session-persistence',
      '--safe-mode',
      '--permission-mode',
      'dontAsk',
      '--tools',
      'Read',
      '--allowedTools',
      'Read',
    ])
    Expect(generate.spec.stdin).toContain('Create a recipe.')
    Expect(generate.spec.stdin).toContain('"Mood":"cozy"')
    Expect(generate.spec.stdin).toContain('1-shot.png')
    Expect(generate.spec.stdin).not.toContain(shot)
    Expect(generate.spec.cwd).toContain('tao-create-claude-')
    // The markers are present and undefined: that is what the spawn drops, where a missing key is refilled.
    Expect(Object.hasOwn(generate.spec.env ?? {}, 'CLAUDECODE') && generate.spec.env?.['CLAUDECODE'] === undefined)
      .toBe(true)
    Expect(generate.spec.env?.['CLAUDE_CODE_ENTRYPOINT']).toBeUndefined()
    Expect(generate.spec.env?.['PATH']).toBe('/usr/bin')
    await FS.remove(root)
  })

  Test('falls back to JSON inside the text result and reports errors and timeouts honestly', async () => {
    const answers: AgentCliRunResult[] = [
      ok(JSON.stringify({ type: 'result', is_error: false, result: 'Here you go: {"Title":"Toast","Servings":1}' })),
      ok(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in.' })),
      { exitCode: null, stderr: '', stdout: '', timedOut: true },
      ok(JSON.stringify({ type: 'result', is_error: false, result: 'No JSON for you.' })),
    ]
    const provider = new AgentCliGenerationProvider({ kind: 'claude', run: async () => answers.shift()! })

    Expect(await provider.generate<JsonObject>(schema, [], 'Create a recipe.').final).toEqual({
      status: 'success',
      value: { Title: 'Toast', Servings: 1 },
    })
    Expect(await provider.generate<JsonObject>(schema, [], 'Create a recipe.').final).toEqual({
      status: 'failure',
      code: 'provider_error',
      message: 'Not logged in.',
    })
    const timedOut = await provider.generate<JsonObject>(schema, [], 'Create a recipe.').final
    Expect(timedOut.status === 'failure' && timedOut.code).toBe('cancelled')
    Expect(await provider.generate<JsonObject>(schema, [], 'Create a recipe.').final).toEqual({
      status: 'failure',
      code: 'provider_error',
      message: 'Claude Code answered without JSON.',
    })
  })

  Test('scrubs the nested-session markers so a real child sees them unset, and enforces the timeout', async () => {
    const env = agentChildEnv({ ...Platform.runtimeProcess.env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' })
    const run = await sharedAgentCliRunner('sh', {
      args: ['-c', 'echo "${CLAUDECODE:-unset} ${CLAUDE_CODE_ENTRYPOINT:-unset}"'],
      env,
      timeoutMs: 10_000,
    })
    Expect(run).toEqual({ exitCode: 0, stderr: '', stdout: 'unset unset\n', timedOut: false })

    // This is the timeoutMs under test — the child sleeps 30s and the test proves the runner's own
    // timeout fires, not that the run is fast. Explicit exec makes sleep the direct child:
    // a retained shell can instead exit with the signalled descendant's numeric status.
    const slow = await sharedAgentCliRunner('sh', { args: ['-c', 'exec sleep 30'], env, timeoutMs: 300 }) // budget-ok: timeout value under test.
    Expect(slow.timedOut).toBe(true)
    Expect(slow.exitCode).toBeNull()
  })

  Test("preserves a timed-out command's own exit status when it handles termination", async () => {
    const result = await sharedAgentCliRunner('sh', {
      args: ['-c', "trap 'exit 42' TERM; sleep 30 & wait; exit 42"],
      timeoutMs: 300, // budget-ok: timeout value under test.
    })

    Expect(result.timedOut).toBe(true)
    Expect(result.exitCode).toBe(42)
  })

  Test('drives Codex exec with an output schema file and reads the last message file', async () => {
    const runs: RecordedRun[] = []
    const provider = new AgentCliGenerationProvider({
      attachments: ['/pictures/shot.png'],
      kind: 'codex',
      run: async (command, spec) => {
        runs.push({ command, spec })
        if (spec.args.includes('--help')) {
          return ok('--sandbox --ephemeral --ignore-user-config --ignore-rules --output-schema --output-last-message\n')
        }
        const schemaPath = spec.args[spec.args.indexOf('--output-schema') + 1]!
        Expect(JSON.parse(await FS.readText(schemaPath))).toEqual(schema)
        const outputPath = spec.args[spec.args.indexOf('--output-last-message') + 1]!
        await FS.writeText(outputPath, '{"Title":"Mushroom Toast","Servings":2}\n')
        return ok('')
      },
    })

    Expect(await provider.availability()).toEqual({ status: 'available' })
    const result = await provider.generate<JsonObject>(schema, [{ name: 'Mood', value: 'cozy' }], 'Create a recipe.')
      .final
    Expect(result).toEqual({ status: 'success', value: { Title: 'Mushroom Toast', Servings: 2 } })

    const generate = runs[1]!
    Expect(generate.command).toBe('codex')
    Expect(generate.spec.args.slice(0, 8)).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--output-schema',
    ])
    Expect(generate.spec.args).toContain('--output-last-message')
    Expect(generate.spec.args).toContain('--image')
    Expect(generate.spec.args).toContain('/pictures/shot.png')
    Expect(generate.spec.args.at(-1)).toBe('-')
    Expect(generate.spec.stdin).toContain('Create a recipe.')
    Expect(generate.spec.cwd).toBeDefined()
  })
})

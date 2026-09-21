import { CLI, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

/**
 * Exercises `agent-dev.ts` itself rather than a unit underneath it, because the behavior under test
 * — what Commander does with an option it sees before any subcommand is chosen — only exists once
 * the whole program is assembled. Run through `bun run` rather than the built `./agent` wrapper: the
 * wrapper's own build and devenv bootstrap would make this the slowest test in the package for a
 * question that has nothing to do with either.
 */

const ENTRYPOINT = Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/agent-dev.ts')

async function runEntrypoint(args: readonly string[]): Promise<{ exitCode: number; stderr: string }> {
  const result = await CLI.run('bun', { args: ['run', ENTRYPOINT, ...args], cwd: Repo.getRoot(), stdio: 'pipe' })
  return { exitCode: result.exitCode ?? -1, stderr: result.stderr }
}

Describe('agent entrypoint', () => {
  Test('hints that a front-door flag belongs after the command, not before it', async () => {
    const result = await runEntrypoint(['--verbose', 'board'])

    Expect(result.exitCode).toBe(1)
    Expect(result.stderr).toContain("unknown option '--verbose'")
    Expect(result.stderr).toContain('go after the command, not before it')
    Expect(result.stderr).toContain('./agent <command> --verbose')
  })

  Test('leaves an unrelated unknown option without the front-door hint', async () => {
    const result = await runEntrypoint(['--not-a-real-flag', 'board'])

    Expect(result.exitCode).toBe(1)
    Expect(result.stderr).toContain("unknown option '--not-a-real-flag'")
    // Still hinted: any option before the command is unknown to the top-level parser, front-door
    // flag or not, so the hint is the right answer for this one too rather than a special case.
    Expect(result.stderr).toContain('go after the command, not before it')
  })
})

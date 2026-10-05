import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { CleanCommand, type CleanScope, type CleanStep } from '../dev-cli-src/clean/CleanCommand'

function commandLine(step: CleanStep): string {
  return [step.command, ...step.args].join(' ')
}

/** stepping runs a clean scope against a recorder, so the reporting is observed without removing anything. */
async function stepping(
  scope: CleanScope,
  options: { elapsedMs?: number; failAt?: string } = {},
): Promise<{ output: string; ran: string[]; result: number }> {
  const ran: string[] = []
  let clock = 0
  const captured = await withCapturedOutput(async () =>
    await CleanCommand.run({
      now: () => {
        clock += options.elapsedMs ?? 0
        return clock
      },
      repositoryRoot: '/repo',
      runStep: async step => {
        ran.push(commandLine(step))
        return step.name === options.failAt ? 3 : 0
      },
      scope,
    })
  )
  return { output: captured.stdout, ran, result: captured.result }
}

Describe('cleaning a checkout', () => {
  Test('refuses a linked project cache ancestor before starting removal', async () => {
    const root = await mkTestDir('tao-clean-project-')
    const external = await mkTestDir('tao-clean-external-')
    const linked = FS.resolvePath('Apps/WordFlower/1 - Current/.tao', root)
    const externalOutput = FS.resolvePath('cache/_gen_tao-app/App.tsx', external)
    const ran: string[] = []
    try {
      await FS.writeText(externalOutput, 'keep')
      await FS.symlink(external, linked)
      await Expect(CleanCommand.run({
        repositoryRoot: root,
        runStep: async step => {
          ran.push(step.name)
          return 0
        },
      })).rejects.toThrow('Cannot clean generated project cache through linked path')
      Expect(ran).toEqual([])
      Expect(await FS.readText(externalOutput)).toBe('keep')
    } finally {
      await FS.remove(root)
      await FS.remove(external)
    }
  })

  Test('removes checkout artifacts without deleting shared test caches', async () => {
    const checkout = (await CleanCommand.stepsFor('checkout')).map(commandLine)
    Expect(checkout[0]).toMatch(
      /^rm -rf \.artifacts\/build \.artifacts\/dev packages\/apps\/expo-host\/\.expo packages\/apps\/expo-host\/_gen_tao-app packages\/apps\/expo-host\/_gen_tao-app-test Apps\/WordFlower\/1 - Current\/\.tao\/cache\/_gen_tao-app$/,
    )
    // Pruned rather than descended: `find` must not walk into a tree it is about to delete.
    Expect(checkout[1]).toBe('find . -name node_modules -type d -prune -exec rm -rf {} +')
    Expect((await CleanCommand.stepsFor('all')).map(commandLine)).toEqual([
      ...checkout,
      'rm -rf .artifacts packages/apps/expo-host/ios packages/apps/expo-host/android',
    ])
  })

  Test('names each step as it starts and states what it cost when it finishes', async () => {
    const { output, ran, result } = await stepping('checkout', { elapsedMs: 3_200 })

    // One line per step, whether a person watched `... ` sit there or reads the finished log.
    Expect(output.split('\n').filter(line => line.length > 0)).toEqual([
      'Removing build and dev artifacts ... Done (3.2s)',
      'Removing installed node_modules trees ... Done (3.2s)',
    ])
    Expect(ran.length).toBe(2)
    Expect(result).toBe(0)
  })

  Test('reports the wider scope as the same steps plus its own', async () => {
    const { output, result } = await stepping('all')

    Expect(output).toContain('Removing installed node_modules trees ... Done (0ms)')
    Expect(output).toContain('Removing every remaining artifact and native project ... Done (0ms)')
    Expect(result).toBe(0)
  })

  Test('stops at a step that failed rather than reporting a checkout it did not clean', async () => {
    const { output, ran, result } = await stepping('all', { failAt: 'Removing installed node_modules trees' })

    Expect(output).toContain('Removing installed node_modules trees ... Failed (0ms), exit 3')
    Expect(output).not.toContain('Removing every remaining artifact')
    Expect(ran).toEqual((await CleanCommand.stepsFor('checkout')).map(commandLine))
    Expect(result).toBe(3)
  })
})

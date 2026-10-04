import { Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { lowerCreationPlan } from '../cli-src/create/creation-lowering'
import { deterministicPlan } from '../cli-src/create/creation-plan'
import { runFix } from '../cli-src/source-commands'
import { StandaloneScenarios } from '../cli-src/standalone-scenarios'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'

Describe('standalone acceptance scenarios', () => {
  Test('preserves the last readable summary and stops when publication fails', async () => {
    const root = await mkTestDir('standalone-summary-publication-')
    const path = FS.resolvePath('acceptance-summary.json', root)
    const pending = `${path}.pending`
    let nextRan = false
    try {
      const captured = await withCapturedOutput(async () => {
        await Expect(StandaloneScenarios.run([
          {
            name: 'build',
            run: async () => {
              // A real filesystem failure while publishing completion must not truncate the checkpoint.
              await FS.writeText(FS.resolvePath('blocker', pending), 'preserve this directory')
            },
          },
          {
            name: 'browser',
            run: async () => {
              nextRan = true
            },
          },
        ], path)).rejects.toThrow('EISDIR')
      })
      Expect(nextRan).toBe(false)
      Expect(await FS.readJson(path)).toEqual({
        format: 'tao-standalone-acceptance-v1',
        scenarios: [{ name: 'build', status: 'running' }, { name: 'browser', status: 'unrun' }],
      })
      Expect(await FS.readText(FS.resolvePath('blocker', pending))).toBe('preserve this directory')
      Expect(captured.stdout).toBe('[1/2] RUN build\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('the real starter supplies the assertion and semantic coverage used by installed acceptance', async () => {
    const description = 'A tally counter'
    const files = lowerCreationPlan(deterministicPlan(description), { description })
    await withTaoFixture(files, async root => {
      await runFix(root)
      const facts = await runTaoCliForTest(['facts', root, 'App.tao', 'ATallyCounter'])
      Expect(facts.exitCode).toBe(0)
      Expect(JSON.parse(facts.stdout).facts.length).toBeGreaterThan(0)
      const coverage = await runTaoCliForTest(['coverage', root, 'App.tao', 'ATallyCounter', 'ItemList'])
      Expect(coverage.exitCode).toBe(0)
      Expect(JSON.parse(coverage.stdout).coverage.shows).toContainEqual({
        by: 'exact',
        checks: ['adds a item, opens it, and renames it'],
        text: 'No items yet',
      })
    })
  })

  Test('persists progress before running and retains failed and unrun scenarios after rejection', async () => {
    const root = await mkTestDir('standalone-scenarios-')
    const path = FS.resolvePath('acceptance-summary.json', root)
    const calls: string[] = []
    try {
      const captured = await withCapturedOutput(async () => {
        await Expect(StandaloneScenarios.run([
          {
            name: 'install',
            run: async () => {
              calls.push('install')
            },
          },
          {
            name: 'broken journey',
            run: async () => {
              calls.push('broken journey')
              Expect(await FS.readJson(path)).toMatchObject({
                scenarios: [
                  { name: 'install', status: 'passed' },
                  { name: 'broken journey', status: 'running' },
                  { name: 'build', status: 'unrun' },
                ],
              })
              Errors.throwHostEnvironment('The journey failed at its text assertion.')
            },
          },
          {
            name: 'build',
            run: async () => {
              calls.push('build')
            },
          },
        ], path)).rejects.toThrow('The journey failed at its text assertion.')
      })
      Expect(calls).toEqual(['install', 'broken journey'])
      Expect(await FS.readJson(path)).toMatchObject({
        format: 'tao-standalone-acceptance-v1',
        scenarios: [
          { name: 'install', status: 'passed', durationMs: Expect['any'](Number) },
          {
            name: 'broken journey',
            status: 'failed',
            durationMs: Expect['any'](Number),
            error: 'The journey failed at its text assertion.',
          },
          { name: 'build', status: 'unrun' },
        ],
      })
      Expect(captured.stdout).toBe(
        '[1/3] RUN install\n[1/3] PASSED install\n[2/3] RUN broken journey\n[2/3] FAILED broken journey\n',
      )
      Expect(captured.stderr).toBe('')
    } finally {
      await FS.remove(root)
    }
  })

  Test('finishes every successful scenario and replaces evidence from an earlier run', async () => {
    const root = await mkTestDir('standalone-scenarios-success-')
    const path = FS.resolvePath('acceptance-summary.json', root)
    try {
      await FS.writeJson(path, { scenarios: [{ name: 'obsolete', status: 'failed' }] })
      await FS.writeText(`${path}.pending`, '{"interrupted":')
      const captured = await withCapturedOutput(() =>
        StandaloneScenarios.run([
          {
            name: 'create',
            run: async () => {
              await FS.writeText(FS.resolvePath('created', root), 'ready')
            },
          },
          {
            name: 'check',
            run: async () => {
              Expect(await FS.readText(FS.resolvePath('created', root))).toBe('ready')
            },
          },
        ], path)
      )
      Expect(await FS.readJson(path)).toMatchObject({
        scenarios: [{ name: 'create', status: 'passed' }, { name: 'check', status: 'passed' }],
      })
      Expect(captured.stdout).toContain('[2/2] PASSED check')
      Expect(await FS.exists(`${path}.pending`)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('requires the expected diagnostic and failing exit together', () => {
    const reject = (exitCode: number, stderr: string) =>
      StandaloneScenarios.commandOutput(
        'tao test',
        { exitCode, stderr, stdout: '' },
        /expected rendered text but found none/,
      )
    Expect(() => reject(0, 'expected rendered text but found none')).toThrow('did not reject')
    Expect(() => reject(1, 'command not found')).toThrow('did not reject')
    Expect(reject(1, 'expected rendered text but found none')).toBe('')
    Expect(() =>
      StandaloneScenarios.commandOutput('tao test', {
        exitCode: null,
        stdout: '',
        stderr: 'expected rendered text but found none',
      }, /expected rendered text/)
    ).toThrow('did not complete normally')
    Expect(() =>
      StandaloneScenarios.commandOutput('tao check', {
        exitCode: 1,
        stdout: '',
        stderr: 'bad source',
      })
    ).toThrow('bad source')
  })
})

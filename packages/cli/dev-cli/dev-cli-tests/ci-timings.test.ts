import { Describe, Expect, Test } from '@shared/test'
import { CiTimingsCommand } from '../dev-cli-src/pr/CiTimingsCommand'
import type { PrChecksDependencies } from '../dev-cli-src/pr/PrChecksCommand'

/**
 * The scripted `fetch` answers the Actions API by path with two runs whose partitions take known
 * times, so the table's medians, slowest values, and changes are checked against arithmetic.
 */

const ROOT = '/repo'
const SLUG = 'owner/repo'
const BASE = Date.parse('2026-10-05T12:00:00Z')

function at(seconds: number): string {
  return new Date(BASE + seconds * 1000).toISOString()
}

function step(name: string, from: number, to: number, conclusion = 'success') {
  return { completed_at: at(to), conclusion, name, started_at: at(from) }
}

/** partition is one partition job whose bootstrap takes `bootstrap` seconds and whose cache save skips. */
function partition(index: number, bootstrap: number) {
  return {
    completed_at: at(bootstrap + 100),
    name: `Partition ${index}/3`,
    started_at: at(0),
    steps: [
      step('Bootstrap', 0, bootstrap),
      step('Save the cache', bootstrap, bootstrap, 'skipped'),
      step(`Verify partition ${index}/3`, bootstrap, bootstrap + 100),
    ],
  }
}

function workflowRun(id: number, branch: string) {
  return {
    created_at: at(0),
    head_branch: branch,
    head_sha: `${id}abcdef0123`,
    id,
    status: 'completed',
    updated_at: at(300),
  }
}

function fakeDependencies() {
  const lines: string[] = []
  const requested: string[] = []
  const respond = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
  const jobs: Record<number, unknown[]> = {
    1: [partition(1, 120), partition(2, 130), partition(3, 140), { ...partition(0, 0), name: 'Verify', steps: [] }],
    2: [partition(1, 40), partition(2, 50), partition(3, 90)],
  }
  const dependencies: PrChecksDependencies = {
    env: {},
    fetch: async url => {
      const path = url.replace('https://api.github.com', '')
      requested.push(path)
      if (path.startsWith(`/repos/${SLUG}/actions/workflows/verify.yml/runs?branch=main&`)) {
        return respond({ workflow_runs: [workflowRun(1, 'main')] })
      }
      if (path.startsWith(`/repos/${SLUG}/actions/workflows/verify.yml/runs?branch=feat%2Fexample&`)) {
        return respond({ workflow_runs: [workflowRun(2, 'feat/example')] })
      }
      const runJobs = /\/actions\/runs\/(\d+)\/jobs/u.exec(path)
      if (runJobs !== null) {
        return respond({ jobs: jobs[Number(runJobs[1])] ?? [] })
      }
      return respond({ message: 'Not Found' }, 404)
    },
    now: () => 0,
    run: async (command, spec = {}) => {
      const args = (spec.args ?? []).join(' ')
      const stdout = args === 'remote get-url origin'
        ? `git@github.com:${SLUG}.git\n`
        : args === 'symbolic-ref --quiet --short HEAD'
        ? 'feat/example\n'
        : ''
      return { args: [...(spec.args ?? [])], command, cwd: spec.cwd, exitCode: 0, signal: null, stderr: '', stdout }
    },
    sleep: async () => {},
    writeLine: line => lines.push(line),
  }
  return { dependencies, lines, requested }
}

Describe('ci-timings', () => {
  Test("compares this branch's newest run against main's newest green push, step by step", async () => {
    const fake = fakeDependencies()
    const result = await CiTimingsCommand.run({ repositoryRoot: ROOT }, fake.dependencies)
    Expect(result.exitCode).toBe(0)
    Expect(fake.requested.some(path => path.includes('branch=main&event=push&status=success'))).toBe(true)
    Expect(fake.lines).toContain('| Bootstrap | 130s / 140s | 50s / 90s | -80s |')
    Expect(fake.lines).toContain('| Save the cache | skipped | skipped |  |')
    // Each partition's index folds into one row rather than three.
    Expect(fake.lines).toContain('| Verify partition k/3 | 100s / 100s | 100s / 100s | 0s |')
    Expect(fake.lines).toContain('| Partition job (wall) | 230s / 240s | 150s / 190s | -80s |')
    // A job only one run had is still listed, with a dash for the run that lacked it.
    Expect(fake.lines).toContain('| Verify job (wall) | 100s / 100s | — |  |')
    Expect(fake.lines.at(-1)).toBe(
      'after: run 2 on feat/example at 2abcdef0, completed, created 2026-10-05T12:00:00.000Z',
    )
  })
})

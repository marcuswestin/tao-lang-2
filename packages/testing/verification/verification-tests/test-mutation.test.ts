import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import type { GateSummary } from '../verification-src/RunSummary'
import { TestLedger } from '../verification-src/TestLedger'
import { TestRunner } from '../verification-src/TestRunner'

const FILE = 'packages/example/example-tests/example.test.ts'
const SUBJECT = 'packages/example/subject.ts'
const EVIDENCE_PATHS = [
  TestLedger.LEDGER_PATH,
  TestLedger.HISTORY_PATH,
  '.artifacts/timings/durations.json',
  '.artifacts/timings/history.jsonl',
] as const

async function fixture(): Promise<string> {
  const root = await mkTestDir('tao-test-mutation-')
  await FS.writeText(
    FS.resolvePath(FILE, root),
    `import { expect, test } from '${['bun', 'test'].join(':')}'\n`
      + "import { value } from '../subject'\n"
      + "test('reads the subject', () => expect(value).toBe(1))\n",
  )
  await FS.writeText(
    FS.resolvePath('packages/cli/dev-cli/performance-checks/language-performance.test.ts', root),
    `import { expect, test } from '${['bun', 'test'].join(':')}'\ntest('fixture check', () => expect(1).toBe(1))\n`,
  )
  return root
}

function options(root: string) {
  return {
    jobs: 1,
    outputMode: 'quiet' as const,
    registryRoot: FS.resolvePath('machine-lanes', root),
    repositoryRoot: root,
  }
}

async function evidence(root: string): Promise<Array<string | undefined>> {
  return await Promise.all(EVIDENCE_PATHS.map(async path => {
    const absolute = FS.resolvePath(path, root)
    return await FS.exists(absolute) ? await FS.readText(absolute) : undefined
  }))
}

async function subject(root: string, value: number): Promise<void> {
  await FS.writeText(FS.resolvePath(SUBJECT, root), `export const value = ${value}\n`)
}

Describe('mutation test evidence', () => {
  Test('keeps deliberate red and green runs out of existing flake and timing evidence', async () => {
    const root = await fixture()
    try {
      for (const outcome of ['passed', 'failed', 'passed'] as const) {
        await TestLedger.recordRun({
          fullRun: false,
          observations: [{ durationMs: 7, file: FILE, name: 'reads the subject', outcome, suite: 'example' }],
          repositoryRoot: root,
          startedAt: Date.now(),
        })
      }
      await FS.writeJson(FS.resolvePath(EVIDENCE_PATHS[2], root), { nodes: {}, version: 1 })
      await FS.writeText(FS.resolvePath(EVIDENCE_PATHS[3], root), 'retained ordinary timing history\n')
      Expect(await TestLedger.tolerated(root)).toHaveLength(1)
      const before = await evidence(root)

      for (const value of [0, 1, 0, 1]) {
        await subject(root, value)
        const captured = await withCapturedOutput(() => TestRunner.runTestMutation(FILE, options(root)))
        Expect(captured.result).toBe(value === 0 ? 1 : 0)
        Expect(captured.stdout).toContain('Mutation run: raw failures are fatal')
        Expect(captured.stdout).not.toContain('tolerating 1 known flake')
        Expect(await evidence(root)).toEqual(before)
        const summary = await FS.readJson<GateSummary>(
          FS.resolvePath('.artifacts/logs/dev-test-mutation/latest/summary.json', root),
        )
        Expect(summary.status).toBe(value === 0 ? 'failed' : 'passed')
        Expect(summary.toleratedFlakes).toBeUndefined()
        Expect(summary.warnings).toContain(
          'Mutation run: raw failures are fatal; automatic retries, flake tolerance, ledger writes and timing learning are disabled.',
        )
        if (value === 0) {
          Expect(summary.failures?.some(failure => failure.test === 'reads the subject')).toBe(true)
          const log = await FS.readText(FS.resolvePath('.artifacts/logs/dev-test-mutation/latest/example.log', root))
          Expect(log).toContain('(fail) reads the subject')
        }
      }

      // The same raw failure remains eligible under the ordinary policy. This control proves the
      // mutation verdict did not merely pass because its fixture never earned real tolerance.
      await subject(root, 0)
      const ordinaryRed = await withCapturedOutput(() => TestRunner.runTestFile(FILE, options(root)))
      Expect(ordinaryRed.result).toBe(0)
      Expect(ordinaryRed.stdout).toContain('tolerating 1 known flake')
      Expect((await TestLedger.load(root)).tests[`example::${FILE}::reads the subject`]?.outcome).toBe('failed')
      Expect(await evidence(root)).not.toEqual(before)
      await subject(root, 1)
      const ordinaryGreen = await withCapturedOutput(() => TestRunner.runTestFile(FILE, options(root)))
      Expect(ordinaryGreen.result).toBe(0)
      Expect((await TestLedger.load(root)).tests[`example::${FILE}::reads the subject`]?.outcome).toBe('passed')
    } finally {
      await FS.remove(root)
    }
  })

  Test('a cold mutation run creates raw artifacts without creating ordinary evidence', async () => {
    const root = await fixture()
    try {
      for (const value of [0, 1, 0]) {
        await subject(root, value)
        const captured = await withCapturedOutput(() => TestRunner.runTestMutation(FILE, options(root)))
        Expect(captured.result).toBe(value === 0 ? 1 : 0)
        Expect(await evidence(root)).toEqual([undefined, undefined, undefined, undefined])
      }
      Expect(await TestLedger.tolerated(root)).toEqual([])
      Expect(await FS.exists(FS.resolvePath('.artifacts/logs/dev-test-mutation/latest/summary.json', root))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('mutation evidence stays isolated when composed with a complete selection', async () => {
    const root = await fixture()
    try {
      await subject(root, 1)
      // The full selection also schedules the Tao-app entry. Only its expensive implementation
      // is a stub; the package tests above execute normally and must not teach their durations.
      const tao = FS.resolvePath('tao', root)
      await FS.writeText(tao, '#!/bin/sh\nexit 0\n')
      await FS.chmod(tao, 0o755)
      const captured = await withCapturedOutput(() =>
        TestRunner.runTestRequest({ evidenceMode: 'mutation', kind: 'full' }, options(root))
      )
      Expect(captured.stdout).toContain('dev-test-mutation: PASSED')
      Expect(captured.result).toBe(0)
      Expect(await evidence(root)).toEqual([undefined, undefined, undefined, undefined])
    } finally {
      await FS.remove(root)
    }
  })
})

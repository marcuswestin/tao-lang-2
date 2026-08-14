import { FS, Time } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import type { UsageProviderSummary } from '../dev-src/commands/ai-usage-normalizer'
import {
  buildReviewDigest,
  buildReviewerInvocation,
  buildReviewPrompt,
  capText,
  formatFanoutReport,
  formatReviewRunDir,
  parseManifest,
  parseSmokeProviders,
  resolveReviewRunDir,
  REVIEW_LENSES,
  type ReviewMeta,
  reviewMetricsPath,
  reviewRunRoot,
  runStreamingInvocation,
} from '../dev-src/commands/code-review'
import {
  formatReviewPlan,
  manifestFromReviewPlan,
  planReviewers,
  providersFromBudgetSummary,
} from '../dev-src/commands/code-review/planner'
import { smokeMarkerMatch } from '../dev-src/commands/code-review/smoke'

Describe('review prompt assembly', () => {
  Test('assembles the contract, lens, and scope', () => {
    const prompt = buildReviewPrompt({ repoRoot: '/repo', scope: 'Review file X.', lensKey: 'correctness' })
    Expect(prompt).toContain('adversarial, read-only reviewer for the Tao language repo at /repo')
    Expect(prompt).toContain('Do not edit files')
    Expect(prompt).toContain('Verify candidate findings against actual code behavior')
    Expect(prompt).toContain('severity, confidence, why it matters, minimal fix direction')
    Expect(prompt).toContain(REVIEW_LENSES['correctness']?.title ?? 'missing-lens')
    Expect(prompt).toContain('Review file X.')
  })

  Test('falls back to a general lens and the default scope', () => {
    const prompt = buildReviewPrompt({ repoRoot: '/repo' })
    Expect(prompt).toContain('Review lens: general')
    Expect(prompt).toContain('git diff --cached')
  })

  Test('rejects an unknown lens key by omitting it for the general focus', () => {
    const prompt = buildReviewPrompt({ repoRoot: '/repo', lensKey: 'nope' })
    Expect(prompt).toContain('Review lens: general')
  })
})

Describe('reviewer invocation safety', () => {
  const cases = [
    { reviewer: 'agy', requiredArgs: ['--sandbox'] },
    { reviewer: 'claude', requiredArgs: ['--permission-mode', 'plan'] },
    { reviewer: 'codex', requiredArgs: ['--sandbox', 'read-only'] },
    { reviewer: 'cursor', requiredArgs: ['--mode=plan', '--sandbox', 'enabled'] },
    { reviewer: 'gemini', requiredArgs: ['--approval-mode', 'plan'] },
  ] as const
  for (const { reviewer, requiredArgs } of cases) {
    Test(`keeps ${reviewer} reviews non-mutating`, () => {
      const invocation = buildReviewerInvocation({
        reviewer,
        promptText: 'PROMPT BODY',
        effort: 'high',
        debugFile: '/run/r.debug.log',
      })

      for (const arg of requiredArgs) {
        Expect(invocation.args).toContain(arg)
      }
    })
  }
})

Describe('digest capping', () => {
  Test('keeps short text intact', () => {
    Expect(capText('short', 100)).toEqual({ text: 'short', truncated: false, originalBytes: 5 })
  })

  Test('keeps head and tail with a truncation marker for long text', () => {
    const capped = capText('a'.repeat(50) + 'b'.repeat(50), 40)
    Expect(capped.truncated).toBe(true)
    Expect(capped.originalBytes).toBe(100)
    Expect(Buffer.byteLength(capped.text, 'utf8')).toBeLessThanOrEqual(40)
    Expect(capped.text).toContain('bytes truncated')
    Expect(capped.text.startsWith('a')).toBe(true)
    Expect(capped.text.endsWith('b')).toBe(true)
  })

  Test('keeps multibyte truncation within the byte cap', () => {
    const capped = capText('🙂'.repeat(50), 41)
    Expect(capped.truncated).toBe(true)
    Expect(Buffer.byteLength(capped.text, 'utf8')).toBeLessThanOrEqual(41)
    Expect(capped.text).not.toContain('\uFFFD')
  })

  Test('rejects invalid byte budgets', () => {
    Expect(() => capText('text', 0)).toThrow()
    Expect(() => capText('text', Number.NaN)).toThrow()
    Expect(() => capText('text', 1.5)).toThrow()
  })
})

Describe('fanout manifest parsing', () => {
  Test('parses an array of reviewer specs', () => {
    const entries = parseManifest([
      { reviewer: 'codex', label: 'correctness', lens: 'correctness', effort: 'high' },
      { reviewer: 'agy', label: 'stale', lens: 'stale', model: 'Gemini 3.5 Flash (High)' },
      { reviewer: 'cursor', label: 'cursor-boundary', lens: 'api-boundary' },
      { reviewer: 'gemini', label: 'gemini-consistency', lens: 'consistency' },
    ])
    Expect(entries.map(entry => entry.label)).toEqual(['correctness', 'stale', 'cursor-boundary', 'gemini-consistency'])
    Expect(entries[0]?.reviewer).toBe('codex')
    Expect(entries[1]?.model).toBe('Gemini 3.5 Flash (High)')
    Expect(entries[2]?.reviewer).toBe('cursor')
    Expect(entries[2]?.model).toBe('composer-2.5')
    Expect(entries[3]?.reviewer).toBe('gemini')
  })

  Test('parses a reviewers-wrapped object', () => {
    const entries = parseManifest({ reviewers: [{ reviewer: 'claude', label: 'broad' }] })
    Expect(entries[0]?.reviewer).toBe('claude')
  })

  Test('rejects empty manifests', () => {
    Expect(() => parseManifest([])).toThrow()
    Expect(() => parseManifest({ reviewers: [] })).toThrow()
  })

  Test('rejects unknown reviewers, duplicate labels, and unknown lenses', () => {
    Expect(() => parseManifest([{ reviewer: 'llama', label: 'x' }])).toThrow()
    Expect(() => parseManifest([{ reviewer: 'codex', label: 'x', lens: 'nope' }])).toThrow()
    Expect(() =>
      parseManifest([
        { reviewer: 'codex', label: 'dup' },
        { reviewer: 'agy', label: 'dup' },
      ])
    ).toThrow()
  })

  Test('rejects unsafe labels and invalid timeouts', () => {
    Expect(() => parseManifest([{ reviewer: 'codex', label: '../escape' }])).toThrow()
    Expect(() => parseManifest([{ reviewer: 'codex', label: 'nested/path' }])).toThrow()
    Expect(() => parseManifest([{ reviewer: 'codex', label: 'scope' }])).toThrow()
    Expect(() => parseManifest([{ reviewer: 'codex', label: 'digest' }])).toThrow()
    Expect(() => parseManifest([{ reviewer: 'agy', label: 'agy', timeoutSeconds: 0 }])).toThrow()
    Expect(() => parseManifest([{ reviewer: 'agy', label: 'agy', timeoutSeconds: Number.NaN }])).toThrow()
    Expect(() => parseManifest([{ reviewer: 'agy', label: 'agy', model: 'Claude Opus 4.6 (Thinking)' }])).toThrow()
  })
})

Describe('budget-aware review planning', () => {
  Test('prefers Codex Spark when normal Codex 5h budget is exhausted', () => {
    const plan = planReviewers({
      generatedAt: new Date('2026-06-16T00:00:00.000Z'),
      profile: 'light',
      providers: [
        {
          provider: 'codex',
          ok: true,
          windows: [
            { label: 'primary', remainingPercent: 0 },
            { label: 'secondary', remainingPercent: 84 },
            { label: 'codex-spark', remainingPercent: 100 },
          ],
        },
      ],
    })

    Expect(plan.selected[0]?.provider).toBe('codex-spark')
    Expect(plan.selected[0]?.model).toBe('gpt-5.3-codex-spark')
    Expect(plan.selected[0]?.reason).toContain('100% remaining')
  })

  Test('skips exhausted providers and records why', () => {
    const plan = planReviewers({
      profile: 'standard',
      providers: [
        providerBudget('codex', 80),
        providerBudget('cursor', 0),
        providerBudget('claude', 70),
        providerBudget('gemini', 60),
        providerBudget('agy', 50),
      ],
    })

    Expect(plan.selected.some(entry => entry.provider === 'cursor')).toBe(false)
    const skippedCursor = plan.skipped.find(entry => entry.provider === 'cursor')
    Expect(skippedCursor?.budgetStatus).toBe('exhausted')
    Expect(skippedCursor?.reason).toContain('below 10% threshold')
  })

  Test('treats failed non-Codex budget reads as unknown, not blocked', () => {
    const plan = planReviewers({
      profile: 'standard',
      providers: [
        providerBudget('codex', 80),
        { provider: 'claude', ok: false, error: 'cookie missing', windows: [] },
        providerBudget('cursor', 80),
        providerBudget('gemini', 80),
        providerBudget('agy', 80),
      ],
    })

    const claude = plan.selected.find(entry => entry.provider === 'claude')
    Expect(claude?.budgetStatus).toBe('unknown')
    Expect(claude?.reason).toContain('cookie missing')
  })

  Test('treats missing provider budgets as unknown, not blocked', () => {
    const plan = planReviewers({ profile: 'standard' })

    Expect(plan.selected.length).toBe(4)
    Expect(plan.selected.every(entry => entry.budgetStatus === 'unknown')).toBe(true)
    Expect(formatReviewPlan(plan)).toContain('budget: unknown')
  })

  Test('uses deterministic profile sizes with fully available budgets', () => {
    const providers = allProviderBudgets(100)

    Expect(planReviewers({ profile: 'light', providers }).selected.length).toBe(2)
    Expect(planReviewers({ profile: 'standard', providers }).selected.length).toBe(4)
    Expect(planReviewers({ profile: 'stringent', providers }).selected.length).toBe(6)
    Expect(planReviewers({ profile: 'architecture', providers }).selected.length).toBe(3)
  })

  Test('round-trips planned reviewers through a fanout manifest', () => {
    const plan = planReviewers({
      profile: 'architecture',
      providers: allProviderBudgets(100),
      scopeFile: '.artifacts/reviews/standard/run/scope.md',
    })
    const manifest = manifestFromReviewPlan(plan)

    Expect(manifest.reviewers.length).toBe(3)
    Expect(manifest.reviewers[0]).not.toHaveProperty('reason')
    Expect(manifest.reviewers[0]?.scopeFile).toBe('.artifacts/reviews/standard/run/scope.md')
    Expect(parseManifest(manifest)).toEqual(manifest.reviewers)
  })

  Test('adapts old Codex-only budget snapshots into provider summaries', () => {
    const providers = providersFromBudgetSummary({
      command: 'codexbar usage',
      rawPath: '/run/codexbar-usage.json',
      status: 'ok',
      primary: { label: 'primary', remainingPercent: 50 },
      spark: { fiveHour: { label: 'codex-spark', remainingPercent: 90 } },
    })

    Expect(providers?.[0]?.provider).toBe('codex')
    Expect(providers?.[0]?.windows.map(window => window.label)).toEqual(['primary', 'codex-spark'])
  })
})

Describe('review run formatting', () => {
  Test('builds a sortable, slugged run directory name', () => {
    Expect(formatReviewRunDir('Validator Type System!', new Date(2026, 5, 16, 9, 5, 3, 123)))
      .toMatch(/^20260616-090503\.123-[a-z0-9]{6}-validator-type-system$/)
    Expect(formatReviewRunDir(undefined, new Date(2026, 5, 16, 9, 5, 3, 123)))
      .toMatch(/^20260616-090503\.123-[a-z0-9]{6}-review$/)
  })

  Test('selects separate artifact roots for ordinary and stringent runs', () => {
    Expect(reviewRunRoot('standard')).toBe('.artifacts/reviews/standard')
    Expect(reviewRunRoot('stringent')).toBe('.artifacts/reviews/stringent')
  })

  Test('places runtime metrics under the owning review profile root', () => {
    Expect(reviewMetricsPath('/repo/.artifacts/reviews/standard/run-1', '/repo')).toBe(
      '/repo/.artifacts/reviews/standard/metrics/reviewer-runtimes.jsonl',
    )
    Expect(reviewMetricsPath('/repo/.artifacts/reviews/stringent/run-1', '/repo')).toBe(
      '/repo/.artifacts/reviews/stringent/metrics/reviewer-runtimes.jsonl',
    )
  })

  Test('resolves run directories from the repo root', () => {
    Expect(resolveReviewRunDir('.artifacts/reviews/standard/run', '/repo')).toBe(
      '/repo/.artifacts/reviews/standard/run',
    )
    Expect(resolveReviewRunDir('/tmp/review-run', '/repo')).toBe('/tmp/review-run')
  })

  Test('renders a fanout status table with a failure count', () => {
    const metas: ReviewMeta[] = [
      {
        label: 'a',
        reviewer: 'codex',
        effort: 'high',
        status: 'ok',
        exitCode: 0,
        durationMs: 1_500,
        bytes: 120,
        reviewPath: '/run/a.md',
        command: 'codex exec',
      },
      {
        label: 'b',
        reviewer: 'agy',
        effort: 'high',
        status: 'empty',
        exitCode: 0,
        durationMs: 800,
        bytes: 0,
        reviewPath: '/run/b.md',
        command: 'agy',
        kind: 'smoke',
      },
    ]
    const report = formatFanoutReport(metas)
    Expect(report).toContain('launched 2 reviewer(s)')
    Expect(report).toContain('b [smoke]: agy')
    Expect(report).toContain('1 reviewer(s) failed or returned empty output')
  })
})

function providerBudget(provider: string, remainingPercent: number): UsageProviderSummary {
  return {
    provider,
    ok: true,
    windows: [{ label: 'primary', remainingPercent }],
  }
}

function allProviderBudgets(remainingPercent: number): UsageProviderSummary[] {
  return [
    {
      provider: 'codex',
      ok: true,
      windows: [
        { label: 'primary', remainingPercent },
        { label: 'secondary', remainingPercent },
        { label: 'codex-spark', remainingPercent },
        { label: 'codex-spark-weekly', remainingPercent },
      ],
    },
    providerBudget('claude', remainingPercent),
    providerBudget('cursor', remainingPercent),
    providerBudget('gemini', remainingPercent),
    providerBudget('agy', remainingPercent),
  ]
}

Describe('review digest formatting', () => {
  Test('includes reviewer metadata and truncation notes', async () => {
    await withTaoFiles('tao-review-digest-', { 'review.md': `${'finding\n'.repeat(100)}` }, async paths => {
      const metas: ReviewMeta[] = [
        {
          label: 'correctness',
          reviewer: 'codex',
          effort: 'max',
          status: 'ok',
          exitCode: 0,
          durationMs: 1_000,
          bytes: 800,
          reviewPath: paths['review.md'],
          command: 'codex exec',
          lens: 'correctness',
        },
      ]

      const digest = await buildReviewDigest(metas, 80)
      Expect(digest.markdown).toContain('## correctness (codex, correctness)')
      Expect(digest.markdown).toContain('truncated from')
      Expect(digest.index[0]).toContain('correctness: codex [correctness] ok')
    })
  })
})

Describe('review streaming runner', () => {
  Test('writes status and progress events while the process runs', async () => {
    await withTaoFiles('tao-review-stream-', {}, async (_paths, rootDir) => {
      const artifactDir = FS.resolvePath('slow', rootDir)
      const stdoutPath = FS.resolvePath('stdout.log', artifactDir)
      const stderrPath = FS.resolvePath('stderr.log', artifactDir)
      const eventsPath = FS.resolvePath('events.jsonl', artifactDir)
      const statusPath = FS.resolvePath('status.json', artifactDir)
      const running = runStreamingInvocation({
        artifactDir,
        args: ['0.5'],
        command: '/bin/sleep',
        cwd: rootDir,
        effort: 'low',
        eventsPath,
        heartbeatMs: 50,
        label: 'slow',
        logHeartbeat: false,
        outputFormat: 'text',
        reviewer: 'codex',
        statusPath,
        stderrPath,
        stdoutPath,
      })
      await waitForFileContaining(statusPath, '"status": "running"')

      const result = await running
      Expect(result.status).toBe('empty')
      Expect(await FS.readText(eventsPath)).toContain('"event":"empty"')
    })
  })

  Test('records timeouts', async () => {
    await withTaoFiles('tao-review-stream-timeout-', {}, async (_paths, rootDir) => {
      const timeoutArtifactDir = FS.resolvePath('timeout', rootDir)
      const timeoutResult = await runStreamingInvocation({
        artifactDir: timeoutArtifactDir,
        args: ['10'],
        command: '/bin/sleep',
        cwd: rootDir,
        effort: 'low',
        eventsPath: FS.resolvePath('events.jsonl', timeoutArtifactDir),
        heartbeatMs: 20,
        label: 'timeout',
        logHeartbeat: false,
        outputFormat: 'text',
        reviewer: 'codex',
        statusPath: FS.resolvePath('status.json', timeoutArtifactDir),
        stderrPath: FS.resolvePath('stderr.log', timeoutArtifactDir),
        stdoutPath: FS.resolvePath('stdout.log', timeoutArtifactDir),
        timeoutSeconds: 1,
      })
      Expect(timeoutResult.status).toBe('timeout')
      Expect(timeoutResult.timedOut).toBe(true)
    })
  })
})

async function waitForFileContaining(path: string, expected: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let text = ''
  while (Date.now() < deadline) {
    try {
      text = await FS.readText(path)
      if (text.includes(expected)) {
        return
      }
    } catch {
      // The streaming runner may not have created the file yet.
    }
    await Time.sleep(25)
  }
  Expect(text).toContain(expected)
}

Describe('provider smoke parsing', () => {
  Test('parses selected smoke providers and rejects unknown names', () => {
    Expect(parseSmokeProviders(undefined)).toEqual(['codexbar'])
    Expect(parseSmokeProviders('codex-spark,codexbar')).toEqual(['codex-spark', 'codexbar'])
    Expect(parseSmokeProviders('all')).toContain('agy')
    Expect(() => parseSmokeProviders('llama')).toThrow()
  })

  Test('classifies exact and verbose smoke marker output', () => {
    Expect(smokeMarkerMatch('CODEX_AGENT_OK', 'CODEX_AGENT_OK')).toEqual({ ok: true, verbose: false })
    Expect(smokeMarkerMatch('Result: CODEX_AGENT_OK', 'CODEX_AGENT_OK')).toEqual({ ok: true, verbose: false })
    Expect(smokeMarkerMatch('review says CODEX_AGENT_OK after preamble', 'CODEX_AGENT_OK')).toEqual({
      ok: true,
      verbose: true,
    })
    Expect(smokeMarkerMatch('wrong output', 'CODEX_AGENT_OK')).toEqual({ ok: false, verbose: false })
  })
})

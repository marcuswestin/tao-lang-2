import { FS, Time } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { formatAgentHelpText } from '../dev-src/commands/agent-help'
import type { UsageProviderSummary } from '../dev-src/commands/ai-usage-normalizer'
import {
  buildReviewDigest,
  buildReviewerInvocation,
  buildReviewPrompt,
  capText,
  extractClaudeResultText,
  extractCodexResultText,
  extractCursorResultText,
  extractGenericJsonlText,
  formatFanoutReport,
  formatReviewRunDir,
  parseCodexBudgetSummary,
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

Describe('reviewer invocation mapping', () => {
  Test('builds a streaming Claude invocation with the prompt as a single arg', () => {
    const invocation = buildReviewerInvocation({
      reviewer: 'claude',
      promptText: 'PROMPT BODY',
      effort: 'high',
      debugFile: '/run/r.debug.log',
      model: 'claude-opus-4-8',
    })
    Expect(invocation.command).toBe('claude')
    Expect(invocation.outputFormat).toBe('jsonl')
    Expect(invocation.args).toContain('--output-format')
    Expect(invocation.args).toContain('stream-json')
    Expect(invocation.args).toContain('--debug-file')
    Expect(invocation.args[invocation.args.length - 1]).toBe('PROMPT BODY')
    Expect(invocation.args[invocation.args.indexOf('--model') + 1]).toBe('claude-opus-4-8')
    Expect(invocation.stdin).toBeUndefined()
  })

  Test('builds a read-only Codex invocation that reads the prompt from stdin', () => {
    const invocation = buildReviewerInvocation({
      reviewer: 'codex',
      promptText: 'PROMPT BODY',
      effort: 'max',
      debugFile: '/run/r.debug.log',
      finalFile: '/run/final.txt',
    })
    Expect(invocation.command).toBe('codex')
    Expect(invocation.outputFormat).toBe('jsonl')
    Expect(invocation.stdin).toBe('PROMPT BODY')
    Expect(invocation.args).toContain('read-only')
    Expect(invocation.args[invocation.args.length - 1]).toBe('-')
    Expect(invocation.args).toContain('--json')
    Expect(invocation.args[invocation.args.indexOf('--output-last-message') + 1]).toBe('/run/final.txt')
    Expect(invocation.args).toContain('service_tier="fast"')
    Expect(invocation.args).toContain('model_reasoning_effort=xhigh')
  })

  Test('builds a Codex Spark invocation as a model override', () => {
    const invocation = buildReviewerInvocation({
      reviewer: 'codex',
      promptText: 'PROMPT BODY',
      effort: 'low',
      debugFile: '/run/r.debug.log',
      finalFile: '/run/final.txt',
      model: 'gpt-5.3-codex-spark',
    })
    Expect(invocation.args[invocation.args.indexOf('-m') + 1]).toBe('gpt-5.3-codex-spark')
    Expect(invocation.args).toContain('model_reasoning_effort=low')
    Expect(invocation.args).toContain('service_tier="fast"')
  })

  Test('builds an agy invocation with flags before the prompt and a print timeout', () => {
    const invocation = buildReviewerInvocation({
      reviewer: 'agy',
      promptText: 'PROMPT BODY',
      effort: 'high',
      debugFile: '/run/r.debug.log',
      model: 'Gemini 3.5 Flash (High)',
      timeoutSeconds: 600,
    })
    Expect(invocation.command).toBe('agy')
    Expect(invocation.args[invocation.args.indexOf('--model') + 1]).toBe('Gemini 3.5 Flash (High)')
    Expect(invocation.args[invocation.args.indexOf('--log-file') + 1]).toBe('/run/r.debug.log')
    Expect(invocation.args[invocation.args.length - 2]).toBe('-p')
    Expect(invocation.args[invocation.args.length - 1]).toBe('PROMPT BODY')
    Expect(invocation.args[invocation.args.indexOf('--print-timeout') + 1]).toBe('600s')
    Expect(invocation.args.indexOf('--model')).toBeLessThan(invocation.args.indexOf('-p'))
  })

  Test('uses a faster default timeout for agy when one is not provided', () => {
    const invocation = buildReviewerInvocation({
      reviewer: 'agy',
      promptText: 'PROMPT BODY',
      effort: 'high',
      debugFile: '/run/r.debug.log',
    })
    Expect(invocation.args[invocation.args.indexOf('--print-timeout') + 1]).toBe('480s')
    Expect(invocation.args[invocation.args.indexOf('--model') + 1]).toBe('Gemini 3.5 Flash (High)')
  })

  Test('rejects non-Google models for agy invocations', () => {
    Expect(() =>
      buildReviewerInvocation({
        reviewer: 'agy',
        promptText: 'PROMPT BODY',
        effort: 'high',
        debugFile: '/run/r.debug.log',
        model: 'Claude Opus 4.6 (Thinking)',
      })
    ).toThrow()
  })

  Test('builds a read-only Cursor agent invocation for headless review', () => {
    const invocation = buildReviewerInvocation({
      reviewer: 'cursor',
      promptText: 'PROMPT BODY',
      effort: 'high',
      debugFile: '/run/r.debug.log',
    })
    Expect(invocation.command).toBe('cursor')
    Expect(invocation.outputFormat).toBe('jsonl')
    Expect(invocation.args).toContain('agent')
    Expect(invocation.args).toContain('--print')
    Expect(invocation.args).toContain('--mode=plan')
    Expect(invocation.args).toContain('enabled')
    Expect(invocation.args).toContain('--trust')
    Expect(invocation.args).toContain('stream-json')
    Expect(invocation.args).toContain('--stream-partial-output')
    Expect(invocation.args[invocation.args.indexOf('--model') + 1]).toBe('composer-2.5')
    Expect(invocation.args[invocation.args.length - 1]).toBe('PROMPT BODY')
    Expect(invocation.stdin).toBeUndefined()
  })

  Test('honors an explicit Cursor model override', () => {
    const invocation = buildReviewerInvocation({
      reviewer: 'cursor',
      promptText: 'PROMPT BODY',
      effort: 'high',
      debugFile: '/run/r.debug.log',
      model: 'composer-2.5-fast',
    })
    Expect(invocation.args[invocation.args.indexOf('--model') + 1]).toBe('composer-2.5-fast')
  })

  Test('builds a plan-mode Gemini invocation with the prompt as a single arg', () => {
    const invocation = buildReviewerInvocation({
      reviewer: 'gemini',
      promptText: 'PROMPT BODY',
      effort: 'high',
      debugFile: '/run/r.debug.log',
    })
    Expect(invocation.command).toBe('gemini')
    Expect(invocation.outputFormat).toBe('jsonl')
    Expect(invocation.args).toContain('--skip-trust')
    Expect(invocation.args).toContain('--approval-mode')
    Expect(invocation.args[invocation.args.indexOf('--approval-mode') + 1]).toBe('plan')
    Expect(invocation.args[invocation.args.indexOf('--model') + 1]).toBe('gemini-3.1-pro-preview')
    Expect(invocation.args[invocation.args.indexOf('--output-format') + 1]).toBe('stream-json')
    Expect(invocation.args[invocation.args.indexOf('--prompt') + 1]).toBe('PROMPT BODY')
  })

  Test('caps Claude effort at high but keeps Codex xhigh for max', () => {
    const claude = buildReviewerInvocation({ reviewer: 'claude', promptText: 'p', effort: 'max', debugFile: '/d' })
    Expect(claude.args[claude.args.indexOf('--effort') + 1]).toBe('high')
    Expect(buildReviewerInvocation({ reviewer: 'codex', promptText: 'p', effort: 'max', debugFile: '/d' }).args)
      .toContain('model_reasoning_effort=xhigh')
  })
})

Describe('claude stream-json extraction', () => {
  Test('prefers the final result event', () => {
    const jsonl = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"thinking out loud"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"FINAL REVIEW"}',
    ].join('\n')
    Expect(extractClaudeResultText(jsonl)).toBe('FINAL REVIEW')
  })

  Test('falls back to assembled assistant text when no result event exists', () => {
    const jsonl = [
      'not json',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"part one "}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"part two"}]}}',
    ].join('\n')
    Expect(extractClaudeResultText(jsonl)).toBe('part one part two')
  })

  Test('returns undefined for output with no recoverable text', () => {
    Expect(extractClaudeResultText('garbage\n{"type":"system"}')).toBeUndefined()
  })
})

Describe('reviewer JSONL extraction', () => {
  Test('extracts Codex agent messages from exec JSONL', () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"FINAL CODEX"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1}}',
    ].join('\n')
    Expect(extractCodexResultText(jsonl)).toBe('FINAL CODEX')
  })

  Test('extracts generic stream-json assistant deltas', () => {
    const jsonl = [
      '{"type":"content","value":"part one "}',
      '{"type":"content","text":"part two"}',
    ].join('\n')
    Expect(extractGenericJsonlText(jsonl)).toBe('part one part two')
  })

  Test('extracts Gemini message content deltas', () => {
    const jsonl = [
      '{"type":"message","role":"user","content":"prompt"}',
      '{"type":"message","role":"assistant","content":"GEM","delta":true}',
      '{"type":"message","role":"assistant","content":"INI_AGENT_OK","delta":true}',
      '{"type":"result","status":"success"}',
    ].join('\n')
    Expect(extractGenericJsonlText(jsonl)).toBe('GEMINI_AGENT_OK')
  })

  Test('prefers the Claude ExitPlanMode plan body over the closer result', () => {
    const jsonl = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Let me review."}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"ExitPlanMode","input":{"plan":"# Review\\n\\nMAJOR finding.","planFilePath":"/tmp/p.md"}}]}}',
      '{"type":"result","result":"The user declined exiting plan mode."}',
    ].join('\n')
    Expect(extractClaudeResultText(jsonl)).toBe('# Review\n\nMAJOR finding.')
  })

  Test('prefers the Cursor createPlan tool call body over the preamble result', () => {
    const jsonl = [
      '{"type":"thinking","subtype":"delta","delta":{"text":"Reviewing.. "}}',
      '{"type":"tool_call","subtype":"completed","tool_call":{"createPlanToolCall":{"args":{"plan":"# API Boundary Review\\n\\nNo blockers."}}}}',
      '{"type":"result","subtype":"success","result":"Reviewing the diff against live code."}',
    ].join('\n')
    Expect(extractCursorResultText(jsonl)).toBe('# API Boundary Review\n\nNo blockers.')
  })

  Test('falls back to visible Cursor text when no plan tool call is present', () => {
    const jsonl = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"inline review body"}]}}',
      '{"type":"result","subtype":"success","result":"inline review body"}',
    ].join('\n')
    Expect(extractCursorResultText(jsonl)).toBe('inline review body')
  })
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

Describe('codexbar budget parsing', () => {
  Test('extracts normal Codex and Spark windows from JSON usage', () => {
    const summary = parseCodexBudgetSummary(
      JSON.stringify([
        {
          provider: 'codex',
          source: 'oauth',
          usage: {
            primary: { usedPercent: 100, windowMinutes: 300, resetDescription: '7:34 AM' },
            secondary: { usedPercent: 16, windowMinutes: 10080, resetDescription: 'Jun 23' },
            extraRateWindows: [
              {
                id: 'codex-spark',
                title: 'Codex Spark 5-hour',
                window: { usedPercent: 0, windowMinutes: 300, resetDescription: '11:01 AM' },
              },
              {
                id: 'codex-spark-weekly',
                title: 'Codex Spark Weekly',
                window: { usedPercent: 2, windowMinutes: 10080, resetDescription: 'Jun 23' },
              },
            ],
          },
        },
      ]),
      { command: 'codexbar usage', rawPath: '/run/codexbar.json' },
    )
    Expect(summary.status).toBe('ok')
    Expect(summary.primary?.remainingPercent).toBe(0)
    Expect(summary.secondary?.remainingPercent).toBe(84)
    Expect(summary.spark?.fiveHour?.remainingPercent).toBe(100)
    Expect(summary.spark?.weekly?.remainingPercent).toBe(98)
    Expect(summary.source).toBe('oauth')
    Expect(summary.providers?.find(entry => entry.provider === 'codex')?.ok).toBe(true)
  })

  Test('reports provider errors as failed budget summaries', () => {
    const summary = parseCodexBudgetSummary(
      JSON.stringify([{ provider: 'codex', error: { message: 'Browser cookie access denied.' } }]),
      { command: 'codexbar usage', rawPath: '/run/codexbar.json' },
    )
    Expect(summary.status).toBe('failed')
    Expect(summary.error).toContain('Browser cookie access denied')
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

  Test('writes a fanout manifest separate from planner metadata', () => {
    const plan = planReviewers({
      profile: 'architecture',
      providers: allProviderBudgets(100),
      scopeFile: '.artifacts/skills/subagents-review/run/scope.md',
    })
    const manifest = manifestFromReviewPlan(plan)

    Expect(manifest.reviewers.length).toBe(3)
    Expect(manifest.reviewers[0]).not.toHaveProperty('reason')
    Expect(manifest.reviewers[0]?.scopeFile).toBe('.artifacts/skills/subagents-review/run/scope.md')
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
    Expect(reviewRunRoot('standard')).toBe('.artifacts/skills/subagents-review')
    Expect(reviewRunRoot('stringent')).toBe('.artifacts/skills/subagents-review-stringent')
  })

  Test('places runtime metrics under the owning skill artifact root', () => {
    Expect(reviewMetricsPath('/repo/.artifacts/skills/subagents-review/run-1', '/repo')).toBe(
      '/repo/.artifacts/skills/subagents-review/metrics/reviewer-runtimes.jsonl',
    )
    Expect(reviewMetricsPath('/repo/.artifacts/skills/subagents-review-stringent/run-1', '/repo')).toBe(
      '/repo/.artifacts/skills/subagents-review-stringent/metrics/reviewer-runtimes.jsonl',
    )
  })

  Test('resolves run directories from the repo root', () => {
    Expect(resolveReviewRunDir('.artifacts/skills/subagents-review/run', '/repo')).toBe(
      '/repo/.artifacts/skills/subagents-review/run',
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
  Test('writes stdout, stderr, status, and progress events while the process runs', async () => {
    await withTaoFiles('tao-review-stream-', {}, async (_paths, rootDir) => {
      const artifactDir = FS.resolvePath('slow', { cwd: rootDir })
      const stdoutPath = FS.resolvePath('stdout.log', { cwd: artifactDir })
      const stderrPath = FS.resolvePath('stderr.log', { cwd: artifactDir })
      const eventsPath = FS.resolvePath('events.jsonl', { cwd: artifactDir })
      const statusPath = FS.resolvePath('status.json', { cwd: artifactDir })
      const running = runStreamingInvocation({
        artifactDir,
        args: ['-c', 'printf start; sleep 0.5; printf err >&2; printf end'],
        command: 'sh',
        cwd: rootDir,
        effort: 'low',
        eventsPath,
        heartbeatMs: 50,
        label: 'slow',
        outputFormat: 'text',
        reviewer: 'codex',
        statusPath,
        stderrPath,
        stdoutPath,
      })
      await Time.sleep(150)
      Expect(await FS.readText(stdoutPath)).toContain('start')
      Expect(await FS.readText(statusPath)).toContain('"status": "running"')

      const result = await running
      Expect(result.status).toBe('ok')
      Expect(await FS.readText(stdoutPath)).toContain('startend')
      Expect(await FS.readText(stderrPath)).toContain('err')
      Expect(await FS.readText(eventsPath)).toContain('"event":"stdout_chunk"')
      Expect(await FS.readText(eventsPath)).toContain('"event":"heartbeat"')
    })
  })

  Test('records JSONL parse errors and timeouts', async () => {
    await withTaoFiles('tao-review-stream-timeout-', {}, async (_paths, rootDir) => {
      const artifactDir = FS.resolvePath('timeout', { cwd: rootDir })
      const result = await runStreamingInvocation({
        artifactDir,
        args: ['-c', 'printf "not-json\\n"; sleep 1'],
        command: 'sh',
        cwd: rootDir,
        effort: 'low',
        eventsPath: FS.resolvePath('events.jsonl', { cwd: artifactDir }),
        heartbeatMs: 20,
        label: 'timeout',
        outputFormat: 'jsonl',
        reviewer: 'codex',
        statusPath: FS.resolvePath('status.json', { cwd: artifactDir }),
        stderrPath: FS.resolvePath('stderr.log', { cwd: artifactDir }),
        stdoutPath: FS.resolvePath('stdout.jsonl', { cwd: artifactDir }),
        timeoutSeconds: 0.2,
      })
      Expect(result.status).toBe('timeout')
      Expect(result.timedOut).toBe(true)
      Expect(await FS.readText(FS.resolvePath('events.jsonl', { cwd: artifactDir }))).toContain(
        'provider_json_parse_error',
      )
    })
  })
})

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

Describe('agent review help', () => {
  Test('documents the repo-owned review surface', () => {
    const help = formatAgentHelpText('test # Run all tests', ['rg', 'codexbar'])
    Expect(help).toContain('./agent review <command> [options]')
    Expect(help).toContain('./agent review new --stringent --slug my-review')
    Expect(help).toContain('./agent review plan --run .artifacts/skills/subagents-review/<run> --profile standard')
    Expect(help).toContain('./agent review smoke-providers --provider codex-spark,codexbar')
    Expect(help).toContain('./agent ai-usage --provider all --json')
    Expect(help).toContain('./agent codexbar usage --provider all --source oauth --format json --pretty')
    Expect(help).toContain('codexbar')
    Expect(help).toContain(
      './agent cursor agent --print --mode=plan --sandbox enabled --trust --output-format stream-json --stream-partial-output --model composer-2.5',
    )
    Expect(help).toContain(
      './agent gemini --skip-trust --approval-mode plan --model gemini-3.1-pro-preview --output-format stream-json --prompt',
    )
    Expect(help).toContain('review orchestration writes artifacts under .artifacts/skills')
  })
})

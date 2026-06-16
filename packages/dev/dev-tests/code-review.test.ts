import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { formatAgentHelpText } from '../dev-src/commands/agent-help'
import {
  buildReviewDigest,
  buildReviewerInvocation,
  buildReviewPrompt,
  capText,
  extractClaudeResultText,
  formatFanoutReport,
  formatReviewRunDir,
  parseManifest,
  resolveReviewRunDir,
  REVIEW_LENSES,
  type ReviewMeta,
  reviewRunRoot,
} from '../dev-src/commands/code-review'

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
    })
    Expect(invocation.command).toBe('codex')
    Expect(invocation.outputFormat).toBe('text')
    Expect(invocation.stdin).toBe('PROMPT BODY')
    Expect(invocation.args).toContain('read-only')
    Expect(invocation.args[invocation.args.length - 1]).toBe('-')
    Expect(invocation.args).toContain('model_reasoning_effort=xhigh')
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
    Expect(invocation.outputFormat).toBe('text')
    Expect(invocation.args).toContain('agent')
    Expect(invocation.args).toContain('--print')
    Expect(invocation.args).toContain('--mode=plan')
    Expect(invocation.args).toContain('enabled')
    Expect(invocation.args).toContain('--trust')
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
    Expect(invocation.outputFormat).toBe('text')
    Expect(invocation.args).toContain('--skip-trust')
    Expect(invocation.args).toContain('--approval-mode')
    Expect(invocation.args[invocation.args.indexOf('--approval-mode') + 1]).toBe('plan')
    Expect(invocation.args[invocation.args.indexOf('--model') + 1]).toBe('gemini-3.1-pro-preview')
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
      },
    ]
    const report = formatFanoutReport(metas)
    Expect(report).toContain('launched 2 reviewer(s)')
    Expect(report).toContain('1 reviewer(s) failed or returned empty output')
  })
})

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

Describe('agent review help', () => {
  Test('documents the repo-owned review surface', () => {
    const help = formatAgentHelpText('test # Run all tests', ['rg'])
    Expect(help).toContain('./agent review <command> [options]')
    Expect(help).toContain('./agent review new --stringent --slug my-review')
    Expect(help).toContain('./agent cursor agent --print --mode=plan --sandbox enabled --trust --model composer-2.5')
    Expect(help).toContain('./agent gemini --skip-trust --approval-mode plan --model gemini-3.1-pro-preview --prompt')
    Expect(help).toContain('review orchestration writes artifacts under .artifacts/skills')
  })
})

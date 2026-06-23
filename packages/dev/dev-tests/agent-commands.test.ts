import { Describe, Expect, Test } from '@shared/test'
import { formatAiUsageReport, summarizeAiUsage } from '../dev-src/commands/ai-usage'
import { formatArtifactRunId } from '../dev-src/commands/artifacts'
import { auditInstructionFiles, formatInstructionAuditReport } from '../dev-src/commands/audit-instructions'
import { formatJustSuccessLine, parseJustSuccessSummary, shouldStreamJustOutput } from '../dev-src/commands/just'
import {
  analyzeMergeFeaturePreflight,
  extractRoadmapCandidates,
  formatMergeFeaturePreflightReport,
} from '../dev-src/commands/merge-feature-preflight'
import { ExpoRunner } from '../dev-src/dev-loop/expo-runner/ExpoRunner'
import { AppSwitchChoices } from '../dev-src/dev-loop/keyboard-input/AppSwitchChoices'
import Commands from '../dev-src/dev-loop/keyboard-input/Commands'

Describe('agent just command helpers', () => {
  Test('classifies streamed and quiet just invocations', () => {
    Expect(shouldStreamJustOutput([])).toBe(true)
    Expect(shouldStreamJustOutput(['help'])).toBe(true)
    Expect(shouldStreamJustOutput(['dev'])).toBe(true)
    Expect(shouldStreamJustOutput(['verify'])).toBe(false)
  })

  Test('formats quiet success summaries with parsed test counts', () => {
    Expect(parseJustSuccessSummary(' 27 pass\n 0 fail\nTests: 12 passed, 12 total\n')).toBe('39 tests passed')
    Expect(formatJustSuccessLine(['test'], 'Tests: 12 passed, 12 total', 1_234))
      .toBe('[just]: test ok in 1.2s (12 tests passed)')
  })

  Test('recognizes the verify dev-loop shortcut key', () => {
    Expect(Commands.isCommandKey('v')).toBe(true)
    Expect(Commands.isCommandKey('p')).toBe(false)
  })
})

Describe('ai usage summary', () => {
  Test('normalizes provider windows, spark windows, and errors', () => {
    const providers = summarizeAiUsage(JSON.stringify([
      {
        provider: 'codex',
        source: 'oauth',
        usage: {
          primary: { usedPercent: 100, resetDescription: '7:34 AM' },
          secondary: { usedPercent: 16, resetDescription: 'Jun 23' },
          extraRateWindows: [
            { id: 'codex-spark', window: { usedPercent: 0, resetDescription: '11:01 AM' } },
            { id: 'codex-spark-weekly', window: { usedPercent: 2 } },
          ],
        },
      },
      { provider: 'mistral', error: { message: 'No Mistral session cookies found.' } },
    ]))

    Expect(providers).toBeDefined()
    const codex = providers?.find(entry => entry.provider === 'codex')
    Expect(codex?.ok).toBe(true)
    Expect(codex?.windows.map(window => `${window.label}:${window.remainingPercent}`)).toEqual([
      'primary:0',
      'secondary:84',
      'codex-spark:100',
      'codex-spark-weekly:98',
    ])
    Expect(providers?.find(entry => entry.provider === 'mistral')?.ok).toBe(false)
  })

  Test('returns undefined for non-array output and reports availability lines', () => {
    Expect(summarizeAiUsage('not json')).toBeUndefined()
    const report = formatAiUsageReport([
      {
        provider: 'codex',
        source: 'oauth',
        ok: true,
        windows: [{ label: 'codex-spark', remainingPercent: 100, resetDescription: '11:01 AM' }],
      },
      { provider: 'mistral', ok: false, error: 'no session', windows: [] },
    ])
    Expect(report).toContain('- codex [oauth]: codex-spark 100% left (resets 11:01 AM)')
    Expect(report).toContain('unavailable: mistral')
  })
})

Describe('agent artifact helpers', () => {
  Test('creates sortable run ids with a random suffix', () => {
    Expect(formatArtifactRunId(new Date(2026, 5, 6, 2, 55, 55, 123))).toMatch(
      /^20260606-025555\.123-[a-z0-9]{6}$/,
    )
  })
})

Describe('dev loop port helpers', () => {
  Test('formats lsof field output for listening processes', () => {
    const listeners = ExpoRunner.portDiagnostics.formatLsofListeners({
      exitCode: 0,
      stderr: '',
      stdout: [
        'p1234',
        'cnode',
        'n127.0.0.1:8081',
        'p5678',
        'cexpo',
        'n*:8081',
        'p1234',
        'cnode',
        'n127.0.0.1:8081',
      ].join('\n'),
    })

    Expect(listeners).toEqual([
      { command: 'node', name: '127.0.0.1:8081', pid: 1234 },
      { command: 'expo', name: '*:8081', pid: 5678 },
    ])
  })

  Test('formats port listeners for prompts', () => {
    Expect(ExpoRunner.portDiagnostics.formatListeners([
      { command: 'node', name: '127.0.0.1:8081', pid: 1234 },
      { command: 'expo', pid: 5678 },
    ])).toBe('node pid 1234 (127.0.0.1:8081), expo pid 5678')
  })

  Test('uses parsed lsof listeners even when lsof exits nonzero with warnings', () => {
    const listeners = ExpoRunner.portDiagnostics.formatLsofListeners({
      exitCode: 1,
      stderr: 'lsof: warning: incomplete information',
      stdout: ['p1234', 'cnode', 'n127.0.0.1:8081'].join('\n'),
    })

    Expect(listeners).toEqual([
      { command: 'node', name: '127.0.0.1:8081', pid: 1234 },
    ])
  })

  Test('treats blank nonzero lsof output as no listeners', () => {
    const listeners = ExpoRunner.portDiagnostics.formatLsofListeners({
      exitCode: 1,
      stderr: '',
      stdout: '',
    })

    Expect(listeners).toEqual([])
  })
})

Describe('dev loop app switch helpers', () => {
  Test('maps single digit app switch keys to displayed app choices', () => {
    const choices = [
      { label: 'First', value: '/repo/Apps/First/First.tao' },
      { label: 'Second', value: '/repo/Apps/Second/Second.tao' },
    ]

    Expect(AppSwitchChoices.actionForKey(choices, '1')).toEqual({
      kind: 'choose',
      appPath: '/repo/Apps/First/First.tao',
    })
    Expect(AppSwitchChoices.actionForKey(choices, '2')).toEqual({
      kind: 'choose',
      appPath: '/repo/Apps/Second/Second.tao',
    })
    Expect(AppSwitchChoices.actionForKey(choices, '0')).toEqual({ kind: 'invalid' })
    Expect(AppSwitchChoices.actionForKey(choices, '9')).toEqual({ kind: 'invalid' })
    Expect(AppSwitchChoices.actionForKey(choices, '')).toEqual({ kind: 'invalid' })
    Expect(AppSwitchChoices.actionForKey(choices, 'x')).toEqual({ kind: 'invalid' })
    Expect(AppSwitchChoices.actionForKey(choices, '\u001b[A')).toEqual({ kind: 'invalid' })
    Expect(AppSwitchChoices.actionForKey(choices, 'q')).toEqual({ kind: 'cancel' })
    Expect(AppSwitchChoices.actionForKey(choices, '\u001b')).toEqual({ kind: 'cancel' })
    Expect(AppSwitchChoices.actionForKey(choices, '\u0003')).toEqual({ kind: 'exit', exitCode: 130 })
  })
})

Describe('instruction audit helpers', () => {
  Test('finds stale instruction mechanics', () => {
    const findings = auditInstructionFiles([
      {
        path: 'agents/skills/example/SKILL.md',
        text: '- First switch to PLAN mode\n- When in doubt, ask\n',
      },
    ])

    Expect(findings.map(finding => finding.id)).toEqual(['blanket-clarification', 'plan-mode'])
  })

  Test('formats a clean audit report', () => {
    Expect(formatInstructionAuditReport(3, [])).toBe('instruction audit ok: 3 files scanned.\n')
  })
})

Describe('merge feature preflight helpers', () => {
  Test('passes a clean feature branch with upstream and commits', () => {
    const report = analyzeMergeFeaturePreflight({
      branch: 'feat/example',
      commitsAheadOfMain: 2,
      dirtyEntries: [],
      hasMain: true,
      hasOriginMain: true,
      mainBranchDivergence: [0, 2],
      mainOriginDivergence: [0, 0],
      roadmapArchiveCandidates: ['Roadmap/Example'],
      statusBranch: '## feat/example...origin/feat/example',
      upstream: 'origin/feat/example',
      worktrees: 'worktree /repo\nbranch refs/heads/feat/example\n',
    })

    Expect(report.blockers).toEqual([])
    Expect(report.warnings).toEqual([])
    Expect(formatMergeFeaturePreflightReport(report)).toContain('merge feature preflight passed')
  })

  Test('blocks dirty main worktrees', () => {
    const report = analyzeMergeFeaturePreflight({
      branch: 'main',
      commitsAheadOfMain: 0,
      dirtyEntries: [' M AGENTS.md'],
      gitFailures: [],
      hasMain: true,
      hasOriginMain: true,
      mainBranchDivergence: [0, 0],
      mainOriginDivergence: [0, 0],
      roadmapArchiveCandidates: [],
      statusBranch: '## main',
      upstream: undefined,
      worktrees: 'worktree /repo\nbranch refs/heads/main\n',
    })

    Expect(report.blockers.map(blocker => blocker.message)).toEqual([
      'Current branch is main; merge from a feature branch instead.',
      'Worktree has 1 dirty entry.',
      'Branch has no commits ahead of main.',
    ])
  })

  Test('blocks git command failures and unknown ahead counts', () => {
    const report = analyzeMergeFeaturePreflight({
      branch: 'feat/example',
      commitsAheadOfMain: undefined,
      dirtyEntries: [],
      gitFailures: ['git rev-list --count main..HEAD failed with exit 128'],
      hasMain: true,
      hasOriginMain: true,
      mainBranchDivergence: undefined,
      mainOriginDivergence: [0, 0],
      roadmapArchiveCandidates: [],
      statusBranch: '## feat/example',
      upstream: 'origin/feat/example',
      worktrees: 'worktree /repo\nbranch refs/heads/feat/example\n',
    })

    Expect(report.blockers.map(blocker => blocker.message)).toEqual([
      'git rev-list --count main..HEAD failed with exit 128',
      'Could not determine commits ahead of main.',
    ])
  })

  Test('ignores deleted and archived roadmap paths when extracting archive candidates', () => {
    Expect(extractRoadmapCandidates([
      'D\tRoadmap/Done Task/Plan.md',
      'A\tRoadmap/Next Task/Plan.md',
      'M\tRoadmap/Archive/Old Task/Plan.md',
      'R100\tRoadmap/Renamed Task/Plan.md\tRoadmap/Archive/Renamed Task/Plan.md',
    ].join('\n'))).toEqual(['Roadmap/Next Task'])
  })
})

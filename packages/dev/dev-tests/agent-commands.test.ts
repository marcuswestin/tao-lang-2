import { Describe, Expect, Test } from '@shared/test'
import { formatArtifactRunId } from '../dev-src/commands/artifacts'
import { auditInstructionFiles, formatInstructionAuditReport } from '../dev-src/commands/audit-instructions'
import { formatJustSuccessLine, parseJustSuccessSummary, shouldStreamJustOutput } from '../dev-src/commands/just'
import {
  analyzeMergeFeaturePreflight,
  extractRoadmapCandidates,
  formatMergeFeaturePreflightReport,
} from '../dev-src/commands/merge-feature-preflight'

Describe('agent just command helpers', () => {
  Test('classifies streamed and quiet just invocations', () => {
    Expect(shouldStreamJustOutput([])).toBe(true)
    Expect(shouldStreamJustOutput(['help'])).toBe(true)
    Expect(shouldStreamJustOutput(['dev'])).toBe(true)
    Expect(shouldStreamJustOutput(['prep'])).toBe(false)
  })

  Test('formats quiet success summaries with parsed test counts', () => {
    Expect(parseJustSuccessSummary(' 27 pass\n 0 fail\nTests: 12 passed, 12 total\n')).toBe('39 tests passed')
    Expect(formatJustSuccessLine(['test'], 'Tests: 12 passed, 12 total', 1_234))
      .toBe('[just]: test ok in 1.2s (12 tests passed)')
  })
})

Describe('agent artifact helpers', () => {
  Test('creates sortable run ids with a random suffix', () => {
    Expect(formatArtifactRunId(new Date(2026, 5, 6, 2, 55, 55, 123))).toMatch(
      /^20260606-025555\.123-[a-z0-9]{6}$/,
    )
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

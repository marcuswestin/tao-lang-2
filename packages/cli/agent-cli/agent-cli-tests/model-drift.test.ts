import { Describe, Expect, Test } from '@shared/test'
import { modelDriftWarnings } from '../agent-cli-src/delegation/ModelDrift'

const nowMs = Date.parse('2026-09-24T17:00:00Z')
const configured = {
  claudeVersion: '2.1.280',
  codexDefault: 'gpt-6-sol',
  configuredOpus: 'claude-opus-5-5',
  nowMs,
}

Describe('model drift', () => {
  Test('stays quiet for missing or stale model metadata', () => {
    Expect(modelDriftWarnings(configured)).toEqual([])
    Expect(modelDriftWarnings({
      ...configured,
      cache: { fetchedAt: '2026-09-01T00:00:00Z', models: ['gpt-5.6-terra'] },
    })).toEqual([])
    Expect(modelDriftWarnings({
      ...configured,
      cache: { fetchedAt: '2026-09-24T16:00:00Z' },
    })).toEqual([])
  })

  Test('warns for a missing default only with a fresh local catalog', () => {
    Expect(
      modelDriftWarnings({
        ...configured,
        cache: { fetchedAt: '2026-09-24T16:00:00Z', models: ['gpt-6-luna'] },
      })[0],
    ).toContain('gpt-6-sol is absent')
  })

  Test('warns when an installed Claude Code cannot run standard or deep subagents', () => {
    Expect(modelDriftWarnings({ ...configured, claudeVersion: '2.1.267' })[0])
      .toContain('standard and deep Claude Code subagents')
  })
})

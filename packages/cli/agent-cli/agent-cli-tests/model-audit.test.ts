import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import {
  auditModelRouting,
  compareVersions,
  type ModelAuditOptions,
  parseClaudeModelId,
  parseCodexModelId,
} from '../agent-cli-src/delegation/ModelAudit'
import { ModelAuditCommand } from '../agent-cli-src/delegation/ModelAuditCommand'

const SKILL_SOURCE = [
  '| Tier     | Claude Code `model` | Codex CLI `model` | Cursor `model`     |',
  '| -------- | ------------------- | ----------------- | ------------------ |',
  '| fast     | `haiku`             | `gpt-6-luna`      | `composer-2.5`     |',
  '| standard | `opus`              | `gpt-6-sol`       | `claude-opus-5-5`  |',
  '| deep     | `opus`              | `gpt-6-sol`       | `claude-opus-5-5`  |',
  '| frontier | `fable`             | `gpt-6-astra`     | `claude-fable-5-1` |',
].join('\n')

const NOW_MS = Date.parse('2026-09-23T12:00:00Z')
const FRESH = '2026-09-23T08:00:00Z'
const CHECKOUT = '/work/tao'
const CATALOG = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']

// Each line gets its own message and request id, so two lines are one response only when a test
// reuses them on purpose.
let ordinal = 0

function assistantLine(options: {
  cacheRead?: number
  cwd?: string
  entrypoint?: string
  id?: string
  input?: number
  model: string
  requestId?: string
  timestamp: string
  version?: string
}): string {
  ordinal += 1
  return JSON.stringify({
    cwd: options.cwd ?? CHECKOUT,
    entrypoint: options.entrypoint ?? 'cli',
    message: {
      id: options.id ?? `msg-${ordinal}`,
      model: options.model,
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: options.cacheRead ?? 0,
        input_tokens: options.input ?? 0,
      },
    },
    requestId: options.requestId ?? `req-${ordinal}`,
    timestamp: options.timestamp,
    type: 'assistant',
    version: options.version ?? '2.1.281',
  })
}

function compactionLine(trigger: string, preTokens: number, timestamp: string, cwd = CHECKOUT): string {
  ordinal += 1
  return JSON.stringify({
    compactMetadata: { postTokens: 1000, preTokens, trigger },
    cwd,
    subtype: 'compact_boundary',
    timestamp,
    type: 'system',
    uuid: `boundary-${ordinal}`,
  })
}

type Fixture = { claudeDir: string; codexHome: string; repoRoot: string }

type Catalog = {
  clientVersion?: string
  fetchedAt?: string | undefined
  hidden?: readonly string[]
  slugs: readonly string[]
}

/** fixture writes a routing table and a Codex catalog; `null` leaves the catalog out. */
async function fixture(catalog: Catalog | null = { fetchedAt: FRESH, slugs: CATALOG }): Promise<Fixture> {
  const repoRoot = await mkTestDir('model-audit-repo-')
  await FS.writeText(FS.resolvePath('agents/skills/delegation/SKILL.md', repoRoot), SKILL_SOURCE)
  const codexHome = await mkTestDir('model-audit-codex-')
  if (catalog !== null) {
    await FS.writeJson(FS.resolvePath('models_cache.json', codexHome), {
      ...(catalog.clientVersion === undefined ? {} : { client_version: catalog.clientVersion }),
      ...(catalog.fetchedAt === undefined ? {} : { fetched_at: catalog.fetchedAt }),
      models: [
        ...catalog.slugs.map(slug => ({ slug, visibility: 'list' })),
        ...(catalog.hidden ?? []).map(slug => ({ slug, visibility: 'hide' })),
      ],
    })
  }
  return { claudeDir: await mkTestDir('model-audit-claude-'), codexHome, repoRoot }
}

async function writeSession(claudeDir: string, session: string, lines: readonly string[]): Promise<string> {
  const path = FS.resolvePath(`projects/proj/${session}.jsonl`, claudeDir)
  await FS.writeText(path, lines.join('\n'))
  return path
}

/** writeSubagent writes a subagent transcript, under `subagents/` or a workflow directory beneath it. */
async function writeSubagent(
  claudeDir: string,
  agentId: string,
  lines: readonly string[],
  within = '',
): Promise<void> {
  await FS.writeText(
    FS.resolvePath(`projects/proj/session/subagents/${within}agent-${agentId}.jsonl`, claudeDir),
    lines.join('\n'),
  )
}

function options(paths: Fixture, overrides: Partial<ModelAuditOptions> = {}): ModelAuditOptions {
  return { ...paths, checkoutRoots: [CHECKOUT], days: 7, nowMs: NOW_MS, ...overrides }
}

Describe('model audit — id parsing', () => {
  Test('reads a Claude id as a family and a version tuple, dropping a trailing date', () => {
    Expect(parseClaudeModelId('claude-opus-5')).toEqual({ family: 'opus', id: 'claude-opus-5', version: [5] })
    Expect(parseClaudeModelId('claude-opus-5-5')?.version).toEqual([5, 5])
    Expect(parseClaudeModelId('claude-haiku-4-5-20251001')?.version).toEqual([4, 5])
  })

  Test('rejects an alias and the synthetic marker', () => {
    Expect(parseClaudeModelId('<synthetic>')).toBeUndefined()
    Expect(parseClaudeModelId('claude-opus')).toBeUndefined()
    Expect(parseClaudeModelId('opus')).toBeUndefined()
  })

  Test('orders version tuples the way a missing trailing component reads', () => {
    Expect(compareVersions([5], [5, 5])).toBeLessThan(0)
    Expect(compareVersions([5, 5], [5])).toBeGreaterThan(0)
    Expect(compareVersions([5, 0], [5])).toEqual(0)
  })

  Test('reads a Codex slug as prefix, version tuple, and name, and rejects one without all three', () => {
    Expect(parseCodexModelId('gpt-5.6-sol')).toEqual({
      id: 'gpt-5.6-sol',
      name: 'sol',
      prefix: 'gpt',
      version: [5, 6],
    })
    Expect(parseCodexModelId('gpt-5.10-sol')?.version).toEqual([5, 10])
    Expect(parseCodexModelId('gpt-reserve')).toBeUndefined()
    Expect(parseCodexModelId('gpt-5.5')).toBeUndefined()
  })
})

Describe('model audit — codex column', () => {
  Test('reports nothing when the catalog offers every id and nothing newer', async () => {
    const report = await auditModelRouting(options(await fixture()))

    Expect(report.findings).toEqual([])
    Expect(report.notes).toEqual([])
  })

  Test('reports an id superseded by a higher version of the same prefix and name', async () => {
    const report = await auditModelRouting(
      options(await fixture({ slugs: ['gpt-7-astra', 'gpt-6-sol', 'gpt-6-luna'] })),
    )

    Expect(report.findings).toEqual([
      "codex tier frontier names 'gpt-6-astra', superseded by 'gpt-7-astra' in the installed catalog",
    ])
  })

  Test('orders a two-digit minor version after a one-digit one', async () => {
    const paths = await fixture({ slugs: ['gpt-6-astra', 'gpt-6-sol', 'gpt-5.9-luna', 'gpt-5.10-luna'] })
    await FS.writeText(
      FS.resolvePath('agents/skills/delegation/SKILL.md', paths.repoRoot),
      SKILL_SOURCE.replace('`gpt-6-luna`', '`gpt-5.9-luna`'),
    )

    Expect((await auditModelRouting(options(paths))).findings).toEqual([
      "codex tier fast names 'gpt-5.9-luna', superseded by 'gpt-5.10-luna' in the installed catalog",
    ])
  })

  Test('reports concrete Sol defaults that lag the newest GPT-6 Sol release', async () => {
    const report = await auditModelRouting(
      options(await fixture({ slugs: [...CATALOG, 'gpt-6.1-sol'] })),
    )

    Expect(report.findings).toEqual([
      "codex tiers standard, deep name 'gpt-6-sol', superseded by 'gpt-6.1-sol' in the installed catalog",
    ])
  })

  Test('never takes a hidden slug for a newer model', async () => {
    const report = await auditModelRouting(options(await fixture({ hidden: ['gpt-7-astra'], slugs: CATALOG })))

    Expect(report.findings).toEqual([])
  })

  Test('notes an id a fresh catalog lacks, naming the Codex that fetched it, instead of a finding', async () => {
    // Every Codex install on a machine rewrites the one catalog with what its own version is offered,
    // so an older install's list can lack a model the newer one runs.
    const report = await auditModelRouting(
      options(await fixture({ clientVersion: '0.154.0', fetchedAt: FRESH, slugs: ['gpt-6-astra', 'gpt-6-luna'] })),
    )

    Expect(report.findings).toEqual([])
    Expect(report.notes).toEqual([
      "codex tiers standard, deep name 'gpt-6-sol', missing from the catalog Codex 0.154.0 last fetched, which "
      + 'every Codex install on this machine rewrites with its own offer',
    ])
  })

  Test('leaves a missing id unreported when the catalog is stale or undated, and says so', async () => {
    for (const fetchedAt of ['2026-09-01T00:00:00Z', undefined]) {
      const report = await auditModelRouting(options(await fixture({ fetchedAt, slugs: ['gpt-6-astra'] })))

      Expect(report.findings).toEqual([])
      Expect(report.notes[0]).toContain('undated or more than three days old')
    }
  })

  Test('notes a missing catalog instead of raising a finding', async () => {
    const report = await auditModelRouting(options(await fixture(null)))

    Expect(report.findings).toEqual([])
    Expect(report.notes[0]).toContain('no Codex model catalog')
  })
})

Describe('model audit — claude columns', () => {
  Test('reports an entrypoint whose latest request in an aliased family ran behind another install', async () => {
    const paths = await fixture()
    await writeSession(paths.claudeDir, 'homebrew', [
      assistantLine({ model: 'claude-opus-5', timestamp: '2026-09-22T10:00:00Z', version: '2.1.267' }),
      assistantLine({ model: 'claude-opus-5', timestamp: '2026-09-22T10:05:00Z', version: '2.1.267' }),
    ])
    await writeSession(paths.claudeDir, 'desktop', [
      assistantLine({ entrypoint: 'claude-desktop', model: 'claude-opus-5-5', timestamp: '2026-09-22T09:00:00Z' }),
    ])

    const report = await auditModelRouting(options(paths))

    Expect(report.findings).toEqual([
      "claude tiers standard, deep name 'opus', but Claude Code 2.1.267 (cli) last ran 'claude-opus-5', "
      + "behind 'claude-opus-5-5'",
    ])
  })

  Test('reports nothing for an entrypoint that has since updated to the newer model', async () => {
    const paths = await fixture()
    await writeSession(paths.claudeDir, 'session', [
      assistantLine({ model: 'claude-opus-5', timestamp: '2026-09-21T10:00:00Z', version: '2.1.275' }),
      assistantLine({ model: 'claude-opus-5-5', timestamp: '2026-09-22T10:00:00Z', version: '2.1.281' }),
    ])

    Expect((await auditModelRouting(options(paths))).findings).toEqual([])
  })

  Test('reports nothing for an older model chosen by name on a version that ran the newer one', async () => {
    const paths = await fixture()
    await writeSession(paths.claudeDir, 'default', [
      assistantLine({ model: 'claude-opus-5-5', timestamp: '2026-09-22T09:00:00Z', version: '2.1.281' }),
    ])
    await writeSession(paths.claudeDir, 'chosen', [
      assistantLine({ model: 'claude-opus-5', timestamp: '2026-09-22T10:00:00Z', version: '2.1.281' }),
    ])

    Expect((await auditModelRouting(options(paths))).findings).toEqual([])
  })

  Test('ignores a transcript untouched since before the window, by its modified time', async () => {
    const paths = await fixture()
    const old = await writeSession(paths.claudeDir, 'old', [
      assistantLine({ model: 'claude-opus-5', timestamp: '2026-09-22T10:00:00Z' }),
    ])
    await FS.setModifiedTimeMs(old, Date.parse('2020-01-01T00:00:00Z'))
    await writeSession(paths.claudeDir, 'new', [
      assistantLine({ entrypoint: 'claude-desktop', model: 'claude-opus-5-5', timestamp: '2026-09-22T11:00:00Z' }),
    ])

    Expect((await auditModelRouting(options(paths))).findings).toEqual([])
  })

  Test('ignores the synthetic model', async () => {
    const paths = await fixture()
    await writeSession(paths.claudeDir, 'session', [
      assistantLine({ model: '<synthetic>', timestamp: '2026-09-22T10:00:00Z' }),
    ])

    Expect((await auditModelRouting(options(paths))).findings).toEqual([])
  })

  Test('reports a full Claude id behind a newer model of its family that this machine ran', async () => {
    const paths = await fixture()
    await writeSession(paths.claudeDir, 'session', [
      assistantLine({ model: 'claude-opus-6', timestamp: '2026-09-22T10:00:00Z' }),
    ])

    Expect((await auditModelRouting(options(paths))).findings).toEqual([
      "cursor tiers standard, deep name 'claude-opus-5-5', behind 'claude-opus-6', which this machine ran",
    ])
  })
})

Describe('model audit — brief', () => {
  Test('looks back one day whatever the window, and carries no measurements', async () => {
    const paths = await fixture()
    await writeSession(paths.claudeDir, 'old', [
      assistantLine({ model: 'claude-opus-5', timestamp: '2026-09-19T10:00:00Z', version: '2.1.267' }),
    ])
    await writeSession(paths.claudeDir, 'new', [
      assistantLine({ entrypoint: 'claude-desktop', model: 'claude-opus-5-5', timestamp: '2026-09-23T10:00:00Z' }),
    ])

    const full = await auditModelRouting(options(paths, { days: 30 }))
    const brief = await auditModelRouting(options(paths, { brief: true, days: 30 }))

    Expect(full.findings.length).toEqual(1)
    Expect(brief.findings).toEqual([])
    Expect(brief.windowDays).toEqual(1)
    Expect(brief.info).toBeUndefined()
  })

  Test('reads only the tail of a long transcript', async () => {
    const paths = await fixture()
    await writeSession(paths.claudeDir, 'session', [
      // Inside the one-day window by timestamp; only its place before 300KB of padding keeps it out
      // of the brief scan's 256KB tail.
      assistantLine({ model: 'claude-opus-5', timestamp: '2026-09-22T13:00:00Z', version: '2.1.267' }),
      `padding ${'x'.repeat(300 * 1024)}`,
      assistantLine({ entrypoint: 'claude-desktop', model: 'claude-opus-5-5', timestamp: '2026-09-23T09:00:00Z' }),
    ])

    Expect((await auditModelRouting(options(paths))).findings.length).toEqual(1)
    Expect((await auditModelRouting(options(paths, { brief: true }))).findings).toEqual([])
  })
})

Describe('model audit — checkout measurements', () => {
  Test('measures context per request for this checkout only, counting a response once', async () => {
    const paths = await fixture()
    await FS.writeText(
      FS.resolvePath('.rulesync/permissions.jsonc', paths.repoRoot),
      '{\n  // jsonc\n  "claudecode": { "autoCompactWindow": 1000 },\n}\n',
    )
    await writeSession(paths.claudeDir, 'session', [
      assistantLine({
        cacheRead: 900,
        id: 'm1',
        input: 200,
        model: 'claude-opus-5-5',
        requestId: 'r1',
        timestamp: '2026-09-22T10:00:00Z',
      }),
      assistantLine({
        cacheRead: 900,
        id: 'm1',
        input: 200,
        model: 'claude-opus-5-5',
        requestId: 'r1',
        timestamp: '2026-09-22T10:00:01Z',
      }),
      assistantLine({ cacheRead: 200, input: 100, model: 'claude-opus-5-5', timestamp: '2026-09-22T10:01:00Z' }),
      assistantLine({ cacheRead: 500, cwd: '/elsewhere', model: 'claude-opus-5-5', timestamp: '2026-09-22T10:02:00Z' }),
    ])
    await writeSubagent(paths.claudeDir, 'a1', [
      assistantLine({
        cacheRead: 50,
        cwd: `${CHECKOUT}/packages`,
        model: 'claude-opus-5-5',
        timestamp: '2026-09-22T10:03:00Z',
      }),
    ])

    const info = (await auditModelRouting(options(paths))).info

    Expect(info?.context.main).toEqual({ count: 2, max: 1100, p50: 300, p90: 1100 })
    Expect(info?.context.subagents).toEqual({ count: 1, max: 50, p50: 50, p90: 50 })
    Expect(info?.autoCompactWindow).toEqual(1000)
    Expect(info?.context.overAutoCompactWindow).toEqual(1)
  })

  Test('counts a transcript under a workflow directory as a subagent', async () => {
    const paths = await fixture()
    await writeSubagent(paths.claudeDir, 'w1', [
      assistantLine({ cacheRead: 70, model: 'claude-opus-5-5', timestamp: '2026-09-22T10:00:00Z' }),
    ], 'workflows/wf_1/')

    Expect((await auditModelRouting(options(paths))).info?.context.subagents).toEqual({
      count: 1,
      max: 70,
      p50: 70,
      p90: 70,
    })
  })

  Test('counts compactions by trigger with the context each began from', async () => {
    const paths = await fixture()
    await writeSession(paths.claudeDir, 'session', [
      compactionLine('auto', 270_000, '2026-09-22T10:00:00Z'),
      compactionLine('manual', 150_000, '2026-09-22T11:00:00Z'),
      compactionLine('auto', 900_000, '2026-09-22T12:00:00Z', '/elsewhere'),
    ])

    const info = (await auditModelRouting(options(paths))).info

    Expect(info?.compactions).toEqual({
      auto: 1,
      manual: 1,
      preTokens: { count: 2, max: 270_000, p50: 150_000, p90: 270_000 },
    })
    Expect(info?.autoCompactWindow).toBeUndefined()
  })

  Test('ends the window where asked, to measure the period before a change', async () => {
    const paths = await fixture()
    await writeSession(paths.claudeDir, 'session', [
      assistantLine({ input: 100, model: 'claude-opus-5-5', timestamp: '2026-09-20T10:00:00Z' }),
      assistantLine({ input: 900, model: 'claude-opus-5-5', timestamp: '2026-09-22T10:00:00Z' }),
    ])

    const report = await auditModelRouting(options(paths, { days: 2, untilMs: Date.parse('2026-09-21T00:00:00Z') }))

    Expect(report.sinceIso).toEqual('2026-09-19T00:00:00.000Z')
    Expect(report.untilIso).toEqual('2026-09-21T00:00:00.000Z')
    Expect(report.info?.context.main).toEqual({ count: 1, max: 100, p50: 100, p90: 100 })
  })
})

Describe('model audit — personal subagent default', () => {
  Test('reports a different personal default in brief and full reports without exposing other settings', async () => {
    const paths = await fixture()
    const configPath = FS.resolvePath('config.toml', paths.codexHome)
    const config = '[agents]\ndefault_subagent_model = "gpt-5.6-luna"\nprivate_setting = "fixture-private-value"\n'
    await FS.writeText(configPath, config)

    for (const brief of [false, true]) {
      const report = await ModelAuditCommand.audit(options(paths, { brief }))
      Expect(report.findings).toEqual([
        "personal Codex subagent default names 'gpt-5.6-luna', differing from repository standard 'gpt-6-sol'",
      ])
      const output = await withCapturedOutput(() => ModelAuditCommand.write(report, { brief, json: !brief }))
      Expect(output.stdout).toContain('gpt-5.6-luna')
      Expect(output.stdout).not.toContain('fixture-private-value')
      Expect(output.stdout).not.toContain('private_setting')
    }
    Expect(await FS.readText(configPath)).toEqual(config)
  })

  Test('stays quiet when a personal default matches or inherits the repository default', async () => {
    const paths = await fixture()
    Expect((await ModelAuditCommand.audit(options(paths))).findings).toEqual([])
    for (
      const config of [
        '[agents]\ndefault_subagent_model = "gpt-6-sol"\n',
        '[agents]\nmax_threads = 4\n',
        'default_subagent_model = "gpt-5.6-luna"\n[other]\ndefault_subagent_model = "gpt-5.6-luna"\n',
      ]
    ) {
      await FS.writeText(FS.resolvePath('config.toml', paths.codexHome), config)
      const report = await ModelAuditCommand.audit(options(paths, { brief: true }))
      Expect(report.findings).toEqual([])
      Expect(report.notes).toEqual([])
      const output = await withCapturedOutput(() => ModelAuditCommand.write(report, { brief: true }))
      Expect(output.stdout).toEqual('')
    }
  })

  Test('contains malformed personal configuration without printing its contents', async () => {
    const paths = await fixture()
    await FS.writeText(
      FS.resolvePath('config.toml', paths.codexHome),
      '[agents]\nprivate_setting = "fixture-private-value',
    )
    const report = await ModelAuditCommand.audit(options(paths))

    Expect(report.findings).toEqual([])
    Expect(report.notes).toEqual([
      'personal Codex configuration could not be read; its subagent default was not compared',
    ])
    const output = await withCapturedOutput(() => ModelAuditCommand.write(report, { json: true }))
    Expect(output.stdout).not.toContain('fixture-private-value')
  })

  Test('does not reflect invalid default values into findings or notes', async () => {
    const paths = await fixture()
    for (const value of ['42', '"fixture-private-value\\nother"']) {
      await FS.writeText(
        FS.resolvePath('config.toml', paths.codexHome),
        `[agents]\ndefault_subagent_model = ${value}\n`,
      )
      const report = await ModelAuditCommand.audit(options(paths))

      Expect(report.findings).toEqual([])
      Expect(report.notes).toEqual(['personal Codex subagent default is not a model ID; it was not compared'])
    }
  })
})

Describe('model audit — command output', () => {
  const report = {
    findings: ["codex tier frontier names 'gpt-6-astra', superseded by 'gpt-7-astra' in the installed catalog"],
    info: {
      autoCompactWindow: 272_000,
      compactions: { auto: 2, manual: 0, preTokens: { count: 2, max: 271_000, p50: 268_000, p90: 271_000 } },
      context: {
        main: { count: 10, max: 300_000, p50: 90_000, p90: 250_000 },
        overAutoCompactWindow: 1,
        subagents: { count: 0, max: 0, p50: 0, p90: 0 },
      },
    },
    notes: [],
    sinceIso: '2026-09-16T12:00:00.000Z',
    untilIso: '2026-09-23T12:00:00.000Z',
    windowDays: 7,
  }

  Test('prints one line under brief only when there is a finding', async () => {
    const quiet = await withCapturedOutput(() => ModelAuditCommand.write({ ...report, findings: [] }, { brief: true }))
    const notice = await withCapturedOutput(() => ModelAuditCommand.write(report, { brief: true }))

    Expect(quiet.stdout).toEqual('')
    Expect(notice.stdout).toEqual(
      `Model routing may be behind this machine: ${report.findings[0]}. Run ./agent model-audit and tell the `
        + 'Developer; do not change the routing table unasked.\n',
    )
  })

  Test('prints findings and the checkout measurements in the full report', async () => {
    const output = await withCapturedOutput(() => ModelAuditCommand.write(report, {}))

    Expect(output.stdout).toContain(`- ${report.findings[0]}.`)
    Expect(output.stdout).toContain('context per main-session request: p50 90000, p90 250000, max 300000 over 10')
    Expect(output.stdout).toContain('context per subagent request: none')
    Expect(output.stdout).toContain('requests over the 272000 autoCompactWindow: 1')
    Expect(output.stdout).toContain('compactions: 2 automatic, 0 manual')
  })
})

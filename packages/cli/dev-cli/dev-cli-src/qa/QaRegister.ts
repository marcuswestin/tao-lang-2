import { CLI, Errors, FS, HCI, Platform, ReleaseCapabilities } from '@shared'
import { type QaDimension, QaInventory, type QaInventoryData, type QaReviewer, type QaSurface } from './QaInventory'

type Outcome = 'not-run' | 'pass' | 'friction' | 'fail' | 'blocked'
type Snapshot = Pick<QaSurface, 'sourceHash' | 'rendererHash' | 'profileHash'>
type Observation = Snapshot & {
  id: string
  runId: string
  createdAt: string
  recordedAt: string
  commit: string
  phase: number
  executionProfile: 'development' | number
  environment: { platform: string; architecture: string; runtime: string }
  inputs: { source: string; dependencySnapshot: string }
  artifact?: { version: string; digest: string; sourceCommit: string }
  provenance: {
    snapshotBasis: 'import-time' | 'observation-time'
    originalDependencies: 'unknown' | 'recorded'
    observedMetadataEvidence: string[]
  }
  surfaceId: string
  dimension: QaDimension
  outcome: Outcome
  channel: string
  reviewer: QaReviewer
  evidence: { path: string; sha256: string }[]
  notes: string
}
type Run = {
  id: string
  createdAt: string
  phase: number
  scope: 'changed' | 'all'
  inventory: QaInventoryData
  selected: string[]
}
type Finding = {
  id: string
  surfaceId: string
  dimension: QaDimension
  channel: string
  phase: number
  severity: 'blocking' | 'major' | 'minor'
  title: string
  observed: string
  impact: string
  location: string
  affectedPhases: number[]
  evidence: string[]
  /** evidenceHashes pins what the finding saw, so a closing recheck cannot cite the same bytes. */
  evidenceHashes?: { path: string; sha256: string }[]
  expected: string
  recheck: string
  status: 'open' | 'triaged' | 'fixed-awaiting-qa' | 'verified-closed' | 'accepted-limitation' | 'duplicate'
  confidence: 'confirmed' | 'suspected' | 'design-judgment'
  requiredReviewer?: QaReviewer
  relatedStories?: string[]
  notes?: string
  repro?: string
  owner?: string
  existingIssue?: string
  duplicateOf?: string
  passingResultId?: string
  createdAt: string
  updatedAt: string
  baseline?: string
}
type Options = { phase?: string; scope?: string; resume?: string; file?: string }

/** QaRegister stores immutable runs and observations, and derives current coverage from evidence. */
export class QaRegister {
  constructor(private readonly root: string) {}

  async command(action: string, options: Options): Promise<void> {
    const handlers: Record<string, () => Promise<unknown>> = {
      inventory: async () => {
        const result = await this.inventory(Number(options.phase ?? 1))
        return {
          path: 'Docs/QA/inventory.json',
          documents: result.surfaces.filter(surface => surface.kind === 'document').length,
          stories: 49,
          exclusions: result.exclusions.length,
        }
      },
      run: () => this.run(Number(options.phase ?? 1), options.scope ?? 'changed', options.resume),
      report: () => this.report(Number(options.phase ?? 1)),
      record: () => this.recordFile(options.file),
      finding: () => this.findingFile(options.file),
    }
    const handler = Object.hasOwn(handlers, action) ? handlers[action] : undefined
    if (!handler) {
      Errors.throwUserInput('QA action must be inventory, run, report, record, or finding.')
    }
    HCI.writeLine(JSON.stringify(await handler(), null, 2))
  }

  async inventory(phase: number): Promise<QaInventoryData> {
    const inventory = await new QaInventory(this.root).build(phase)
    await this.atomic('Docs/QA/inventory.json', inventory)
    const coverage: Record<string, string> = {
      core: 'CLI2, CLI3, CLI5, CLI6, DOC1, APP1, APP2',
      'http-data': 'acceptance:http-and-multiple-data',
      'ios-simulator': 'CLI4, APP2',
      'advanced-design': 'acceptance:advanced-design',
      studio: 'STU1–STU9',
      companion: 'COM1–COM6',
      cloudkit: 'acceptance:cloudkit-private-sync',
      ship: 'APP4, APP5',
    }
    const rows = Object.entries(ReleaseCapabilities.catalog).map(([id, entry]) =>
      `| ${id} | ${entry.label} | ${entry.phase} | ${
        entry.phase === 'development'
          ? 'Internal development only'
          : [1, 2, 3, 4, 5].filter(phase => phase >= Number(entry.phase)).join(', ')
      } | ${coverage[id] ?? 'Deferred beyond phase 5'} |`
    )
    await this.atomic(
      'Docs/QA/capabilities.md',
      `# Release capability coverage\n\nGenerated from the shared capability catalog. Available means eligible in the profile, not behavior accepted. Read the matching release packet for actual unrun, blocked and stale obligations. Channel prerequisites remain in the inventory and staged release plan.\n\n| Capability | Label | Introduced | Available phases | Acceptance subjects |\n| --- | --- | --- | --- | --- |\n${
        rows.join('\n')
      }\n`,
    )
    return inventory
  }

  async run(
    phase: number,
    scope: string,
    resume?: string,
  ): Promise<{ runId: string; selected: number; message: string }> {
    if (scope !== 'changed' && scope !== 'all') {
      Errors.throwUserInput('QA scope must be changed or all.')
    }
    const current = await new QaInventory(this.root).build(phase)
    const observations = await this.observations()
    const findings = await this.findings()
    const findingSurfaces = new Set<string>()
    for (const finding of findings) {
      if (
        !['verified-closed', 'duplicate'].includes(finding.status)
        || await this.closureStale(finding, current.surfaces, observations)
      ) {
        findingSurfaces.add(finding.surfaceId)
      }
    }
    let run: Run
    if (resume) {
      this.validId(resume)
      run = await FS.readJson<Run>(this.path(`.artifacts/qa/runs/${resume}/manifest.json`))
      if (run.phase !== phase || run.scope !== scope) {
        Errors.throwUserInput('Resume must retain the original phase and scope.')
      }
      for (const id of run.selected) {
        const before = run.inventory.surfaces.find(surface => surface.id === id)
        const now = current.surfaces.find(surface => surface.id === id)
        if (!before || !now || !sameSnapshot(before, now)) {
          Errors.throwUserInput(`Cannot resume changed source ${id}; start a new run.`)
        }
      }
    } else {
      const selected: QaSurface[] = []
      for (
        const surface of current.surfaces.filter(surface => typeof surface.phase === 'number' && surface.phase <= phase)
      ) {
        if (
          scope === 'all' || findingSurfaces.has(surface.id)
          || !await this.fullyReviewed(surface, observations, phase)
        ) {
          selected.push(surface)
        }
      }
      run = {
        id: this.newId(),
        createdAt: new Date().toISOString(),
        phase,
        scope,
        inventory: current,
        selected: selected.map(surface => surface.id),
      }
      await this.atomic(`.artifacts/qa/runs/${run.id}/manifest.json`, run, true)
    }
    const dir = `.artifacts/qa/runs/${run.id}`
    await FS.withFileMutationLock(this.path(`${dir}/execution`), this.root, async () => {
      if (!await FS.exists(this.path(`${dir}/links.json`))) {
        const links = await this.checkLinks(
          run.inventory.surfaces.filter(surface => run.selected.includes(surface.id) && surface.kind === 'document'),
        )
        await this.atomic(`${dir}/links.json`, links, true)
      }
      if (run.selected.includes('story:DOC1') && !await FS.exists(this.path(`${dir}/tutorial.json`))) {
        const result = await CLI.run('./agent', {
          args: ['test-file', 'packages/cli/tao-cli/cli-tests/tutorials.test.ts'],
          cwd: this.root,
          processPolicy: 'test',
          timeoutMs: 600_000,
          idleOutputMs: 120_000,
        })
        const log = `${dir}/tutorial.log`
        await FS.writeText(this.path(log), `${result.stdout}\n${result.stderr}`)
        await this.atomic(`${dir}/tutorial.json`, {
          command: './agent test-file packages/cli/tao-cli/cli-tests/tutorials.test.ts',
          outcome: result.exitCode === 0 ? 'pass' : CLI.isSandboxDenial(result) ? 'blocked' : 'fail',
          evidence: log,
          scope: 'source tests only; no text, visual, installed artifact, or human acceptance',
        }, true)
      }
      if (!await FS.exists(this.path(`${dir}/checks-complete.json`))) {
        await this.atomic(`${dir}/checks-complete.json`, {
          completedAt: new Date().toISOString(),
          review: 'not-run until explicit observations are recorded',
        }, true)
      }
    })
    return {
      runId: run.id,
      selected: run.selected.length,
      message:
        'Bounded checks saved. Text, visual, and journey acceptance require explicit qa record observations. Resume preserves finished checks.',
    }
  }

  async recordFile(file?: string): Promise<Observation> {
    const input = await this.input(file)
    const runId = this.string(input, 'runId')
    this.validId(runId)
    const run = await FS.readJson<Run>(this.path(`.artifacts/qa/runs/${runId}/manifest.json`))
    const surfaceId = this.string(input, 'surfaceId')
    const surface = run.inventory.surfaces.find(item => item.id === surfaceId)
    if (!surface || !run.selected.includes(surfaceId)) {
      Errors.throwUserInput('Observation surface must belong to the selected run.')
    }
    const current = (await new QaInventory(this.root).build(run.phase)).surfaces.find(item => item.id === surfaceId)
    if (!current || !sameSnapshot(current, surface)) {
      Errors.throwUserInput('Run source, renderer, or release profile changed; start a new run before recording.')
    }
    const dimension = this.choice(input, 'dimension', ['functional', 'visual', 'text'] as const)
    if (!surface.dimensions.includes(dimension)) {
      Errors.throwUserInput('Dimension does not apply to this surface.')
    }
    const outcome = this.choice(input, 'outcome', ['not-run', 'pass', 'friction', 'fail', 'blocked'] as const)
    const reviewer = this.choice(input, 'reviewer', ['agent', 'human', 'developer'] as const)
    const channel = this.string(input, 'channel')
    if (![...(surface.dimensionChannels[dimension] ?? []), 'source-test', 'browser-preview'].includes(channel)) {
      Errors.throwUserInput('Channel is not declared for this surface and dimension.')
    }
    const evidencePaths = this.strings(input, 'evidence')
    if (outcome !== 'not-run' && evidencePaths.length === 0) {
      Errors.throwUserInput('Reviewed outcomes require linked evidence; absence cannot pass.')
    }
    const evidence = await Promise.all(
      evidencePaths.map(async path => ({ path, sha256: await this.evidenceHash(path) })),
    )
    if (dimension === 'visual' && outcome === 'pass') {
      await this.requireInspectedCapture(evidence, reviewer)
    }
    if (input['historical'] !== undefined && typeof input['historical'] !== 'boolean') {
      Errors.throwUserInput('historical must be a boolean.')
    }
    const now = new Date().toISOString()
    const observedAt = input['historical'] === true ? this.string(input, 'observedAt') : now
    const commit = input['historical'] === true ? this.string(input, 'commit') : run.inventory.commit
    if (
      !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > Date.now()
      || !/^[a-f0-9]{7,40}$/u.test(commit)
    ) {
      Errors.throwUserInput(
        'Historical observations require a valid past observedAt timestamp and original hexadecimal commit.',
      )
    }
    const executionProfile = input['executionProfile'] ?? 'development'
    if (executionProfile !== 'development' && ![1, 2, 3, 4, 5].includes(executionProfile as number)) {
      Errors.throwUserInput('executionProfile must be development or release phase 1 through 5.')
    }
    let artifact: Observation['artifact']
    if (input['artifact'] !== undefined) {
      const value = input['artifact']
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        Errors.throwUserInput('Artifact must be an object with version, digest and sourceCommit.')
      }
      const identity = value as Record<string, unknown>
      artifact = {
        version: this.string(identity, 'version'),
        digest: this.string(identity, 'digest'),
        sourceCommit: this.string(identity, 'sourceCommit'),
      }
      if (!/^[a-f0-9]{64}$/u.test(artifact.digest) || artifact.sourceCommit !== run.inventory.commit) {
        Errors.throwUserInput('Artifact must name its SHA-256 digest and the frozen candidate commit.')
      }
      if (run.inventory.dirty) {
        Errors.throwUserInput(
          'This run inventoried uncommitted inputs, so no artifact can be built from its candidate commit. Commit, then start a new run.',
        )
      }
    }
    if (
      outcome === 'pass' && (surface.kind === 'story' || surface.kind === 'obligation') && dimension !== 'text'
      && !['source-test', 'browser-preview', 'public-docs'].includes(channel)
      && (executionProfile !== run.phase || !artifact)
    ) {
      Errors.throwUserInput(
        'Release acceptance needs an artifact identity built for the selected release phase; development-source evidence is supplementary.',
      )
    }
    const dependencySnapshot = `Docs/QA/inputs/${Platform.sha256Hex(JSON.stringify(run.inventory.dependencies))}.json`
    if (!await FS.exists(this.path(dependencySnapshot))) {
      await this.atomic(dependencySnapshot, run.inventory.dependencies)
    }
    const observation: Observation = {
      id: this.newId(),
      runId,
      createdAt: observedAt,
      recordedAt: now,
      commit,
      phase: run.phase,
      executionProfile: executionProfile as 'development' | number,
      provenance: {
        snapshotBasis: input['historical'] === true ? 'import-time' : 'observation-time',
        originalDependencies: input['historical'] === true ? 'unknown' : 'recorded',
        observedMetadataEvidence: evidencePaths,
      },
      environment: {
        platform: Platform.hostPlatform,
        architecture: Platform.hostArch,
        runtime: `bun:${Platform.runtimeBunVersion ?? 'unknown'}`,
      },
      inputs: { source: surface.source, dependencySnapshot },
      ...(artifact ? { artifact } : {}),
      surfaceId,
      dimension,
      outcome,
      reviewer,
      channel,
      evidence,
      notes: this.string(input, 'notes'),
      sourceHash: input['historical'] === true ? `historical:${surface.sourceHash}` : surface.sourceHash,
      rendererHash: surface.rendererHash,
      profileHash: surface.profileHash,
    }
    await this.atomic(`Docs/QA/results/${observation.id}.json`, observation, true)
    return observation
  }

  async findingFile(file?: string): Promise<Finding> {
    const input = await this.input(file)
    const id = this.string(input, 'id')
    if (!/^QA-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(id)) {
      Errors.throwUserInput('Finding IDs must be stable QA-UPPERCASE-SLUG names.')
    }
    return await FS.withFileMutationLock(
      this.path(`Docs/QA/findings/${id}/lifecycle`),
      this.root,
      async () => await this.recordFinding(input, id),
    )
  }

  private async recordFinding(input: Record<string, unknown>, id: string): Promise<Finding> {
    const status = this.choice(
      input,
      'status',
      ['open', 'triaged', 'fixed-awaiting-qa', 'verified-closed', 'accepted-limitation', 'duplicate'] as const,
    )
    const findings = await this.findings()
    const previous = findings.find(finding => finding.id === id)
    const phase = Number(input['phase'])
    const surfaceId = this.string(input, 'surfaceId')
    const dimension = this.choice(input, 'dimension', ['functional', 'visual', 'text'] as const)
    const channel = this.string(input, 'channel')
    const inventory = await new QaInventory(this.root).build(phase)
    const surface = inventory.surfaces.find(item => item.id === surfaceId)
    if (!surface || !surface.dimensions.includes(dimension)) {
      Errors.throwUserInput('Unknown finding surface or dimension.')
    }
    if (!(surface.dimensionChannels[dimension] ?? []).includes(channel)) {
      Errors.throwUserInput('Finding channel must apply to its dimension.')
    }
    const evidence = this.strings(input, 'evidence')
    if (!evidence.length) {
      Errors.throwUserInput('Findings require evidence.')
    }
    const evidenceHashes = await Promise.all(
      evidence.map(async path => ({ path, sha256: await this.evidenceHash(path) })),
    )
    const finding: Finding = {
      id,
      status,
      phase,
      surfaceId,
      dimension,
      channel,
      severity: this.choice(input, 'severity', ['blocking', 'major', 'minor'] as const),
      title: this.string(input, 'title'),
      observed: this.string(input, 'observed'),
      impact: this.string(input, 'impact'),
      location: this.string(input, 'location'),
      affectedPhases: Array.from({ length: 6 - phase }, (_, index) => phase + index),
      expected: this.string(input, 'expected'),
      recheck: this.string(input, 'recheck'),
      evidence,
      evidenceHashes,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confidence: this.choice(input, 'confidence', ['confirmed', 'suspected', 'design-judgment'] as const),
      requiredReviewer: input['requiredReviewer'] === undefined
        ? previous?.requiredReviewer ?? 'agent'
        : this.choice(input, 'requiredReviewer', ['agent', 'human', 'developer'] as const),
      relatedStories: input['relatedStories'] === undefined
        ? previous?.relatedStories ?? []
        : this.strings(input, 'relatedStories'),
    }
    for (const key of ['notes', 'repro', 'owner', 'existingIssue', 'duplicateOf'] as const) {
      if (input[key] !== undefined) {
        finding[key] = this.string(input, key)
      }
    }
    if (status === 'accepted-limitation' && !finding.notes) {
      Errors.throwUserInput('Accepted limitations require a written rationale in notes.')
    }
    if (
      status === 'duplicate'
      && (!finding.duplicateOf || finding.duplicateOf === id || !findings.some(item => item.id === finding.duplicateOf))
    ) {
      Errors.throwUserInput('Duplicate findings must link an existing different finding through duplicateOf.')
    }
    if (
      previous && (previous.surfaceId !== surfaceId || previous.dimension !== dimension || previous.channel !== channel)
    ) {
      Errors.throwUserInput('A finding ID cannot move to another surface, dimension, or channel.')
    }
    if (
      previous
      && ((previous.requiredReviewer ?? 'agent') !== finding.requiredReviewer
        || JSON.stringify(previous.relatedStories ?? []) !== JSON.stringify(finding.relatedStories ?? [])
        || previous.phase !== finding.phase)
    ) {
      Errors.throwUserInput(
        'A finding transition cannot weaken or replace its original reviewer, related stories, or phase obligations.',
      )
    }
    if (status === 'verified-closed') {
      const passingResultId = this.string(input, 'passingResultId')
      const result = (await this.observations()).find(observation => observation.id === passingResultId)
      if (
        !previous || previous.status === 'verified-closed' || !result || result.outcome !== 'pass'
        || result.surfaceId !== surfaceId || result.dimension !== dimension || result.channel !== channel
        || result.createdAt <= previous.updatedAt || result.recordedAt <= previous.updatedAt
        || result.reviewer !== (previous.requiredReviewer ?? 'agent')
        || !await this.proofCurrent(result, surface)
      ) {
        Errors.throwUserInput(
          'Closing a finding requires a new, current passing observation linked to the same surface and dimension.',
        )
      }
      const seen = new Set(
        (await this.findingHistory(id)).flatMap(event => (event.evidenceHashes ?? []).map(item => item.sha256)),
      )
      if (result.evidence.some(item => seen.has(item.sha256))) {
        Errors.throwUserInput(
          "A closing recheck cannot cite the finding's own evidence; record what the recheck observed.",
        )
      }
      finding.passingResultId = passingResultId
    }
    await this.atomic(`Docs/QA/findings/${id}/${this.newId()}.json`, finding, true)
    return finding
  }

  async report(phase: number): Promise<{ packet: string; dashboard: string }> {
    const inventory = await this.inventory(phase)
    const observations = await this.observations()
    const findings = await this.findings()
    const rows: string[] = []
    const gaps: string[] = []
    const releaseGaps: string[] = []
    for (const kind of ['story', 'obligation', 'document', 'probe'] as const) {
      for (let introduced = 1; introduced <= 5; introduced += 1) {
        for (const dimension of ['functional', 'visual', 'text'] as const) {
          let total = 0, reviewed = 0, passed = 0, stale = 0, blocked = 0, friction = 0, failed = 0
          for (
            const surface of inventory.surfaces.filter(item =>
              item.kind === kind && item.phase === introduced && item.dimensions.includes(dimension)
            )
          ) {
            for (const channel of surface.dimensionChannels[dimension] ?? []) {
              for (const reviewer of surface.requirements) {
                total += 1
                const result = observations.findLast(item =>
                  item.phase === phase && item.surfaceId === surface.id && item.dimension === dimension
                  && item.channel === channel && item.reviewer === reviewer
                )
                const current = result && sameSnapshot(surface, result) && await this.evidenceCurrent(result)
                if (result && result.outcome !== 'not-run') {
                  reviewed += 1
                }
                if (result && !current) {
                  stale += 1
                }
                if (current && result?.outcome === 'pass') {
                  passed += 1
                }
                if (current && result?.outcome === 'blocked') {
                  blocked += 1
                }
                if (current && result?.outcome === 'friction') {
                  friction += 1
                }
                if (current && result?.outcome === 'fail') {
                  failed += 1
                }
                if (introduced <= phase && (!current || result?.outcome !== 'pass')) {
                  const gap = `- ${surface.id} / ${dimension} / ${channel} / ${reviewer}: ${
                    result ? current ? result.outcome : 'needs-recheck' : 'not-run'
                  }`
                  if (kind !== 'document' || result) {
                    gaps.push(gap)
                  }
                  if (kind === 'story' || kind === 'obligation') {
                    releaseGaps.push(gap)
                  }
                }
              }
            }
          }
          if (total > 0) {
            rows.push(
              `${kind}:| ${introduced} | ${dimension} | ${total} | ${reviewed} | ${passed} | ${stale} | ${
                total - reviewed
              } | ${blocked} | ${friction} | ${failed} | ${(reviewed * 100 / total).toFixed(1)}% | ${
                (passed * 100 / total).toFixed(1)
              }% |`,
            )
          }
        }
      }
    }
    const staleClosures: string[] = []
    for (const finding of findings.filter(item => item.status === 'verified-closed')) {
      if (await this.closureStale(finding, inventory.surfaces, observations)) {
        staleClosures.push(finding.id)
      }
    }
    const open = findings.filter(finding =>
      !['verified-closed', 'duplicate'].includes(finding.status) || staleClosures.includes(finding.id)
    )
    const verdict = releaseGaps.length
        || open.some(finding =>
          finding.phase <= phase && finding.severity === 'blocking' && finding.status !== 'accepted-limitation'
        )
      ? 'not-ready'
      : 'review-required'
    const header =
      `# QA release ${phase} packet\n\nVerdict: **${verdict}**. ${releaseGaps.length} applicable release acceptance cells are incomplete.\n\nCandidate source: \`${inventory.commit}\`${
        inventory.dirty
          ? ' with **uncommitted inputs**; this packet describes the working tree, not that commit'
          : ''
      }. Tree digest \`${inventory.treeDigest.slice(0, 16)}\`; content hashes are stored per observation.\n\n`
      + 'Reviewed counts include observations that found friction, failure, blockage, or became stale. Passed counts require current source, renderer, profile, evidence, channel, and reviewer. Human and Developer requirements remain separate. No generated report authorizes publication.\n\n'
      + '[Pilot and annotated findings](pilot.md) · [Finding records](findings.json) · [Capability availability](capabilities.md)\n\n'
    const tableHeader =
      '| Introduced phase | Dimension | Required cells | Reviewed | Current pass | Needs recheck | Not run | Blocked | Friction | Fail | Reviewed % | Passed % |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'
    const table =
      ([['story', 'Original release story acceptance'], ['obligation', 'Additional staged release acceptance'], [
        'document',
        'All-document editorial progress',
      ], ['probe', 'Scoped development probes']] as const)
        .map(([kind, title]) =>
          `## ${title}\n\n${tableHeader}${
            rows.filter(row => row.startsWith(`${kind}:`)).map(row => row.slice(kind.length + 1)).join('\n')
          }`
        ).join('\n\n')
    const findingsText = `\n\n## Unresolved findings and accepted limitations\n\n${
      open.map(finding =>
        `- ${finding.id} (${
          staleClosures.includes(finding.id) ? 'closure-needs-recheck' : finding.status
        }; ${finding.severity}; phase ${finding.phase}): ${finding.title}`
      ).join('\n') || 'None recorded.'
    }`
    const exclusionCounts = new Map<string, number>()
    for (const item of inventory.exclusions) {
      exclusionCounts.set(item.reason, (exclusionCounts.get(item.reason) ?? 0) + 1)
    }
    const exclusions = `\n\n## Inventory exclusions\n\n${
      [...exclusionCounts].map(([reason, count]) => `- ${count}: ${reason}`).join('\n') || 'None.'
    }\n\nEvery excluded path and reason: [inventory](inventory.json).`
    const latest = new Map<string, Observation>()
    for (const observation of observations.filter(item => item.phase <= phase)) {
      latest.set(
        JSON.stringify([observation.surfaceId, observation.dimension, observation.channel, observation.reviewer]),
        observation,
      )
    }
    const assessed: string[] = []
    for (const result of latest.values()) {
      const surface = inventory.surfaces.find(item => item.id === result.surfaceId)
      const freshness = surface && sameSnapshot(surface, result) && await this.evidenceCurrent(result)
        ? 'current'
        : 'needs-recheck'
      assessed.push(
        `- [${result.surfaceId} / ${result.dimension} / ${result.channel} / ${result.reviewer}](results/${result.id}.json): **${result.outcome}**, ${freshness}; execution profile ${result.executionProfile}.`,
      )
    }
    const assessedText =
      `\n\n## Recorded assessments\n\nThese are scoped observations; supplementary source checks do not fill public-artifact or human acceptance cells.\n\n${
        assessed.join('\n') || 'None recorded.'
      }`
    const deferred = `\n\n## Deferred beyond release 5\n\n${
      inventory.surfaces.filter(surface => surface.phase === 'deferred').map(surface =>
        `- ${surface.id}: ${surface.title} — ${surface.scopeNote}`
      ).join('\n') || 'None.'
    }`
    const text = `${header}${table}${assessedText}${findingsText}\n\n## Applicable gaps\n\n${
      gaps.join('\n') || 'No recorded gaps.'
    }${deferred}${exclusions}\n`
    const packet = `Docs/QA/release-${phase}.md`
    await this.atomic(packet, text)
    await this.atomic(
      'Docs/QA/dashboard.md',
      `${header}${table}${assessedText}${findingsText}\n\nFull applicable gaps and exclusions: [release ${phase} packet](release-${phase}.md).\n`,
    )
    return { packet, dashboard: 'Docs/QA/dashboard.md' }
  }

  private async checkLinks(surfaces: QaSurface[]): Promise<unknown> {
    const broken: { source: string; target: string }[] = []
    let checked = 0
    for (const surface of surfaces) {
      const text = await FS.readText(this.path(surface.source))
      for (const match of text.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/gu)) {
        const target = (match[1] ?? match[2] ?? '').split('#')[0]!.split('?')[0]!
        if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(target)) {
          continue
        }
        let decoded: string
        try {
          decoded = decodeURIComponent(target)
        } catch {
          broken.push({ source: surface.source, target })
          continue
        }
        const resolved = FS.resolvePath(decoded, FS.dirname(this.path(surface.source)))
        if (!FS.pathIsWithin(resolved, this.root)) {
          continue
        }
        checked += 1
        if (!await FS.exists(resolved)) {
          broken.push({ source: surface.source, target })
        }
      }
    }
    return {
      checked,
      outcome: broken.length ? 'friction' : 'pass',
      broken,
      scope:
        'Local inline link existence only; anchors, reference links, external destinations and prose comprehension require review.',
    }
  }

  private async closureStale(finding: Finding, surfaces: QaSurface[], observations: Observation[]): Promise<boolean> {
    if (finding.status !== 'verified-closed') {
      return false
    }
    const proof = observations.find(item => item.id === finding.passingResultId)
    const surface = surfaces.find(item => item.id === finding.surfaceId)
    return !proof || !surface || !await this.proofCurrent(proof, surface)
  }

  /** proofCurrent judges a proof against its own phase's policy, so closure survives a report for another phase. */
  private async proofCurrent(proof: Observation, surface: QaSurface): Promise<boolean> {
    return proof.sourceHash === surface.sourceHash && proof.rendererHash === surface.rendererHash
      && proof.profileHash === QaInventory.profileHash(proof.phase) && await this.evidenceCurrent(proof)
  }

  /**
   * requireInspectedCapture accepts a visual pass only for an image a capture attests as captured. An agent
   * must cite the review manifest; a person may cite a screenshot alone, but never a failed or partial capture.
   */
  private async requireInspectedCapture(evidence: Observation['evidence'], reviewer: QaReviewer): Promise<void> {
    const images = evidence.filter(item => /\.(png|jpe?g|webp)$/iu.test(item.path))
    if (!images.length) {
      Errors.throwUserInput(
        'A visual pass requires an inspected image, not capture success or unchanged digests alone.',
      )
    }
    const captured = new Set<string>()
    let manifests = 0
    for (const item of evidence.filter(entry => entry.path.endsWith('.json'))) {
      const value = await FS.readJson<unknown>(this.path(item.path)).catch(() => undefined)
      if (!value || typeof value !== 'object') {
        continue
      }
      const record = value as { owner?: unknown; status?: unknown; cells?: unknown }
      if (record.owner === 'qa-capture' && record.status !== 'complete') {
        Errors.throwUserInput(
          `A visual pass cannot cite an incomplete capture: ${item.path} is ${String(record.status)}.`,
        )
      }
      if (record.owner !== 'qa-capture' && Array.isArray(record.cells)) {
        manifests += 1
        for (const cell of record.cells as { status?: unknown; sha256?: unknown }[]) {
          if (cell.status === 'captured' && typeof cell.sha256 === 'string') {
            captured.add(cell.sha256)
          }
        }
      }
    }
    if (reviewer === 'agent' && !manifests) {
      Errors.throwUserInput('An agent visual pass must cite the review manifest that captured its images.')
    }
    if (manifests && images.some(image => !captured.has(image.sha256))) {
      Errors.throwUserInput('Every cited image must match a captured cell in the cited review manifest.')
    }
  }

  private async fullyReviewed(surface: QaSurface, observations: Observation[], phase: number): Promise<boolean> {
    for (const dimension of surface.dimensions) {
      for (const channel of surface.dimensionChannels[dimension] ?? []) {
        for (const reviewer of surface.requirements) {
          const result = observations.findLast(item =>
            item.phase === phase && item.surfaceId === surface.id && item.dimension === dimension
            && item.channel === channel && item.reviewer === reviewer
          )
          if (
            !result || result.outcome !== 'pass' || !sameSnapshot(surface, result)
            || !await this.evidenceCurrent(result)
          ) {
            return false
          }
        }
      }
    }
    return true
  }

  private async observations(): Promise<Observation[]> {
    const dir = this.path('Docs/QA/results')
    if (!await FS.exists(dir)) {
      return []
    }
    const files = (await FS.listDir(dir)).filter(name => name.endsWith('.json'))
    return (await Promise.all(files.map(name => FS.readJson<Observation>(FS.resolvePath(name, dir)))))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }

  private async findingHistory(id: string): Promise<Finding[]> {
    const dir = this.path(`Docs/QA/findings/${id}`)
    if (!await FS.isDirectory(dir)) {
      return []
    }
    const names = (await FS.listDir(dir)).filter(name => name.endsWith('.json'))
    return await Promise.all(names.map(name => FS.readJson<Finding>(FS.resolvePath(name, dir))))
  }

  private async findings(): Promise<Finding[]> {
    const seed = this.path('Docs/QA/findings.json')
    const entries = await FS.exists(seed) ? await FS.readJson<Finding[]>(seed) : []
    const dir = this.path('Docs/QA/findings')
    if (await FS.exists(dir)) {
      for (const id of await FS.listDir(dir)) {
        if (!await FS.isDirectory(FS.resolvePath(id, dir))) {
          continue
        }
        for (const name of await FS.listDir(FS.resolvePath(id, dir))) {
          if (name.endsWith('.json')) {
            entries.push(await FS.readJson<Finding>(FS.resolvePath(`${id}/${name}`, dir)))
          }
        }
      }
    }
    const latest = new Map<string, Finding>()
    for (const entry of entries.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
      latest.set(entry.id, entry)
    }
    return [...latest.values()]
  }

  private async evidenceCurrent(result: Observation): Promise<boolean> {
    if (!result.evidence.length) {
      return false
    }
    for (const item of result.evidence) {
      try {
        if (await this.evidenceHash(item.path) !== item.sha256) {
          return false
        }
      } catch {
        return false
      }
    }
    return true
  }

  private async evidenceHash(path: string): Promise<string> {
    const absolute = this.path(path)
    if (FS.isAbsolute(path) || !FS.pathIsWithin(absolute, this.root) || /(?:^|\/)\.env(?:\.|$)/u.test(path)) {
      Errors.throwUserInput('Evidence must be a safe repository-relative file path.')
    }
    if (!await FS.isFile(absolute) || !FS.pathIsWithin(await FS.realPath(absolute), await FS.realPath(this.root))) {
      Errors.throwUserInput(`Evidence file is missing or outside the repository: ${path}`)
    }
    if (await FS.byteSize(absolute) === 0) {
      Errors.throwUserInput(`Evidence file is empty: ${path}`)
    }
    return Platform.sha256Hex(await FS.readFile(absolute))
  }

  private async input(file?: string): Promise<Record<string, unknown>> {
    if (!file) {
      Errors.throwUserInput('Supply --file with a JSON observation or finding.')
    }
    await this.evidenceHash(file)
    const value = await FS.readJson<unknown>(this.path(file))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      Errors.throwUserInput('QA input must be a JSON object.')
    }
    return value as Record<string, unknown>
  }

  private string(input: Record<string, unknown>, key: string): string {
    const value = input[key]
    if (typeof value !== 'string' || !value.trim()) {
      Errors.throwUserInput(`QA ${key} must be a nonempty string.`)
    }
    return value
  }

  private strings(input: Record<string, unknown>, key: string): string[] {
    const value = input[key]
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
      Errors.throwUserInput(`QA ${key} must be a string array.`)
    }
    return value as string[]
  }

  private choice<T extends string>(input: Record<string, unknown>, key: string, choices: readonly T[]): T {
    const value = this.string(input, key)
    if (!choices.includes(value as T)) {
      Errors.throwUserInput(`QA ${key} must be one of: ${choices.join(', ')}.`)
    }
    return value as T
  }

  private validId(id: string): void {
    if (!/^[a-zA-Z0-9-]+$/u.test(id)) {
      Errors.throwUserInput('Invalid QA run identifier.')
    }
  }

  private newId(): string {
    return `${new Date().toISOString().replace(/[^0-9]/gu, '')}-${Platform.randomUUID()}`
  }
  private path(path: string): string {
    return FS.resolvePath(path, this.root)
  }

  private async atomic(path: string, content: unknown, immutable = false): Promise<void> {
    const target = this.path(path)
    await FS.withFileMutationLock(target, this.root, async () => {
      if (immutable && await FS.exists(target)) {
        Errors.throwUserInput(`QA evidence already exists: ${path}`)
      }
      const temporary = `${target}.${Platform.randomUUID()}.tmp`
      await FS.writeText(temporary, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`)
      await FS.move(temporary, target)
    })
  }
}

function sameSnapshot(left: Snapshot, right: Snapshot): boolean {
  return left.sourceHash === right.sourceHash && left.rendererHash === right.rendererHash
    && left.profileHash === right.profileHash
}

import { CLI, Errors, FS, Platform, ReleaseCapabilities } from '@shared'

const storyPlan = 'Docs/MVP Roadmap/Plan - Initial release QA.md'
const internalDocument = /^(?:Docs\/(?:QA|Roadmap|MVP Roadmap)\/|agents\/|\.rulesync\/)|(?:^|\/)(?:AGENTS|CLAUDE)\.md$/u

export type QaDimension = 'functional' | 'visual' | 'text'
export type QaReviewer = 'agent' | 'human' | 'developer'
export type QaSurface = {
  id: string
  title: string
  kind: 'document' | 'story' | 'probe' | 'obligation'
  source: string
  phase: number | 'deferred'
  tags: string[]
  channels: string[]
  dimensions: QaDimension[]
  dimensionChannels: Partial<Record<QaDimension, string[]>>
  requirements: QaReviewer[]
  sourceHash: string
  rendererHash: string
  profileHash: string
  scopeNote: string
  /** captureCells names the `group/label` review cell that shows each visual channel. */
  captureCells?: Record<string, string>
  /** captureApp names the app a capture must have launched for its cells to show this surface. */
  captureApp?: string
}

export type QaInventoryData = {
  version: 1
  phase: number
  commit: string
  /** dirty is true when an inventoried input differs from `commit`; hashes then describe the working tree. */
  dirty: boolean
  treeDigest: string
  dependencies: { path: string; sha256: string }[]
  surfaces: QaSurface[]
  exclusions: { path: string; reason: string; canonicalSources?: string[]; presentationReview?: string }[]
}

/** QaInventory inventories Git's complete document namespace, including canonical hidden files. */
export class QaInventory {
  constructor(private readonly root: string) {}

  async build(phase: number): Promise<QaInventoryData> {
    if (![1, 2, 3, 4, 5].includes(phase)) {
      Errors.throwUserInput('QA phase must be 1 through 5.')
    }
    const git = await CLI.mustRun('git', {
      args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      cwd: this.root,
    })
    const paths = [...new Set(git.stdout.split('\0').filter(Boolean))].sort()
    const documents = paths.filter(path =>
      /\.(md|mdx|rst|txt|adoc)$/iu.test(path)
      || /(?:^|\/)(?:README|LICENSE|LICENCE|COPYING|NOTICE|CONTRIBUTING|CHANGELOG|AUTHORS|INSTALL)$/iu.test(path)
    )
    const exclusions: QaInventoryData['exclusions'] = []
    const included: string[] = []
    for (const path of documents) {
      const reason = this.exclusion(path)
      if (reason) {
        const canonicalSources = this.canonicalSources(path, paths)
        exclusions.push({
          path,
          reason,
          ...(canonicalSources.length
            ? {
              canonicalSources,
              presentationReview:
                'Review generated presentation through canonical-source findings; do not count copied prose twice.',
            }
            : {}),
        })
      } else if (await FS.isSymbolicLink(FS.resolvePath(path, this.root))) {
        exclusions.push({ path, reason: 'Symbolic document alias; review its canonical source.' })
      } else if (await FS.isFile(FS.resolvePath(path, this.root))) {
        included.push(path)
      } else {
        exclusions.push({ path, reason: 'Tracked path is absent in the working tree.' })
      }
    }
    const dependencies = paths.filter(path =>
      !this.exclusion(path)
      && (/^(?:packages|stdlib|Apps|\.config)\//u.test(path)
        || /^(?:bun.lock|package.json|Justfile|tsconfig.*\.json|devenv\.(?:nix|lock|yaml)|tao|agent|dev)$/u.test(path))
      && !path.startsWith('packages/cli/dev-cli/dev-cli-src/qa/')
      && !path.startsWith('packages/cli/dev-cli/dev-cli-tests/qa-')
    )
    const dependencyHashes: string[] = []
    const dependencyInputs: QaInventoryData['dependencies'] = []
    for (const path of dependencies) {
      if (
        !await FS.isSymbolicLink(FS.resolvePath(path, this.root)) && await FS.isFile(FS.resolvePath(path, this.root))
      ) {
        const sha256 = Platform.sha256Hex(await FS.readFile(FS.resolvePath(path, this.root)))
        dependencyHashes.push(`${path}:${sha256}`)
        dependencyInputs.push({ path, sha256 })
      }
    }
    const rendererHash = Platform.sha256Hex(dependencyHashes.join('\n'))
    const profileHash = QaInventory.profileHash(phase)
    const surfaces: QaSurface[] = []
    for (const path of included) {
      surfaces.push({
        id: `doc:${path}`,
        title: path,
        kind: 'document',
        source: path,
        phase: 1,
        tags: ['A'],
        channels: ['source'],
        dimensions: ['text'],
        requirements: ['agent'],
        dimensionChannels: { text: ['source'] },
        sourceHash: Platform.sha256Hex(await FS.readFile(FS.resolvePath(path, this.root))),
        rendererHash: 'not-applicable',
        profileHash,
        scopeNote: 'Editorial review of this document; reviewing a plan does not accept its product claims.',
      })
    }
    const plan = await FS.readText(FS.resolvePath(storyPlan, this.root))
    const planHash = Platform.sha256Hex(plan)
    // Plans and agent instructions change constantly without changing what a newcomer reads.
    const sourceHash = Platform.sha256Hex(
      `${rendererHash}\n${
        surfaces.filter(surface => !internalDocument.test(surface.source)).map(surface =>
          `${surface.source}:${surface.sourceHash}`
        ).join('\n')
      }`,
    )
    // Obligations are defined by the staged release plan, which the shared hash leaves out as a roadmap.
    const obligationSource = 'Docs/MVP Roadmap/Plan - Staged public releases.md'
    const obligationHash = Platform.sha256Hex(
      `${sourceHash}\n${Platform.sha256Hex(await FS.readFile(FS.resolvePath(obligationSource, this.root)))}`,
    )
    for (
      const match of plan.matchAll(
        /^\|\s*((?:WEB|CLI|STU|COM|IDE|DOC|APP|COMT)\d+)\s*\|(.+?)\|\s*([APD, ]+)\|\s*\d+\s*\|/gmu,
      )
    ) {
      const id = match[1]!
      const tags = match[3]!.split(',').map(tag => tag.trim())
      const scope = storyScope(id)
      if (id === 'APP2' && phase >= 2) {
        scope.channels.push('ios-simulator')
      }
      if (id === 'APP2' && phase >= 4) {
        scope.channels.push('physical-device')
      }
      if (id === 'WEB2' && phase >= 3) {
        scope.channels.push('public-download')
      }
      surfaces.push({
        id: `story:${id}`,
        title: match[2]!.trim(),
        kind: 'story',
        source: storyPlan,
        ...scope,
        tags,
        dimensions: ['functional', 'visual', 'text'],
        dimensionChannels: { functional: scope.channels, visual: scope.channels, text: ['public-docs'] },
        requirements: [
          'agent',
          ...(tags.includes('P') && (!tags.includes('D') || id === 'DOC1') ? ['human' as const] : []),
          ...(tags.includes('D') ? ['developer' as const] : []),
        ],
        sourceHash: Platform.sha256Hex(`${match[0]}\n${planHash}\n${sourceHash}`),
        rendererHash,
        profileHash,
      })
    }
    if (surfaces.filter(surface => surface.kind === 'story').length !== 49) {
      Errors.throwUserInput('The release story plan changed: expected 49 rows. Update the QA mapping explicitly.')
    }
    surfaces.push({
      id: 'acceptance:cloudkit-private-sync',
      title: 'Private same-person CloudKit synchronization',
      kind: 'obligation',
      source: obligationSource,
      phase: ReleaseCapabilities.catalog.cloudkit.phase,
      tags: ['P'],
      channels: ['cloudkit-two-device', 'physical-device', 'public-docs'],
      dimensions: ['functional', 'visual', 'text'],
      dimensionChannels: { functional: ['cloudkit-two-device'], visual: ['physical-device'], text: ['public-docs'] },
      requirements: ['agent', 'human'],
      sourceHash: obligationHash,
      rendererHash,
      profileHash,
      scopeNote:
        'Two real Apple devices with the same person: offline edit reconciliation, relaunch persistence and account-switch isolation. This does not accept the deferred hosted-data APP3 story.',
    })
    for (
      const entry of [
        {
          id: 'http-and-multiple-data',
          title: 'Typed HTTP adapters, multiple datasources and cross-source references',
          phase: ReleaseCapabilities.catalog['http-data'].phase,
          channels: ['browser', 'ios-simulator'],
          note: 'Exercise adapter success/error/retry, datasource identity and writes, and references across sources.',
        },
        {
          id: 'advanced-design',
          title: 'Advanced design, derived values and element defaults',
          phase: ReleaseCapabilities.catalog['advanced-design'].phase,
          channels: ['browser', 'native-studio'],
          note:
            'Inspect adaptive design and interactive scenario identity in the native workbench; source tests remain supplementary.',
        },
      ]
    ) {
      surfaces.push({
        id: `acceptance:${entry.id}`,
        title: entry.title,
        kind: 'obligation',
        source: obligationSource,
        phase: entry.phase,
        tags: ['P'],
        channels: [...entry.channels, 'public-docs'],
        dimensions: ['functional', 'visual', 'text'],
        dimensionChannels: { functional: entry.channels, visual: entry.channels, text: ['public-docs'] },
        requirements: ['agent', 'human'],
        sourceHash: obligationHash,
        rendererHash,
        profileHash,
        scopeNote: entry.note,
      })
    }
    const probes: {
      id: string
      title: string
      source: string
      dimension: QaDimension
      channels: string[]
      captureCells?: Record<string, string>
      captureApp?: string
    }[] = [
      {
        id: 'source:hnreader-browser',
        title: 'HNReaderStub development browser journey',
        source: 'Apps/HNReader',
        dimension: 'functional',
        channels: ['browser-preview'],
      },
      {
        id: 'source:tutorial-replay',
        title: 'Tutorial source snippets and final behavior journey',
        source: 'Docs/Tutorials/Your First Tao App.md',
        dimension: 'functional',
        channels: ['source-test'],
      },
      {
        id: 'visual:reading-list',
        title: 'Tutorial ReadingList captured views',
        source: 'Docs/Tutorials/Your First Tao App.md',
        dimension: 'visual',
        channels: ['phone-light', 'phone-dark', 'desktop'],
        captureCells: { 'phone-light': 'QA views/phone', 'phone-dark': 'QA views/dark', desktop: 'QA views/desktop' },
        captureApp: 'ReadingList',
      },
      {
        id: 'visual:notebook',
        title: 'Notebook starter captured initial states',
        source: 'packages/cli/tao-cli',
        dimension: 'visual',
        channels: ['phone', 'tablet-dark', 'notes-groceries', 'notes-ideas'],
        captureCells: {
          phone: 'devices/phone',
          'tablet-dark': 'devices/tabletDark',
          'notes-groceries': 'notes states/groceries',
          'notes-ideas': 'notes states/ideas',
        },
        captureApp: 'Notebook',
      },
      {
        id: 'visual:hnreader',
        title: 'HNReaderStub browser capture cells',
        source: 'Apps/HNReader',
        dimension: 'visual',
        channels: ['rows-leading', 'rows-wrapping', 'sketch-draft-1', 'sketch-draft-2'],
        captureCells: {
          'rows-leading': 'rows/leading',
          'rows-wrapping': 'rows/wrapping',
          'sketch-draft-1': 'sketch/draft',
          'sketch-draft-2': 'sketch/draft',
        },
        captureApp: 'HNReaderStub',
      },
    ]
    for (const probe of probes) {
      surfaces.push({
        ...probe,
        kind: 'probe',
        phase: probe.id === 'visual:hnreader' ? 2 : 1,
        tags: ['A'],
        requirements: ['agent'],
        dimensions: [probe.dimension],
        dimensionChannels: { [probe.dimension]: probe.channels },
        sourceHash,
        rendererHash,
        profileHash,
        scopeNote:
          'Scoped development-source pilot evidence; never substitutes for a complete release story or required human review.',
      })
    }
    const commit = await CLI.mustRun('git', { args: ['rev-parse', 'HEAD'], cwd: this.root })
    const inputs = new Set([...dependencies, ...documents.filter(path => !this.exclusion(path)), storyPlan])
    const dirty = (await this.changedPaths()).some(path => inputs.has(path))
    const treeDigest = Platform.sha256Hex(
      `${rendererHash}\n${
        surfaces.filter(surface => surface.kind === 'document').map(surface =>
          `${surface.source}:${surface.sourceHash}`
        ).join('\n')
      }`,
    )
    return {
      version: 1,
      phase,
      commit: commit.stdout.trim(),
      dirty,
      treeDigest,
      surfaces,
      dependencies: dependencyInputs,
      exclusions,
    }
  }

  /** changedPaths lists every path Git reports as changed, including both sides of a rename or copy. */
  private async changedPaths(): Promise<string[]> {
    const status = await CLI.mustRun('git', {
      args: ['status', '--porcelain', '-z', '--untracked-files=all'],
      cwd: this.root,
    })
    const entries = status.stdout.split('\0').filter(Boolean)
    const paths: string[] = []
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!
      paths.push(entry.slice(3))
      if (/[RC]/u.test(entry.slice(0, 2)) && entries[index + 1] !== undefined) {
        index += 1
        paths.push(entries[index]!)
      }
    }
    return paths
  }

  /** profileHash identifies a phase's capability policy, so evidence from one phase never passes another. */
  static profileHash(phase: number): string {
    return Platform.sha256Hex(JSON.stringify({
      profile: ReleaseCapabilities.fingerprint(ReleaseCapabilities.profile(phase as 1 | 2 | 3 | 4 | 5)),
      catalog: ReleaseCapabilities.catalog,
    }))
  }

  private canonicalSources(path: string, paths: string[]): string[] {
    if (path === '.claude/CLAUDE.md') {
      return ['AGENTS.md']
    }
    const starterSkill = path.match(/^Apps\/Starters\/[^/]+\/\.(?:agents|codex|claude|cursor)\/skills\/(.+)$/u)
    if (starterSkill) {
      return [`packages/ai/tao-skills/skills/${starterSkill[1]}`].filter(source => paths.includes(source))
    }
    const skill = path.match(/^\.(?:agents|codex|claude|cursor)\/skills\/(.+)$/u)
    if (skill) {
      return [`agents/skills/${skill[1]}`].filter(source => paths.includes(source))
    }
    const agent = path.match(/^\.(?:codex|claude|cursor)\/(?:agents|rules)\/([^/]+)\.(?:md|mdc)$/u)
    if (agent) {
      return [`agents/subagents/${agent[1]}.md`].filter(source => paths.includes(source))
    }
    return []
  }

  private exclusion(path: string): string | undefined {
    if (/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.ssh|\.aws)(?:\/|$)/u.test(path)) {
      return 'Secret or credential namespace; never inspected.'
    }
    if (/(?:^|\/)archives?(?:\/|$)/iu.test(path)) {
      return 'Frozen archive; outside active-document review.'
    }
    if (/^(?:\.agents|\.codex|\.claude|\.cursor)\//u.test(path)) {
      return 'Generated harness copy; canonical .rulesync or agents source is inventoried.'
    }
    if (/^Apps\/Starters\/[^/]+\/\.(?:agents|codex|claude|cursor)\/skills\//u.test(path)) {
      return 'Starter copy of the packaged Tao skills; the canonical packages/ai/tao-skills source is inventoried.'
    }
    if (/(?:^|\/)(?:node_modules|vendor|dist|build|\.artifacts|_gen_[^/]+|\.git)(?:\/|$)/u.test(path)) {
      return 'Generated, vendor, or task artifact; not an authored repository document.'
    }
    if (
      /^Docs\/QA\/(?:inventory\.json|dashboard\.md|capabilities\.md|release-\d\.md|results\/|runs\/|findings\/|evidence\/|inputs\/)/u
        .test(path)
    ) {
      return 'QA evidence or generated register output; excluded from its own freshness inputs.'
    }
    return undefined
  }
}

function storyScope(id: string): Pick<QaSurface, 'phase' | 'channels' | 'scopeNote'> {
  if (id.startsWith('STU')) {
    return {
      phase: 3,
      channels: ['native-studio', 'public-download'],
      scopeNote: 'Native distributed Studio; browser preview alone is insufficient.',
    }
  }
  if (/^COM\d/u.test(id)) {
    return {
      phase: 4,
      channels: ['physical-device', 'invitation-beta'],
      scopeNote: 'Distributed Companion on a physical device; source and simulator evidence remain separate.',
    }
  }
  if (id === 'APP3') {
    return {
      phase: 'deferred',
      channels: ['hosted-data'],
      scopeNote:
        'Original hosted WordFlower story stays deferred beyond phase 5. Private same-person CloudKit has a separate acceptance surface.',
    }
  }
  if (id === 'APP4' || id === 'APP5') {
    return {
      phase: 5,
      channels: ['testflight'],
      scopeNote: 'Real app build, invitation, tester install and use; upload alone is insufficient.',
    }
  }
  if (id === 'CLI4') {
    return {
      phase: 2,
      channels: ['ios-simulator', 'installed-cli'],
      scopeNote: 'iOS Simulator only; Android/emulator clause remains deferred.',
    }
  }
  if (id === 'APP2') {
    return {
      phase: 1,
      channels: ['browser'],
      scopeNote:
        'Browser sizes in phase 1, simulator expands this story in phase 2 and physical Companion in phase 4; Android deferred.',
    }
  }
  if (id.startsWith('IDE')) {
    return {
      phase: 1,
      channels: ['vscode-marketplace', 'open-vsx'],
      scopeNote: 'Both actual marketplace installs; local VSIX is not marketplace acceptance.',
    }
  }
  if (id.startsWith('CLI')) {
    return {
      phase: 1,
      channels: ['installed-cli'],
      scopeNote: 'Distributed signed/notarized macOS Apple Silicon CLI. Source checkout checks are supplementary.',
    }
  }
  if (id === 'DOC1' || id === 'DOC3' || id === 'APP1') {
    return {
      phase: 1,
      channels: ['browser', 'installed-cli'],
      scopeNote: 'Public instructions and promoted examples; repository-only execution is supplementary.',
    }
  }
  if (id === 'DOC2' || id === 'DOC5') {
    return {
      phase: 1,
      channels: ['installed-cli', 'public-docs'],
      scopeNote:
        'Published lessons and diagnostics checked against the shipped CLI; a source checkout is supplementary.',
    }
  }
  if (id === 'WEB2') {
    return {
      phase: 1,
      channels: ['public-site', 'installed-cli'],
      scopeNote: 'The published front door leads to the signed CLI and both marketplace listings actually installed.',
    }
  }
  if (/^(?:WEB[1345]|DOC4|COMT[1-5])$/u.test(id)) {
    return {
      phase: 1,
      channels: ['public-site'],
      scopeNote:
        'The published front door, listings and public repository as a newcomer meets them; repository files are supplementary.',
    }
  }
  return Errors.throwUserInput(`Release story ${id} has no QA channel mapping. Map it explicitly in QaInventory.`)
}

import { CLI, FS, Repo } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'
import { QaInventory } from '../dev-cli-src/qa/QaInventory'
import { QaRegister } from '../dev-cli-src/qa/QaRegister'

/** GIT_IDENTITY commits as a fixed author, as `initGitTestRepository` does, since a CI runner has none. */
const GIT_IDENTITY = ['-c', 'user.name=Tao Test', '-c', 'user.email=tao@example.test']

async function fixture(exitCode = 0): Promise<{ root: string; qa: QaRegister }> {
  const root = await mkGitTestDir('qa-register-')
  await initGitTestRepository(root, {
    commit: {
      files: {
        '.gitignore': '.artifacts/\n',
        'README.md': '# Fixture\n\n[Missing](missing.md)\n',
        '.rulesync/rules/canonical.md': 'Authored instruction',
        '.codex/rules/copy.md': 'Generated copy',
        '.agents/skills/example/SKILL.md': 'Generated skill copy',
        'packages/ai/tao-skills/skills/tao-data/SKILL.md': 'Packaged skill',
        'Apps/Starters/Notebook/.claude/skills/tao-data/SKILL.md': 'Starter copy of the packaged skill',
        'Apps/Starters/Notebook/.tao/.gitignore': 'local/\n',
        'Apps/Starters/Notebook/App.tao': `app Notebook { id "notebook" }
scenarios Notebook "devices" {
  device phone
  scenario "phone" {}
  scenario "tabletDark" { appearance dark device tablet }
}`,
        'Docs/ArChIvE/old.md': 'Frozen historical document',
        'LICENSE': 'Fixture license',
        'packages/example/source.ts': 'export const value = 1\n',
        'Docs/MVP Roadmap/Plan - Staged public releases.md': '# Staged public releases\n',
        'Docs/MVP Roadmap/Plan - Initial release QA.md': await FS.readText(
          Repo.resolvePath('Docs/MVP Roadmap/Plan - Initial release QA.md'),
        ),
        'agent': `#!/bin/sh\nprintf "fixture tutorial source check\\n"\nexit ${exitCode}\n`,
      },
    },
  })
  await FS.chmod(FS.resolvePath('agent', root), 0o755)
  await CLI.mustRun('git', {
    args: [...GIT_IDENTITY, 'commit', '-qam', 'Make the fixture agent executable'],
    cwd: root,
  })
  return { root, qa: new QaRegister(root) }
}

async function input(root: string, name: string, value: unknown): Promise<string> {
  const path = `.artifacts/${name}.json`
  await FS.writeJson(FS.resolvePath(path, root), value)
  return path
}

Describe('QA evidence register', () => {
  Test('retains Markdown tutorial capture identity alongside discovered app scenarios', async () => {
    const { root } = await fixture()
    const inventory = await new QaInventory(root).build(1)
    const tutorial = inventory.surfaces.filter(surface => surface.id === 'visual:reading-list')
    Expect(tutorial).toHaveLength(1)
    Expect(tutorial[0]?.source).toBe('Docs/Tutorials/Your First Tao App.md')
    Expect(tutorial[0]?.captureProject).toBe('.artifacts/qa/tutorial-review')
    Expect(tutorial[0]?.captureSources).toEqual({
      'phone-light': 'ReadingList.tao',
      'phone-dark': 'ReadingList.tao',
      desktop: 'ReadingList.tao',
    })
    Expect(inventory.surfaces.some(surface => surface.captureProject === 'Apps/Starters/Notebook')).toBe(true)
  })

  Test('reports scenario discovery failures alongside the inventory and release packet', async () => {
    const { root, qa } = await fixture()
    await FS.writeText(FS.resolvePath('Apps/Broken/.tao/.gitignore', root), 'local/\n')
    await FS.writeText(
      FS.resolvePath('Apps/Broken/Scenarios.tao', root),
      'scenarios "broken" { scenario "unfinished" {',
    )
    const inventory = await new QaInventory(root).build(1)
    Expect(inventory.scenarioDiscoveryFailures.some(failure => failure.source === 'Apps/Broken/Scenarios.tao')).toBe(
      true,
    )
    await qa.report(1)
    Expect(await FS.readText(FS.resolvePath('Docs/QA/release-1.md', root))).toContain('**failed discovery**')
  })

  Test(
    'inventories hidden canonical and extensionless documents, all 49 additive stories, and explicit exclusions',
    async () => {
      const { root } = await fixture()
      const inventory = await new QaInventory(root).build(1)
      Expect(inventory.surfaces.filter(surface => surface.kind === 'story')).toHaveLength(49)
      Expect(inventory.surfaces.some(surface => surface.id === 'doc:.rulesync/rules/canonical.md')).toBe(true)
      Expect(inventory.surfaces.some(surface => surface.id === 'doc:LICENSE')).toBe(true)
      Expect(inventory.exclusions.map(item => item.path)).toEqual([
        '.agents/skills/example/SKILL.md',
        '.codex/rules/copy.md',
        'Apps/Starters/Notebook/.claude/skills/tao-data/SKILL.md',
        'Docs/ArChIvE/old.md',
      ])
      Expect(
        inventory.exclusions.find(item => item.path.startsWith('Apps/Starters/'))?.canonicalSources,
      ).toEqual(['packages/ai/tao-skills/skills/tao-data/SKILL.md'])
      Expect(inventory.dirty).toBe(false)
      Expect(inventory.surfaces.find(surface => surface.id === 'story:WEB2')?.channels).toEqual([
        'public-site',
        'installed-cli',
      ])
      Expect(inventory.surfaces.find(surface => surface.id === 'story:COMT1')?.channels).toEqual(['public-site'])
      Expect(inventory.surfaces.find(surface => surface.id === 'story:APP3')?.phase).toBe('deferred')
      const story = inventory.surfaces.find(surface => surface.id === 'story:DOC1')!
      Expect(story.tags).toEqual(['P', 'D'])
      Expect(story.requirements).toEqual(['agent', 'human', 'developer'])
      Expect(story.dimensionChannels).toEqual({
        functional: ['browser', 'installed-cli'],
        visual: ['browser', 'installed-cli'],
        text: ['public-docs'],
      })
      Expect(inventory.surfaces.find(surface => surface.id === 'story:STU1')?.phase).toBe(3)
      Expect(inventory.surfaces.find(surface => surface.id === 'story:APP4')?.phase).toBe(5)
      Expect(inventory.surfaces.find(surface => surface.id === 'story:APP2')?.channels).toEqual(['browser'])
      Expect((await new QaInventory(root).build(2)).surfaces.find(surface => surface.id === 'story:APP2')?.channels)
        .toEqual(['browser', 'ios-simulator'])
      Expect((await new QaInventory(root).build(4)).surfaces.find(surface => surface.id === 'story:APP2')?.channels)
        .toEqual(['browser', 'ios-simulator', 'physical-device'])
      const roadmapStory = inventory.surfaces.find(surface => surface.id === 'story:DOC1')!.sourceHash
      const obligation = inventory.surfaces.find(surface => surface.id === 'acceptance:advanced-design')!.sourceHash
      await FS.writeText(FS.resolvePath('Docs/Roadmap/Plan.md', root), 'A plan edit.\n')
      await FS.writeText(FS.resolvePath('.artifacts/scratch.md', root), 'Ignored scratch.\n')
      const edited = await new QaInventory(root).build(1)
      Expect(edited.dirty).toBe(true)
      Expect(edited.surfaces.find(surface => surface.id === 'story:DOC1')!.sourceHash).toBe(roadmapStory)
      Expect(edited.surfaces.find(surface => surface.id === 'acceptance:advanced-design')!.sourceHash).toBe(
        obligation,
      )
      await FS.writeText(
        FS.resolvePath('Docs/MVP Roadmap/Plan - Staged public releases.md', root),
        '# Staged public releases\n\nA changed obligation.\n',
      )
      Expect(
        (await new QaInventory(root).build(1)).surfaces.find(surface => surface.id === 'acceptance:advanced-design')!
          .sourceHash,
      ).not.toBe(obligation)
      const planPath = FS.resolvePath('Docs/MVP Roadmap/Plan - Initial release QA.md', root)
      await FS.writeText(planPath, (await FS.readText(planPath)).replace('| WEB5 |', '| WEB6 |'))
      await Expect(new QaInventory(root).build(1)).rejects.toThrow('WEB6 has no QA channel mapping')
    },
  )

  Test(
    'resumes immutable checks, refuses changed dependencies, and never converts a successful check into a reviewed story',
    async () => {
      const { root, qa } = await fixture()
      const run = await qa.run(1, 'all')
      const receipt = FS.resolvePath(`.artifacts/qa/runs/${run.runId}/tutorial.json`, root)
      const original = await FS.readText(receipt)
      await qa.run(1, 'all', run.runId)
      Expect(await FS.readText(receipt)).toBe(original)
      Expect((await FS.readJson<{ outcome: string }>(receipt)).outcome).toBe('pass')
      const linkReceipt = FS.resolvePath(`.artifacts/qa/runs/${run.runId}/links.json`, root)
      const links = await FS.readText(linkReceipt)
      Expect(JSON.parse(links).outcome).toBe('friction')
      Expect(JSON.parse(links).broken).toContainEqual({ source: 'README.md', target: 'missing.md' })
      await FS.remove(receipt)
      await FS.remove(FS.resolvePath(`.artifacts/qa/runs/${run.runId}/checks-complete.json`, root))
      await qa.run(1, 'all', run.runId)
      Expect(await FS.readText(linkReceipt)).toBe(links)
      Expect((await FS.readJson<{ outcome: string }>(receipt)).outcome).toBe('pass')
      await qa.report(1)
      const packet = await FS.readText(FS.resolvePath('Docs/QA/release-1.md', root))
      Expect(packet).toContain('**not-ready**')
      Expect(packet).toContain('story:DOC1 / functional / installed-cli / human: not-run')
      Expect(packet).not.toContain('- story:STU1 /')
      await FS.writeText(FS.resolvePath('packages/example/source.ts', root), 'export const value = 2\n')
      await Expect(qa.run(1, 'all', run.runId)).rejects.toThrow('Cannot resume changed source')
      const failedFixture = await fixture(1)
      const failedRun = await failedFixture.qa.run(1, 'all')
      Expect(
        (await FS.readJson<{ outcome: string }>(
          FS.resolvePath(`.artifacts/qa/runs/${failedRun.runId}/tutorial.json`, failedFixture.root),
        )).outcome,
      ).toBe('fail')
    },
  )

  Test(
    'rejects missing visual evidence and keeps historical judgments stale while separate human and channel cells remain unrun',
    async () => {
      const { root, qa } = await fixture()
      const run = await qa.run(1, 'all')
      const observation = {
        runId: run.runId,
        surfaceId: 'doc:README.md',
        dimension: 'text',
        channel: 'source',
        reviewer: 'agent',
        outcome: 'pass',
        notes: 'Inspected exact fixture paragraph.',
        evidence: [] as string[],
      }
      await Expect(qa.recordFile(await input(root, 'empty', observation))).rejects.toThrow('require linked evidence')
      const result = await qa.recordFile(
        await input(root, 'historical', {
          ...observation,
          evidence: ['README.md'],
          historical: true,
          observedAt: '2026-01-01T00:00:00.000Z',
          commit: 'd5bdeaefd037',
        }),
      )
      Expect(result.sourceHash.startsWith('historical:')).toBe(true)
      await qa.report(1)
      Expect(await FS.readText(FS.resolvePath('Docs/QA/release-1.md', root))).toContain(
        'doc:README.md / text / source / agent: needs-recheck',
      )
      await Expect(qa.recordFile(
        await input(root, 'visual-no-image', {
          ...observation,
          surfaceId: 'visual:Apps/Starters/Notebook/Notebook',
          dimension: 'visual',
          channel: '["App.tao","devices","phone"]',
          evidence: ['README.md'],
        }),
      )).rejects.toThrow('requires an inspected image')
      const image = '.artifacts/capture/phone.png'
      const tablet = '.artifacts/capture/tablet.png'
      await FS.writeText(FS.resolvePath(image, root), 'phone image bytes')
      await FS.writeText(FS.resolvePath(tablet, root), 'tablet image bytes')
      const visual = {
        ...observation,
        surfaceId: 'visual:Apps/Starters/Notebook/Notebook',
        dimension: 'visual',
        channel: '["App.tao","devices","phone"]',
      }
      const hashes = (await qa.recordFile(
        await input(root, 'visual-friction', { ...visual, outcome: 'friction', evidence: [image, tablet] }),
      )).evidence.map(item => item.sha256)
      const snapshot = async (
        name: string,
        status: string,
        tabletStatus: string,
        { app = 'Notebook', phoneShot = 'phone.png' } = {},
      ): Promise<string> => {
        const path = `.artifacts/capture/${name}.json`
        await FS.writeJson(FS.resolvePath(path, root), {
          owner: 'qa-capture',
          status,
          app,
          originalProject: await FS.realPath(FS.resolvePath('Apps/Starters/Notebook', root)),
          cells: [
            {
              key: '["App.tao"]',
              group: 'devices',
              label: 'phone',
              status: 'captured',
              screenshot: phoneShot,
              sha256: hashes[0],
            },
            {
              key: '["App.tao"]',
              group: 'devices',
              label: 'tabletDark',
              status: tabletStatus,
              screenshot: 'tablet.png',
              sha256: hashes[1],
            },
          ],
        })
        return path
      }
      const complete = await snapshot('complete', 'complete', 'captured')
      await Expect(qa.recordFile(await input(root, 'visual-no-snapshot', { ...visual, evidence: [image] })))
        .rejects.toThrow('complete source-snapshot.json')
      await Expect(
        qa.recordFile(
          await input(root, 'visual-partial', {
            ...visual,
            evidence: [image, await snapshot('partial', 'partial', 'failed')],
          }),
        ),
      ).rejects.toThrow('incomplete capture')
      const failedCell = await snapshot('failed-cell', 'complete', 'failed')
      await Expect(
        qa.recordFile(
          await input(root, 'visual-failed-cell', {
            ...visual,
            channel: '["App.tao","devices","tabletDark"]',
            evidence: [tablet, failedCell],
          }),
        ),
      ).rejects.toThrow('captured cell')
      await Expect(
        qa.recordFile(
          await input(root, 'visual-other-cell', {
            ...visual,
            channel: '["App.tao","devices","tabletDark"]',
            evidence: [image, complete],
          }),
        ),
      ).rejects.toThrow('shown by capture cell devices/tabletDark')
      const omitted = '.artifacts/capture/omitted.json'
      const receipt = await FS.readJson<{ cells: unknown[] }>(FS.resolvePath(complete, root))
      await FS.writeJson(FS.resolvePath(omitted, root), { ...receipt, cells: receipt.cells.slice(0, 1) })
      await Expect(qa.recordFile(await input(root, 'visual-omitted', { ...visual, evidence: [image, omitted] })))
        .rejects.toThrow('missing a required captured cell: devices/tabletDark')
      const otherApp = await snapshot('other-app', 'complete', 'captured', { app: 'Pantry' })
      await Expect(qa.recordFile(await input(root, 'visual-other-app', { ...visual, evidence: [image, otherApp] })))
        .rejects.toThrow('shown by captures of Notebook')
      const renamed = await snapshot('renamed', 'complete', 'captured', { phoneShot: 'other.png' })
      await Expect(qa.recordFile(await input(root, 'visual-renamed', { ...visual, evidence: [image, renamed] })))
        .rejects.toThrow('captured cell')
      await Expect(
        qa.recordFile(
          await input(root, 'visual-undeclared', {
            ...visual,
            surfaceId: 'story:WEB1',
            channel: 'public-site',
            evidence: [image, complete],
          }),
        ),
      ).rejects.toThrow('declares no capture cell')
      Expect(
        (await qa.recordFile(await input(root, 'visual-pass', { ...visual, evidence: [image, complete] }))).outcome,
      ).toBe('pass')
      Expect(
        (await qa.recordFile(
          await input(root, 'visual-person', { ...visual, reviewer: 'human', evidence: [image] }),
        )).reviewer,
      ).toBe('human')
      const site = { ...observation, surfaceId: 'story:WEB1', dimension: 'functional', channel: 'public-site' }
      await Expect(qa.recordFile(await input(root, 'site-no-url', { ...site, evidence: [image] })))
        .rejects.toThrow('https reviewedUrl')
      await Expect(
        qa.recordFile(
          await input(root, 'site-no-image', {
            ...site,
            reviewedUrl: 'https://example.com/tao',
            evidence: ['README.md'],
          }),
        ),
      ).rejects.toThrow('screenshot of that page')
      Expect(
        (await qa.recordFile(
          await input(root, 'site-pass', { ...site, reviewedUrl: 'https://example.com/tao', evidence: [image] }),
        )).reviewedUrl,
      ).toBe('https://example.com/tao')
      Expect((await new QaInventory(root).build(1)).dirty).toBe(false)
      await FS.writeText(FS.resolvePath('packages/example/source.ts', root), 'export const value = 3\n')
      const dirtyRun = await qa.run(1, 'all')
      const dirtyManifest = await FS.readJson<{ inventory: { commit: string } }>(
        FS.resolvePath(`.artifacts/qa/runs/${dirtyRun.runId}/manifest.json`, root),
      )
      await Expect(qa.recordFile(
        await input(root, 'dirty-artifact', {
          ...observation,
          runId: dirtyRun.runId,
          evidence: ['README.md'],
          artifact: { version: '0.1.0', digest: 'a'.repeat(64), sourceCommit: dirtyManifest.inventory.commit },
        }),
      )).rejects.toThrow('uncommitted inputs')
    },
  )

  Test('reports and selects each phase from its own observations', async () => {
    const { root, qa } = await fixture()
    const cell = {
      surfaceId: 'doc:README.md',
      dimension: 'text',
      channel: 'source',
      reviewer: 'agent',
      notes: 'Phase-scoped check.',
      evidence: ['README.md'],
    }
    const first = await qa.run(1, 'all')
    await qa.recordFile(await input(root, 'phase-1', { ...cell, runId: first.runId, outcome: 'pass' }))
    const second = await qa.run(2, 'all')
    await qa.recordFile(await input(root, 'phase-2', { ...cell, runId: second.runId, outcome: 'fail' }))
    await qa.report(1)
    const packet = await FS.readText(FS.resolvePath('Docs/QA/release-1.md', root))
    Expect(packet).not.toContain('- doc:README.md / text / source / agent:')
    Expect(packet).toContain('## Deferred beyond release 5\n\n- story:APP3:')
    const rerun = await FS.readJson<{ selected: string[] }>(
      FS.resolvePath(`.artifacts/qa/runs/${(await qa.run(1, 'changed')).runId}/manifest.json`, root),
    )
    Expect(rerun.selected).not.toContain('doc:README.md')
  })

  Test(
    'seeded findings cannot close on their own evidence, and later phases cannot close on earlier proof',
    async () => {
      const { root, qa } = await fixture()
      const seeded = {
        id: 'QA-SEEDED',
        surfaceId: 'doc:README.md',
        dimension: 'text',
        channel: 'source',
        phase: 1,
        severity: 'major',
        confidence: 'confirmed',
        title: 'Seeded problem',
        observed: 'Seeded observation.',
        impact: 'Seeded impact.',
        location: 'README.md:1',
        evidence: ['packages/example/source.ts'],
        expected: 'Seeded expectation.',
        recheck: 'Seeded recheck.',
        status: 'open',
        requiredReviewer: 'agent',
        relatedStories: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      await FS.writeJson(FS.resolvePath('Docs/QA/findings.json', root), [seeded])
      await FS.writeText(FS.resolvePath('.artifacts/recheck.md', root), 'Recheck notes.\n')
      const run = await qa.run(1, 'all')
      const pass = (evidence: string[]) => ({
        runId: run.runId,
        surfaceId: 'doc:README.md',
        dimension: 'text',
        channel: 'source',
        reviewer: 'agent',
        outcome: 'pass',
        notes: 'Rechecked.',
        evidence,
      })
      const reused = await qa.recordFile(await input(root, 'reused', pass(['packages/example/source.ts'])))
      const close = { ...seeded, status: 'verified-closed' }
      await Expect(qa.findingFile(await input(root, 'seed-self', { ...close, passingResultId: reused.id })))
        .rejects.toThrow("cannot cite the finding's own evidence")
      const fresh = await qa.recordFile(await input(root, 'fresh', pass(['.artifacts/recheck.md'])))
      await qa.findingFile(
        await input(root, 'later-phase', { ...seeded, id: 'QA-LATER', phase: 2, evidence: ['LICENSE'] }),
      )
      await Expect(
        qa.findingFile(
          await input(root, 'later-close', {
            ...close,
            id: 'QA-LATER',
            phase: 2,
            evidence: ['LICENSE'],
            passingResultId: fresh.id,
          }),
        ),
      ).rejects.toThrow('new, current passing observation')
      Expect((await qa.findingFile(await input(root, 'seed-close', { ...close, passingResultId: fresh.id }))).status)
        .toBe('verified-closed')
    },
  )

  Test('a duplicate stays unresolved until the original it names is proved', async () => {
    const { root, qa } = await fixture()
    const finding = {
      surfaceId: 'doc:README.md',
      dimension: 'text',
      channel: 'source',
      phase: 1,
      severity: 'blocking',
      confidence: 'confirmed',
      observed: 'Observed.',
      impact: 'Impact.',
      location: 'README.md:1',
      expected: 'Expected.',
      recheck: 'Recheck.',
      evidence: ['README.md'],
      status: 'open',
    }
    await qa.findingFile(await input(root, 'original', { ...finding, id: 'QA-ORIGINAL', title: 'Original' }))
    await qa.findingFile(await input(root, 'copy', { ...finding, id: 'QA-COPY', title: 'Copy' }))
    await qa.findingFile(
      await input(root, 'elsewhere', {
        ...finding,
        id: 'QA-ELSEWHERE',
        title: 'Elsewhere',
        surfaceId: 'doc:LICENSE',
        location: 'LICENSE:1',
        evidence: ['LICENSE'],
      }),
    )
    const duplicate = { ...finding, id: 'QA-COPY', title: 'Copy', status: 'duplicate' }
    await Expect(qa.findingFile(await input(root, 'dup-elsewhere', { ...duplicate, duplicateOf: 'QA-ELSEWHERE' })))
      .rejects.toThrow('unresolved original on the same surface')
    await Expect(qa.findingFile(await input(root, 'dup-self', { ...duplicate, duplicateOf: 'QA-COPY' })))
      .rejects.toThrow('unresolved original on the same surface')
    await qa.findingFile(await input(root, 'dup', { ...duplicate, duplicateOf: 'QA-ORIGINAL' }))
    await Expect(
      qa.findingFile(
        await input(root, 'dup-cycle', {
          ...finding,
          id: 'QA-ORIGINAL',
          title: 'Original',
          status: 'duplicate',
          duplicateOf: 'QA-COPY',
        }),
      ),
    ).rejects.toThrow('unresolved original')
    await qa.report(1)
    Expect(await FS.readText(FS.resolvePath('Docs/QA/release-1.md', root))).toContain('- QA-COPY (duplicate;')
    await FS.writeText(FS.resolvePath('.artifacts/recheck.md', root), 'Recheck notes.\n')
    const run = await qa.run(1, 'all')
    const pass = await qa.recordFile(
      await input(root, 'pass', {
        runId: run.runId,
        surfaceId: 'doc:README.md',
        dimension: 'text',
        channel: 'source',
        reviewer: 'agent',
        outcome: 'pass',
        notes: 'Rechecked.',
        evidence: ['.artifacts/recheck.md'],
      }),
    )
    await qa.findingFile(
      await input(root, 'close', {
        ...finding,
        id: 'QA-ORIGINAL',
        title: 'Original',
        status: 'verified-closed',
        passingResultId: pass.id,
      }),
    )
    await qa.report(1)
    Expect(await FS.readText(FS.resolvePath('Docs/QA/release-1.md', root))).not.toContain('- QA-COPY (')
  })

  Test(
    'closes only on a newer current linked recheck and retains creation time, event history, and stale evidence',
    async () => {
      const { root, qa } = await fixture()
      const run = await qa.run(1, 'all')
      const finding = {
        id: 'QA-FIXTURE-PROBLEM',
        surfaceId: 'doc:README.md',
        dimension: 'text',
        channel: 'source',
        phase: 1,
        severity: 'major',
        observed: 'The fixture paragraph requires guessing.',
        impact: 'A reader cannot choose a next action.',
        location: 'README.md:1',
        confidence: 'confirmed',
        title: 'Fixture wording is confusing',
        expected: 'Clear wording',
        recheck: 'Read fixture again',
        evidence: ['README.md'],
        status: 'open',
      }
      const open = await qa.findingFile(await input(root, 'finding-open', finding))
      const humanFinding = { ...finding, id: 'QA-HUMAN-FIXTURE', requiredReviewer: 'human' }
      await qa.findingFile(await input(root, 'human-open', humanFinding))
      await Expect(
        qa.findingFile(
          await input(root, 'finding-bad-close', { ...finding, status: 'verified-closed', passingResultId: 'absent' }),
        ),
      ).rejects.toThrow('new, current passing observation')
      const failed = await qa.recordFile(
        await input(root, 'failing', {
          runId: run.runId,
          surfaceId: 'doc:README.md',
          dimension: 'text',
          channel: 'source',
          reviewer: 'agent',
          outcome: 'fail',
          notes: 'Fixture still confusing.',
          evidence: ['README.md'],
        }),
      )
      await Expect(
        qa.findingFile(
          await input(root, 'finding-failed-close', {
            ...finding,
            status: 'verified-closed',
            passingResultId: failed.id,
          }),
        ),
      ).rejects.toThrow('new, current passing observation')
      const recheck = {
        surfaceId: 'doc:README.md',
        dimension: 'text',
        channel: 'source',
        reviewer: 'agent',
        outcome: 'pass',
        notes: 'Fixture rechecked.',
        evidence: ['README.md'],
      }
      const unchanged = await qa.recordFile(await input(root, 'unchanged', { ...recheck, runId: run.runId }))
      await Expect(
        qa.findingFile(
          await input(root, 'finding-self-proof', {
            ...finding,
            status: 'verified-closed',
            passingResultId: unchanged.id,
          }),
        ),
      ).rejects.toThrow("cannot cite the finding's own evidence")
      await FS.writeText(FS.resolvePath('README.md', root), '# Fixture\n\nClear wording.\n')
      await qa.findingFile(await input(root, 'finding-fixed', { ...finding, status: 'fixed-awaiting-qa' }))
      const fixedRun = await qa.run(1, 'changed')
      const result = await qa.recordFile(await input(root, 'passing', { ...recheck, runId: fixedRun.runId }))
      const closeInput = await input(root, 'finding-close', {
        ...finding,
        status: 'verified-closed',
        passingResultId: result.id,
      })
      await Expect(
        qa.findingFile(
          await input(root, 'agent-cannot-close-human', {
            ...humanFinding,
            status: 'verified-closed',
            passingResultId: result.id,
          }),
        ),
      ).rejects.toThrow('new, current passing observation')
      const recheckRun = await qa.run(1, 'changed')
      const recheckManifest = await FS.readJson<{ selected: string[] }>(
        FS.resolvePath(`.artifacts/qa/runs/${recheckRun.runId}/manifest.json`, root),
      )
      Expect(recheckManifest.selected).toContain('doc:README.md')
      await Expect(qa.findingFile(await input(root, 'weaken-obligation', { ...finding, requiredReviewer: 'human' })))
        .rejects.toThrow('cannot weaken or replace')
      const concurrent = await Promise.allSettled([qa.findingFile(closeInput), qa.findingFile(closeInput)])
      Expect(concurrent.filter(item => item.status === 'fulfilled')).toHaveLength(1)
      Expect(concurrent.filter(item => item.status === 'rejected')).toHaveLength(1)
      const closed = concurrent.find(item => item.status === 'fulfilled')!.value
      Expect(closed.createdAt).toBe(open.createdAt)
      Expect(closed.status).toBe('verified-closed')
      Expect(
        (await FS.listDir(FS.resolvePath('Docs/QA/findings/QA-FIXTURE-PROBLEM', root))).filter(name =>
          name.endsWith('.json')
        ),
      ).toHaveLength(3)
      await qa.report(2)
      Expect(await FS.readText(FS.resolvePath('Docs/QA/release-2.md', root))).not.toContain(
        'QA-FIXTURE-PROBLEM (closure-needs-recheck;',
      )
      await FS.writeText(FS.resolvePath('README.md', root), 'Changed content after review.\n')
      await qa.report(1)
      Expect(await FS.readText(FS.resolvePath('Docs/QA/release-1.md', root))).toContain(
        'doc:README.md / text / source / agent: needs-recheck',
      )
      Expect(await FS.readText(FS.resolvePath('Docs/QA/release-1.md', root))).toContain(
        'QA-FIXTURE-PROBLEM (closure-needs-recheck;',
      )
    },
  )
})

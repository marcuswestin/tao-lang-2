import { CLI, FS, Repo } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'
import { QaInventory } from '../dev-cli-src/qa/QaInventory'
import { QaRegister } from '../dev-cli-src/qa/QaRegister'

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
        'Docs/ArChIvE/old.md': 'Frozen historical document',
        'LICENSE': 'Fixture license',
        'packages/example/source.ts': 'export const value = 1\n',
        'Docs/MVP Roadmap/Plan - Initial release QA.md': await FS.readText(
          Repo.resolvePath('Docs/MVP Roadmap/Plan - Initial release QA.md'),
        ),
        'agent': `#!/bin/sh\nprintf "fixture tutorial source check\\n"\nexit ${exitCode}\n`,
      },
    },
  })
  await FS.chmod(FS.resolvePath('agent', root), 0o755)
  await CLI.mustRun('git', { args: ['commit', '-qam', 'Make the fixture agent executable'], cwd: root })
  return { root, qa: new QaRegister(root) }
}

async function input(root: string, name: string, value: unknown): Promise<string> {
  const path = `.artifacts/${name}.json`
  await FS.writeJson(FS.resolvePath(path, root), value)
  return path
}

Describe('QA evidence register', () => {
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
      Expect(inventory.surfaces.find(surface => surface.id === 'story:WEB2')?.channels).toEqual(['public-site'])
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
      await FS.writeText(FS.resolvePath('Docs/Roadmap/Plan.md', root), 'A plan edit.\n')
      const edited = await new QaInventory(root).build(1)
      Expect(edited.dirty).toBe(true)
      Expect(edited.surfaces.find(surface => surface.id === 'story:DOC1')!.sourceHash).toBe(roadmapStory)
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
          surfaceId: 'visual:notebook',
          dimension: 'visual',
          channel: 'phone',
          evidence: ['README.md'],
        }),
      )).rejects.toThrow('requires an inspected image')
      const image = '.artifacts/capture/phone.png'
      await FS.writeText(FS.resolvePath(image, root), 'image bytes')
      const imageHash = (await qa.recordFile(
        await input(root, 'visual-human', {
          ...observation,
          surfaceId: 'visual:notebook',
          dimension: 'visual',
          channel: 'phone',
          reviewer: 'agent',
          outcome: 'friction',
          evidence: [image],
        }),
      )).evidence[0]!.sha256
      const visual = { ...observation, surfaceId: 'visual:notebook', dimension: 'visual', channel: 'phone' }
      await Expect(qa.recordFile(await input(root, 'visual-no-manifest', { ...visual, evidence: [image] })))
        .rejects.toThrow('must cite the review manifest')
      await FS.writeJson(FS.resolvePath('.artifacts/capture/failed.json', root), {
        cells: [{ key: 'phone', label: 'phone', status: 'failed', sha256: imageHash }],
      })
      await Expect(
        qa.recordFile(
          await input(root, 'visual-failed-cell', { ...visual, evidence: [image, '.artifacts/capture/failed.json'] }),
        ),
      ).rejects.toThrow('match a captured cell')
      await FS.writeJson(FS.resolvePath('.artifacts/capture/manifest.json', root), {
        cells: [{ key: 'phone', label: 'phone', status: 'captured', sha256: imageHash }],
      })
      await FS.writeJson(FS.resolvePath('.artifacts/capture/source-snapshot.json', root), {
        owner: 'qa-capture',
        status: 'partial',
      })
      await Expect(
        qa.recordFile(
          await input(root, 'visual-partial', {
            ...visual,
            evidence: [image, '.artifacts/capture/manifest.json', '.artifacts/capture/source-snapshot.json'],
          }),
        ),
      ).rejects.toThrow('incomplete capture')
      Expect(
        (await qa.recordFile(
          await input(root, 'visual-pass', { ...visual, evidence: [image, '.artifacts/capture/manifest.json'] }),
        )).outcome,
      ).toBe('pass')
      Expect(
        (await qa.recordFile(
          await input(root, 'visual-person', { ...visual, reviewer: 'human', evidence: [image] }),
        )).reviewer,
      ).toBe('human')
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
      ).toHaveLength(2)
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

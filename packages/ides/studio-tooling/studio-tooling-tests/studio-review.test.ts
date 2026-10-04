import { Errors, FS, Repo } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, mkTestDir, Test } from '@shared/test'
import { createHash } from 'node:crypto'
import type { StudioCdpBrowserEvent } from '../studio-tooling-src/StudioCdp'
import {
  runStudioReview,
  StudioReview,
  type StudioReviewCell,
  type StudioReviewManifest,
} from '../studio-tooling-src/StudioReview'

const renderer = {
  colorGamut: 'srgb' as const,
  deviceScaleFactor: 1,
  fontFingerprint: '[]',
  jsVersion: '14.2',
  locale: 'en-US',
  platform: 'MacIntel',
  product: 'Chrome/142.0.1',
  protocolVersion: '1.3',
  timezone: 'America/New_York',
  userAgent: 'Fake Chrome',
}

Describe('Studio visual review', () => {
  Test('retains failed-page evidence before closing a renderer that never publishes a manifest', async () => {
    const root = await mkTestDir('studio-review-failure-')
    const artifactRoot = FS.resolvePath('review', root)
    const order: string[] = []
    try {
      await Expect(runStudioReview(Repo.getRoot(), { artifactRoot }, {
        launchBrowser: async () => ({
          browserEvents: () => [{ kind: 'console', level: 'error', text: 'secret-token=never-write-this' }],
          captureElementScreenshotAt: async (path, selector) => {
            Expect(selector).toBe('body')
            order.push('capture')
            await FS.writeText(path, 'failed page pixels')
            return path
          },
          close: async () => {
            order.push('close')
          },
          evaluate: async <Result>(expression: string) => {
            Expect(expression).not.toContain('outerHTML')
            Expect(expression).not.toContain('textContent')
            return {
              gridCount: 1,
              manifestCount: 0,
              frameCount: 2,
              cells: [{ key: 'main', status: 'failed', input: 'secret-token=never-write-this' }],
              html: 'secret-token=never-write-this',
            } as Result
          },
          frameIdOf: async () => undefined,
          goto: async () => {},
          rendererFingerprint: async () => renderer,
          waitFor: async () => Errors.throwHostEnvironment('Review manifest unavailable'),
        }),
        now: () => new Date('2026-09-26T00:00:00.000Z'),
        randomId: () => 'failure-test',
        startStudio: async () => ({
          output: () => 'compile error details',
          readiness: {
            artifactRoot,
            launchId: 'failure-launch',
            lifecycleLogPath: 'lifecycle.jsonl',
            manifestPath: 'launch.json',
            mode: 'browser',
            previewUrl: 'http://localhost:42001',
            projectRoot: Repo.getRoot(),
            sessionId: 'failure-session',
            sessionUrl: 'http://localhost:42000/sessions/failure-session',
            studioUrl: 'http://localhost:42000',
            version: 1,
          },
          stop: async () => {
            order.push('stop')
          },
        }),
      })).rejects.toThrow('Review manifest unavailable')
      Expect(order).toEqual(['capture', 'close', 'stop'])
      Expect(await FS.readText(FS.resolvePath('failure.png', artifactRoot))).toBe('failed page pixels')
      Expect(await FS.readJson(FS.resolvePath('logs/failure-page.json', artifactRoot))).toEqual({
        gridCount: 1,
        manifestCount: 0,
        frameCount: 2,
        cells: [{ key: 'main', status: 'failed' }],
      })
      Expect(await FS.isFile(FS.resolvePath('logs/failure-page.html', artifactRoot))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('logs/studio.log', artifactRoot))).toBe('compile error details')
      Expect(await FS.readJson(FS.resolvePath('logs/browser-events.json', artifactRoot))).toEqual([
        { kind: 'console', level: 'error' },
      ])
      for (const path of ['logs/browser-events.json', 'logs/failure-page.json', 'failure.json']) {
        Expect(await FS.readText(FS.resolvePath(path, artifactRoot))).not.toContain('secret-token')
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('captures each ready viewport and releases both browser and Studio launch', async () => {
    const run = await reviewOneCell([{
      frameId: 'studio-frame',
      kind: 'console',
      level: 'error',
      text: 'secret-token=never-write-this',
      timestamp: 17,
    }])

    Expect(run.navigatedTo).toBe('http://127.0.0.1:42000/sessions/session-1')
    Expect(run.captureSelectors).toHaveLength(2)
    Expect(run.captureSelectors.every(selector => selector.endsWith('> .studio-preview-cell-viewport'))).toBe(true)
    Expect(run.browserClosed).toBe(true)
    Expect(run.studioStopped).toBe(true)
    Expect(run.manifest.cells[0]?.status).toBe('captured')
    Expect(await FS.readJson(FS.resolvePath('logs/browser-events.json', run.artifactRoot))).toEqual([{
      kind: 'console',
      level: 'error',
      timestamp: 17,
    }])
  })

  Test('fails a screenshot whose own preview logged an error, without copying the message', async () => {
    const run = await reviewOneCell([
      { frameId: 'cell-frame', kind: 'console', level: 'warning', text: 'a dev warning' },
      { frameId: 'cell-frame', kind: 'exception', level: 'error', text: 'secret-token=never-write-this' },
    ])

    const cell = run.manifest.cells[0]
    Expect(cell?.status).toBe('failed')
    Expect(cell?.error).toBe('The preview logged 1 error(s) or uncaught exception(s) in the browser console.')
    Expect(JSON.stringify(run.manifest)).not.toContain('secret-token')
  })

  Test('fails a screenshot whose preview frame it cannot find rather than skipping the console check', async () => {
    const run = await reviewOneCell([{ kind: 'console', level: 'error', text: 'unattributed' }], null)

    Expect(run.manifest.cells[0]?.status).toBe('failed')
    Expect(run.manifest.cells[0]?.error).toBe('The preview frame was not found, so its console could not be checked.')
  })

  Test('classifies structural, rendering, and environment changes without inventing a pixel verdict', () => {
    const captured = (sha256: string): StudioReviewCell => ({
      environment: {},
      group: 'default',
      key: 'Main.tao::default::phone',
      label: 'Phone',
      renderInputs: { arguments: { state: 'ready' } },
      screenshot: 'screenshots/phone.png',
      sha256,
      status: 'captured',
    })
    const failed: StudioReviewCell = { ...captured('bad'), error: 'render failed', status: 'failed' }

    Expect(StudioReview.testing.pairStatus(captured('a'), captured('a'), true)).toBe('unchanged')
    Expect(StudioReview.testing.pairStatus(captured('a'), captured('a'), false)).toBe('incomparable')
    Expect(StudioReview.testing.pairStatus(
      captured('a'),
      { ...captured('a'), environment: { scheme: 'dark' } },
      true,
    )).toBe('incomparable')
    Expect(StudioReview.testing.pairStatus(
      captured('a'),
      { ...captured('a'), renderInputs: { arguments: { state: 'error' } } },
      true,
    )).toBe('incomparable')
    Expect(StudioReview.testing.pairStatus(failed, captured('a'), true)).toBe('failed')
  })

  Test('writes a portable paired report, copied baseline evidence, and separate annotations', async () => {
    const root = await mkTestDir('tao-studio-review-')
    try {
      const baselineRoot = FS.resolvePath('baseline-review', root)
      const artifactRoot = FS.resolvePath('current-review', root)
      await FS.writeText(FS.resolvePath('screenshots/phone.png', baselineRoot), 'old phone')
      await FS.writeText(FS.resolvePath('screenshots/tablet.png', baselineRoot), 'old tablet')
      await FS.writeText(FS.resolvePath('screenshots/phone.png', artifactRoot), 'new phone')
      await FS.writeText(FS.resolvePath('screenshots/new.png', artifactRoot), 'new scenario')
      const baselineManifest = reviewManifest('baseline', [
        reviewCell('lost', 'Missing evidence', 'screenshots/missing.png', hashText('missing evidence')),
        reviewCell('phone', 'Phone', 'screenshots/phone.png', hashText('old phone')),
        reviewCell('tablet', 'Tablet', 'screenshots/tablet.png', hashText('old tablet')),
      ])

      const result = await StudioReview.testing.writeReviewArtifacts({
        artifactRoot,
        baseline: { manifest: baselineManifest, root: baselineRoot },
        cells: [
          reviewCell('lost', 'Missing evidence', 'screenshots/new.png', hashText('new scenario')),
          reviewCell('phone', 'Phone', 'screenshots/phone.png', hashText('new phone')),
          reviewCell('new', 'New scenario', 'screenshots/new.png', hashText('new scenario')),
        ],
        createdAt: '2026-09-03T12:00:00.000Z',
        renderer,
        reviewId: 'current',
        surface: {
          appName: 'Cards',
          compileRevision: 7,
          entryPath: 'Cards.tao',
          manifestRevision: 'manifest-7',
          sourceVersions: { 'Cards.tao': 'source-7' },
        },
      })

      const written = await FS.readJson<StudioReviewManifest>(result.manifestPath)
      Expect(written.project).toEqual({ appName: 'Cards', entryPath: 'Cards.tao' })
      Expect('browserEvents' in written).toBe(false)
      Expect(written.comparison?.pairs.map(pair => [pair.key, pair.status])).toEqual([
        ['lost', 'failed'],
        ['new', 'added'],
        ['phone', 'changed'],
        ['tablet', 'removed'],
      ])
      const copiedBefore = written.comparison?.pairs.find(pair => pair.key === 'phone')?.baselineScreenshot
      Expect(copiedBefore).toMatch(/^baseline\//u)
      Expect(await FS.readText(FS.resolvePath(copiedBefore!, artifactRoot))).toBe('old phone')
      Expect(await FS.readJson(FS.resolvePath('annotations.json', artifactRoot))).toEqual({
        comments: [],
        decisions: [],
        reviewId: 'current',
        version: 1,
      })
      const html = await FS.readText(result.reportPath)
      // REMOVAL CANDIDATE: Static report controls; dropping these trades emitted UI presence while pair and annotation semantics remain covered.
      Expect(html).toContain('Side by side')
      Expect(html).toContain('Opacity overlay')
      Expect(html).toContain('@media(prefers-reduced-motion:reduce)')
      Expect(html).toContain('Export annotations')
      Expect(html).toContain('Import annotations')
      Expect(html).toContain('Comment <textarea')
      const script = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
      Expect(script).toBeDefined()
      Expect(() => new Function(script!)).not.toThrow()
      Expect(result.statusCounts).toMatchObject({ added: 1, changed: 1, failed: 1, removed: 1 })
    } finally {
      await FS.remove(root)
    }
  })

  Test('uses a readable but collision-resistant screenshot name derived from the portable key', () => {
    const phone = StudioReview.testing.reviewScreenshotName({
      group: 'Responsive states',
      key: 'Main.tao::Responsive states::Phone',
      label: 'Phone / signed in',
    })
    const other = StudioReview.testing.reviewScreenshotName({
      group: 'Responsive states',
      key: 'Other.tao::Responsive states::Phone',
      label: 'Phone / signed in',
    })

    Expect(phone).toMatch(/^responsive-states-phone-signed-in-[a-f0-9]{12}\.png$/u)
    Expect(other).not.toBe(phone)
  })

  Test('rejects a baseline for another app before treating its pixels as evidence', async () => {
    const root = await mkTestDir('tao-studio-review-project-')
    try {
      const baselineRoot = FS.resolvePath('baseline-review', root)
      const artifactRoot = FS.resolvePath('current-review', root)
      await FS.writeText(FS.resolvePath('screenshots/phone.png', baselineRoot), 'old phone')
      await FS.writeText(FS.resolvePath('screenshots/phone.png', artifactRoot), 'new phone')
      const baseline = reviewManifest('baseline', [
        reviewCell('phone', 'Phone', 'screenshots/phone.png', hashText('old phone')),
      ])
      baseline.project = { appName: 'Other', entryPath: 'Other.tao' }

      await Expect(StudioReview.testing.writeReviewArtifacts({
        artifactRoot,
        baseline: { manifest: baseline, root: baselineRoot },
        cells: [reviewCell('phone', 'Phone', 'screenshots/phone.png', hashText('new phone'))],
        createdAt: '2026-09-03T12:00:00.000Z',
        renderer,
        reviewId: 'current',
        surface: {
          appName: 'Cards',
          compileRevision: 7,
          entryPath: 'Cards.tao',
          manifestRevision: 'manifest-7',
          sourceVersions: {},
        },
      })).rejects.toThrow('Baseline review is for Other (Other.tao), not Cards (Cards.tao)')
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects duplicate portable cell keys', async () => {
    const root = await mkTestDir('tao-studio-review-duplicates-')
    try {
      const artifactRoot = FS.resolvePath('current-review', root)
      await FS.mkdir(artifactRoot)
      const duplicate = reviewCell('phone', 'Phone', 'screenshots/phone.png', hashText('phone'))
      await Expect(StudioReview.testing.writeReviewArtifacts({
        artifactRoot,
        cells: [duplicate, { ...duplicate, label: 'Phone duplicate' }],
        createdAt: '2026-09-03T12:00:00.000Z',
        renderer,
        reviewId: 'current',
        surface: {
          appName: 'Cards',
          compileRevision: 7,
          entryPath: 'Cards.tao',
          manifestRevision: 'manifest-7',
          sourceVersions: {},
        },
      })).rejects.toThrow('current review contains duplicate cell key: phone')
    } finally {
      await FS.remove(root)
    }
  })

  Test('fails closed when baseline bytes do not match their manifest digest or escape through a symlink', async () => {
    const root = await mkTestDir('tao-studio-review-evidence-')
    try {
      const baselineRoot = FS.resolvePath('baseline-review', root)
      const artifactRoot = FS.resolvePath('current-review', root)
      const external = FS.resolvePath('external.png', root)
      await FS.writeText(external, 'external pixels')
      await FS.symlink(external, FS.resolvePath('screenshots/link.png', baselineRoot))
      await FS.writeText(FS.resolvePath('screenshots/tampered.png', baselineRoot), 'tampered pixels')
      await FS.writeText(FS.resolvePath('screenshots/current.png', artifactRoot), 'current pixels')
      const baseline = reviewManifest('baseline', [
        reviewCell('link', 'Link', 'screenshots/link.png', hashText('external pixels')),
        reviewCell('tampered', 'Tampered', 'screenshots/tampered.png', hashText('expected pixels')),
      ])

      const result = await StudioReview.testing.writeReviewArtifacts({
        artifactRoot,
        baseline: { manifest: baseline, root: baselineRoot },
        cells: [
          reviewCell('link', 'Link', 'screenshots/current.png', hashText('current pixels')),
          reviewCell('tampered', 'Tampered', 'screenshots/current.png', hashText('current pixels')),
        ],
        createdAt: '2026-09-03T12:00:00.000Z',
        renderer,
        reviewId: 'current',
        surface: {
          appName: 'Cards',
          compileRevision: 7,
          entryPath: 'Cards.tao',
          manifestRevision: 'manifest-7',
          sourceVersions: {},
        },
      })
      const written = await FS.readJson<StudioReviewManifest>(result.manifestPath)
      Expect(written.comparison?.pairs.map(pair => [pair.key, pair.status])).toEqual([
        ['link', 'failed'],
        ['tampered', 'failed'],
      ])
    } finally {
      await FS.remove(root)
    }
  })
})

async function reviewOneCell(events: readonly StudioCdpBrowserEvent[], frameId: string | null = 'cell-frame') {
  const root = await mkGitTestDir('tao-studio-review-test-')
  const projectRoot = FS.resolvePath('project', root)
  const artifactRoot = FS.resolvePath('output', root)
  await initGitTestRepository(root)
  await FS.mkdir(projectRoot)
  const surface = {
    cells: [{
      environment: { viewport: { height: 844, width: 390 } },
      group: 'states',
      key: '["Main.tao","states","phone"]',
      label: 'phone',
      renderInputs: { arguments: { State: 'ready' } },
      status: 'ready',
    }],
    manifest: {
      appName: 'Cards',
      compileRevision: 4,
      entryPath: 'Main.tao',
      manifestRevision: 'manifest-4',
      sourceVersions: { 'Main.tao': 'source-4' },
    },
  } as const
  const captureSelectors: string[] = []
  let browserClosed = false
  let studioStopped = false
  let navigatedTo = ''
  const result = await runStudioReview(projectRoot, { artifactRoot }, {
    launchBrowser: async () => ({
      browserEvents: () => events,
      captureElementScreenshotAt: async (path, selector) => {
        captureSelectors.push(selector)
        await FS.writeText(path, 'stable pixels')
        return path
      },
      close: async () => {
        browserClosed = true
      },
      evaluate: async <Result>(expression: string) => {
        return (expression.includes('rawManifest') ? surface : true) as Result
      },
      frameIdOf: async () => frameId ?? undefined,
      goto: async url => {
        navigatedTo = url
      },
      rendererFingerprint: async () => renderer,
      waitFor: async () => {},
    }),
    now: () => new Date('2026-09-03T12:00:00.000Z'),
    randomId: () => '12345678-rest',
    startStudio: async () => ({
      output: () => 'Studio ready',
      readiness: {
        artifactRoot: '/tmp/studio',
        launchId: 'launch-1',
        lifecycleLogPath: '/tmp/studio/lifecycle.jsonl',
        manifestPath: '/tmp/studio/launch.json',
        mode: 'browser',
        previewUrl: 'http://127.0.0.1:42001',
        projectRoot,
        sessionId: 'session-1',
        sessionUrl: 'http://127.0.0.1:42000/sessions/session-1',
        studioUrl: 'http://127.0.0.1:42000',
        version: 1,
      },
      stop: async () => {
        studioStopped = true
      },
    }),
  })
  return {
    artifactRoot,
    browserClosed,
    captureSelectors,
    manifest: await FS.readJson<StudioReviewManifest>(result.manifestPath),
    navigatedTo,
    studioStopped,
  }
}

function reviewCell(key: string, label: string, screenshot: string, sha256: string): StudioReviewCell {
  return {
    environment: {},
    group: 'default',
    key,
    label,
    renderInputs: {},
    screenshot,
    sha256,
    status: 'captured',
  }
}

function reviewManifest(reviewId: string, cells: readonly StudioReviewCell[]): StudioReviewManifest {
  return {
    cells,
    createdAt: '2026-09-02T12:00:00.000Z',
    project: { appName: 'Cards', entryPath: 'Cards.tao' },
    renderer,
    reviewId,
    studio: { compileRevision: 6, manifestRevision: 'manifest-6', sourceVersions: {} },
    version: 1,
  }
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

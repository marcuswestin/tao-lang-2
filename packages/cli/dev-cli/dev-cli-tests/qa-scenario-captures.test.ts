import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test, withCapturedOutput } from '@shared/test'
import { QaScenarioCaptures } from '../dev-cli-src/qa/QaScenarioCaptures'

async function fixture(): Promise<string> {
  const root = await mkGitTestDir('qa-scenario-captures-')
  await initGitTestRepository(root, {
    commit: {
      files: {
        '.gitignore': '.artifacts/\n',
        'Apps/Alpha/.tao/.gitignore': 'local/\n',
        'Apps/Alpha/App.tao': `app Alpha { id "alpha" }
scenarios Alpha "devices" {
  device phone
  scenario "phone" {}
  scenario "dark" { appearance dark }
}`,
        'Apps/Beta/.tao/.gitignore': 'local/\n',
        'Apps/Beta/App.tao': `app Beta { id "beta" }
scenarios Beta "devices" { device phone scenario "phone" {} }`,
      },
    },
  })
  return root
}

async function runCaptured(capture: QaScenarioCaptures, options: Parameters<QaScenarioCaptures['run']>[0]) {
  return (await withCapturedOutput(() => capture.run(options))).result
}

Describe('discovered scenario captures', () => {
  Test('the capture CLI exits unsuccessfully when discovery has no capturable scenario apps', async () => {
    const root = await mkGitTestDir('qa-capture-cli-')
    await initGitTestRepository(root, { commit: { files: { 'README.md': 'No scenario apps.\n' } } })
    const result = await CLI.run('bun', {
      args: [
        Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev.ts'),
        'qa-capture',
        '--output',
        '.artifacts/empty-captures',
      ],
      cwd: root,
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    Expect(result.exitCode).toBe(1)
    Expect(await FS.readJson<{ status: string }>(FS.resolvePath('.artifacts/empty-captures/coverage.json', root)))
      .toMatchObject({ status: 'partial' })
  })

  Test(
    'reports omitted and failed cells even when the browser claims a complete capture, then captures the next app',
    async () => {
      const root = await fixture()
      const launched: string[] = []
      const capture = new QaScenarioCaptures(root, async (app, output, budget) => {
        launched.push(app.app)
        Expect(budget).toBe(45_000)
        const screenshot = FS.resolvePath(`${output}/phone.png`, root)
        await FS.writeText(screenshot, `${app.app} screenshot`)
        await FS.writeJson(FS.resolvePath(`${output}/source-snapshot.json`, root), {
          owner: 'qa-capture',
          app: app.app,
          originalProject: await FS.realPath(FS.resolvePath(app.project, root)),
          status: 'complete',
          cells: [{
            key: JSON.stringify(['App.tao', 'devices', 'phone']),
            group: 'devices',
            label: 'phone',
            status: app.app === 'Alpha' ? 'failed' : 'captured',
            screenshot: 'phone.png',
            sha256: Platform.sha256Hex(await FS.readFile(screenshot)),
          }],
        })
      })
      const result = await runCaptured(capture, { output: '.artifacts/captures', timeoutSeconds: 45 })
      Expect(launched).toEqual(['Alpha', 'Beta'])
      Expect(result.status).toBe('partial')
      Expect(result.apps[0]!.cells.map(cell => [cell.label, cell.status])).toEqual([
        ['dark', 'missing'],
        ['phone', 'failed'],
      ])
      Expect(result.apps[1]!.status).toBe('complete')
      Expect(result.counts).toEqual({ captured: 1, failed: 1, missing: 1 })
      Expect(await FS.readJson(FS.resolvePath(result.report, root))).toEqual(result)
    },
  )

  Test('a launch failure leaves every expected cell missing and does not stop subsequent apps', async () => {
    const root = await fixture()
    const launched: string[] = []
    const capture = new QaScenarioCaptures(root, async app => {
      launched.push(app.app)
      Errors.throwHostEnvironment('The renderer failed to start.')
    })
    const result = await runCaptured(capture, { output: '.artifacts/failed', timeoutSeconds: 30 })
    Expect(launched).toEqual(['Alpha', 'Beta'])
    Expect(result.apps.map(app => app.status)).toEqual(['failed', 'failed'])
    Expect(result.counts).toEqual({ captured: 0, failed: 0, missing: 3 })
    Expect(result.apps[0]!.error).toContain('renderer failed to start')
    Expect(result.apps[0]!.cells[0]!.error).toContain('Capture failed before this cell was recorded')
  })

  Test('bounds a real child process, retains the deadline diagnosis, and proceeds to the next app', async () => {
    const root = await fixture()
    await FS.writeText(
      FS.resolvePath('dev', root),
      `#!/bin/sh
if [ "$2" = "Apps/Alpha" ]; then
  sleep 1
else
  printf 'second app attempted\\n'
  exit 1
fi
`,
    )
    await FS.chmod(FS.resolvePath('dev', root), 0o755)
    // budget-ok: deliberate process watchdog fixture; a short deadline proves termination, not product speed.
    const result = await runCaptured(new QaScenarioCaptures(root), {
      output: '.artifacts/bounded',
      timeoutSeconds: 0.1,
    })
    Expect(result.apps.map(app => app.status)).toEqual(['failed', 'failed'])
    Expect(await FS.readText(FS.resolvePath('.artifacts/bounded/app-1.log', root))).toContain('timed out after')
    Expect(await FS.readText(FS.resolvePath('.artifacts/bounded/app-2.log', root))).toContain('second app attempted')
    Expect(result.counts.missing).toBe(3)
  })

  Test('same-named cells from another file and absent or changed images cannot fill coverage', async () => {
    const root = await fixture()
    const capture = new QaScenarioCaptures(root, async (app, output) => {
      await FS.writeText(FS.resolvePath(`${output}/changed.png`, root), 'changed screenshot bytes')
      await FS.writeJson(FS.resolvePath(`${output}/source-snapshot.json`, root), {
        owner: 'qa-capture',
        app: app.app,
        originalProject: await FS.realPath(FS.resolvePath(app.project, root)),
        status: 'complete',
        cells: [
          { key: '["Other.tao"]', group: 'devices', label: 'phone', status: 'captured', screenshot: 'missing.png' },
          {
            key: '["App.tao"]',
            group: 'devices',
            label: 'dark',
            status: 'captured',
            screenshot: 'changed.png',
            sha256: 'a'.repeat(64),
          },
        ],
      })
    })
    const result = await runCaptured(capture, { output: '.artifacts/wrong-cells', timeoutSeconds: 30 })
    Expect(result.apps[0]!.cells.map(cell => [cell.label, cell.status])).toEqual([
      ['dark', 'failed'],
      ['phone', 'missing'],
    ])
    Expect(result.apps[0]!.unexpectedCells).toEqual([{ source: 'Other.tao', group: 'devices', label: 'phone' }])
    Expect(result.status).toBe('partial')
  })
})

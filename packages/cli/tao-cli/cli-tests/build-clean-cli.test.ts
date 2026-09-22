import { CLI, Errors, FS, Repo } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test } from '@shared/test'
import { type BuildRecord, executeBuildTargets } from '../cli-src/build-command'

const fixtureRoot = Repo.resolvePath('packages/testing/e2e-testing/fixtures/Clockwork')

Describe('Tao local build and clean CLI', () => {
  Test('runs selected targets together and retains both success and failure', async () => {
    const web = Deferred<string>()
    const desktop = Deferred<string>()
    const started: string[] = []
    const states: string[] = []
    const resultPromise = executeBuildTargets(['web', 'desktop'], target => {
      started.push(target)
      return target === 'web' ? web.promise : desktop.promise
    }, (target, state) => states.push(`${target}:${state}`))
    await settle()
    Expect(started).toEqual(['web', 'desktop'])
    web.resolve('/build/web')
    desktop.reject(new Errors.HostEnvironmentError('desktop packaging failed'))
    const results = await resultPromise
    Expect(results.web).toEqual({ artifact: '/build/web', status: 'succeeded' })
    Expect(results.desktop?.status).toBe('failed')
    Expect((results.desktop as { error: string }).error).toContain('desktop packaging failed')
    Expect(states).toEqual([
      'web:building',
      'desktop:building',
      'web:succeeded',
      'desktop:failed',
    ])
  })

  Test('retains fresh static web artifacts and refuses non-interactive cleanup', async () => {
    const root = await mkTestDir('tao-build-clean-')
    try {
      for (const name of ['Clockwork.tao', 'Clockwork.ts', 'Project.tao']) {
        await FS.copyFile(FS.resolvePath(name, fixtureRoot), FS.resolvePath(name, root))
      }

      const first = await runTao(['build', '--web', FS.resolvePath('Clockwork.tao', root)])
      Expect(first.exitCode).toBe(0)
      const buildsRoot = FS.resolvePath('.tao/builds', root)
      const firstId = (await FS.listDir(buildsRoot)).find(name => !name.startsWith('.'))
      Expect(firstId).toBeDefined()
      const firstRoot = FS.resolvePath(firstId!, buildsRoot)
      const firstRecord = await FS.readJson<BuildRecord>(FS.resolvePath('build.json', firstRoot))
      Expect(firstRecord.schemaVersion).toBe(1)
      Expect(firstRecord.appName).toBe('Clockwork')
      Expect(firstRecord.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
      Expect(firstRecord.targets).toEqual(['web'])
      Expect(firstRecord.results.web?.status).toBe('succeeded')
      Expect(await FS.isFile(FS.resolvePath('web/site/index.html', firstRoot))).toBe(true)
      Expect(await FS.readText(FS.resolvePath('web/site/index.html', firstRoot))).toContain('/_expo/static/js/web/')
      Expect(await FS.fileMode(FS.resolvePath('web/run', firstRoot)) & 0o111).toBeGreaterThan(0)
      Expect(await FS.readText(FS.resolvePath('.tao/.gitignore', root))).toContain('builds/')

      const second = await runTao(['build', '--web', FS.resolvePath('Clockwork.tao', root)])
      Expect(second.exitCode).toBe(0)
      const ids = (await FS.listDir(buildsRoot)).filter(name => !name.startsWith('.'))
      Expect(ids).toHaveLength(2)
      Expect(ids).toContain(firstId)
      const secondId = ids.find(id => id !== firstId)!
      const secondRecord = await FS.readJson<BuildRecord>(FS.resolvePath(`${secondId}/build.json`, buildsRoot))
      Expect(secondRecord.sourceDigest).toBe(firstRecord.sourceDigest)

      const clean = await runTao(['clean', root])
      Expect(clean.exitCode).toBe(1)
      Expect(clean.stderr).toContain('requires an interactive terminal')
      Expect((await FS.listDir(buildsRoot)).filter(name => !name.startsWith('.'))).toHaveLength(2)
    } finally {
      await FS.remove(root)
    }
  }, 60_000)
})

async function runTao(args: string[]): Promise<CLI.CommandResult> {
  return await CLI.run('./tao', {
    args,
    cwd: Repo.getRoot(),
    processPolicy: 'test',
    timeoutMs: 50_000,
    idleOutputMs: 45_000,
  })
}

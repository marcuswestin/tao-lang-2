import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import { type BuildRecord, executeBuildTargets } from '../cli-src/build-command'

const fixtureRoot = Repo.resolvePath('packages/testing/e2e-testing/fixtures/Clockwork')

Describe('Tao local build and clean CLI', () => {
  Test('resolves project packages while retaining output in an ignored artifact directory', async () => {
    const output = Repo.resolvePath(`.artifacts/build-output-test-${Platform.randomUUID()}`)
    try {
      const built = await runTao([
        'build',
        'Apps/Test Apps/Agent Commands',
        '--app',
        'AgentCommandsProof',
        '--web',
        '--visionos',
        '--compile-only',
        '--output',
        output,
      ])
      Expect(built.exitCode).toBe(0)
      const builds = await FS.listDir(output)
      Expect(builds).toHaveLength(1)
      const record = await FS.readJson<BuildRecord>(FS.resolvePath(`${builds[0]}/build.json`, output))
      Expect(record.results.web?.status).toBe('succeeded')
      Expect(record.results.visionos?.status).toBe('succeeded')
      Expect(await FS.isFile(FS.resolvePath(`${builds[0]}/compiled/visionos/_gen_tao-app/App.tsx`, output))).toBe(true)
      Expect(record.projectRoot).toBe(Repo.resolvePath('Apps/Test Apps/Agent Commands'))
    } finally {
      await FS.remove(output)
    }
  })

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
      await FS.writeText(FS.resolvePath('web/secret.txt', firstRoot), 'private')
      await FS.symlink(FS.resolvePath('web/secret.txt', firstRoot), FS.resolvePath('web/site/escape', firstRoot))
      await servesOnlyContainedFiles(firstRoot)

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

async function servesOnlyContainedFiles(buildRoot: string): Promise<void> {
  let output = ''
  const server = CLI.start('bun', {
    args: ['serve.ts'],
    cwd: FS.resolvePath('web', buildRoot),
    env: { PORT: '0' },
    onOutput: (_stream, chunk) => output += chunk.toString(),
    stdio: 'pipe',
  })
  try {
    const port = await until(() => {
      const value = Number(output.match(/Serving http:\/\/localhost:(\d+)/)?.[1])
      return value > 0 ? value : undefined
    }, { description: 'the standalone web server to announce its bound port' })
    await until(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/`)).status === 200 ? true : undefined
      } catch {
        return undefined
      }
    }, { description: `the standalone web server to start: ${output}` })
    Expect((await fetch(`http://127.0.0.1:${port}/%252e%252e/secret.txt`)).status).toBe(400)
    Expect((await fetch(`http://127.0.0.1:${port}/escape`)).status).toBe(400)
    Expect((await fetch(`http://127.0.0.1:${port}/missing`)).status).toBe(404)
  } finally {
    server.kill('SIGKILL')
    await server.waitForClose()
    await server.closeOutput()
  }
}

async function runTao(args: string[]): Promise<CLI.CommandResult> {
  return await CLI.run('./tao', {
    args,
    cwd: Repo.getRoot(),
    processPolicy: 'test',
    timeoutMs: 50_000,
    idleOutputMs: 45_000,
  })
}

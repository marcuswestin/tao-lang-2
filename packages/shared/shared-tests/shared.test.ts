import { Switch as CoreSwitch } from '@shared/core'
import {
  AfterEach,
  Describe,
  Expect,
  fakeTerminal,
  initGitTestRepository,
  mkGitTestDir,
  mkTestDir,
  runCleanups,
  settle,
  Test,
  withCapturedOutput,
} from '@shared/test'
import { PassThrough } from 'node:stream'
import {
  Assert,
  CLI,
  type Diagnostic,
  Diagnostics,
  Errors,
  FS,
  HCI,
  Platform,
  Repo,
  Switch,
  TaoHome,
  TaoResources,
  TaoStdlib,
  Text,
  Time,
} from '../shared-src/shared'

const cleanupPaths: string[] = []

AfterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await FS.remove(path)
  }
})

Describe('CLI', () => {
  Test('does not call a successful remote ref containing sandbox a policy denial', () => {
    Expect(CLI.isSandboxDenial({
      exitCode: 0,
      stderr: '',
      stdout: '2ba9b9f6\trefs/heads/merged/portable-sandbox-watching',
    })).toBe(false)
    Expect(CLI.isSandboxDenial({
      exitCode: 128,
      stderr: 'hostkeys_foreach: Operation not permitted',
      stdout: '',
    })).toBe(true)
  })
})

Describe('Time', () => {
  Test('pollUntil ignores only its three sentinels and returns other falsey values', async () => {
    const values: Array<false | null | number | undefined> = [false, undefined, null, 0]
    let now = 0
    const waits: number[] = []

    const result = await Time.pollUntil(() => values.shift(), {
      intervalMs: 10,
      now: () => now,
      sleep: async ms => {
        waits.push(ms)
        now += ms
      },
      // `now`/`sleep` are injected fakes, so this budget is denominated in fake ms with no real wall
      // time spent.
      timeoutMs: 100, // budget-ok: fake clock, no real wall time.
    })

    Expect(result).toBe(0)
    Expect(waits).toEqual([10, 10, 10])
  })

  Test('pollUntil stops before another read when its caller cancels', async () => {
    let reads = 0
    const result = await Time.pollUntil(() => {
      reads += 1
      return false
    }, {
      intervalMs: 10,
      stop: () => true,
      // budget-ok: `stop` fires on the first check, so no real wall time is spent waiting on this budget.
      timeoutMs: 100,
    })

    Expect(result).toBeUndefined()
    Expect(reads).toBe(0)
  })

  Test('pollUntil clamps its final sleep to the deadline and never reads at the deadline', async () => {
    let now = 0
    let reads = 0
    const waits: number[] = []
    const result = await Time.pollUntil(() => {
      reads += 1
      return undefined
    }, {
      intervalMs: 10,
      now: () => now,
      sleep: async ms => {
        waits.push(ms)
        now += ms
      },
      // `now`/`sleep` are injected fakes, so this budget is denominated in fake ms with no real wall
      // time spent.
      timeoutMs: 25, // budget-ok: fake clock, no real wall time.
    })

    Expect(result).toBeUndefined()
    Expect(reads).toBe(3)
    Expect(waits).toEqual([10, 10, 5])
  })
})

Describe('FS', () => {
  Test('temporary test directories default to worktree scratch and leave no normal-run residue', async () => {
    const source = FS.resolvePath('packages/shared/shared-src/testing/Test.ts', Repo.getRoot())
    const script = `import { mkTestDir } from ${JSON.stringify(source)};`
      + ` const directory = await mkTestDir('tao-test-exit-cleanup-');`
      + ` process.stdout.write(directory);`
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: ['-e', script],
      cwd: Repo.getRoot(),
    })

    Expect(result.exitCode).toBe(0)
    const directory = result.stdout.trim()
    Expect(FS.pathIsWithin(directory, Repo.resolvePath('.artifacts/scratch'))).toBe(true)
    Expect(await FS.exists(directory)).toBe(false)
  })

  Test('the Bun test runner removes fixtures across test files even when one fails', async () => {
    const suiteRoot = await mkTestDir('tao-test-runner-cleanup-')
    cleanupPaths.push(suiteRoot)
    const testModule = FS.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts', Repo.getRoot())
    const fixturePaths = ['first.test.ts', 'second.test.ts'].map(name => FS.resolvePath(name, suiteRoot))
    for (const fixturePath of fixturePaths) {
      await FS.writeText(
        fixturePath,
        `import { Expect, mkTestDir, Test } from ${JSON.stringify(testModule)};\n`
          + `Test('fixture', async () => { const directory = await mkTestDir('tao-test-worker-cleanup-'); `
          + `process.stdout.write('FIXTURE=' + directory + '\\n'); `
          + `${FS.basename(fixturePath) === 'second.test.ts' ? 'Expect(false).toBe(true);' : ''} });\n`,
      )
    }
    const result = await CLI.run('bun', { args: ['test', ...fixturePaths], cwd: Repo.getRoot() })
    const fixtures = [...result.stdout.matchAll(/FIXTURE=(\S+)/gu)].map(match => match[1]!)

    Expect(result.exitCode).toBe(1)
    Expect(fixtures).toHaveLength(2)
    cleanupPaths.push(...fixtures)
    for (const fixture of fixtures) {
      Expect(await FS.exists(fixture)).toBe(false)
    }
  })

  Test('a fixture can explicitly use host temp when it must be visible outside Git ignores', async () => {
    const directory = await mkTestDir('tao-host-test-fixture-', { location: 'host' })
    cleanupPaths.push(directory)

    Expect(FS.pathIsWithin(await FS.realPath(directory), await FS.realPath(FS.tmpdir()))).toBe(true)
    Expect(FS.pathIsWithin(directory, Repo.resolvePath('.artifacts/scratch'))).toBe(false)
  })

  Test('git cannot climb from a half-made fixture repository in worktree scratch into this checkout', async () => {
    const directory = await mkTestDir('tao-git-ceiling-')
    await FS.mkdir(FS.resolvePath('.git', directory))
    const result = await CLI.run('git', { args: ['rev-parse', '--show-toplevel'], cwd: directory, stdio: 'pipe' })

    Expect(result.exitCode).not.toBe(0)
    Expect(result.stdout.trim()).not.toBe(Repo.getRoot())
  })

  Test('a Git test repository lives in host temp and holds its own first commit', async () => {
    const root = await mkGitTestDir('tao-git-fixture-')
    await initGitTestRepository(root, { commit: { files: { 'README.md': 'fixture\n' }, message: 'Fixture' } })
    const git = async (...args: string[]) =>
      (await CLI.mustRun('git', { args: ['-C', root, ...args], stdio: 'pipe' })).stdout.trim()

    Expect(FS.pathIsWithin(root, await FS.realPath(FS.tmpdir()))).toBe(true)
    Expect(await git('rev-parse', '--show-toplevel')).toBe(root)
    Expect(await git('branch', '--show-current')).toBe('main')
    Expect(await git('log', '--format=%s')).toBe('Fixture')
  })

  Test("the Bun test runner keeps a failed test's Git fixture and removes a passing one's", async () => {
    const suiteRoot = await mkTestDir('tao-git-fixture-runner-')
    const testModule = FS.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts', Repo.getRoot())
    const fixturePath = FS.resolvePath('git-fixture.test.ts', suiteRoot)
    await FS.writeText(
      fixturePath,
      `import { Expect, mkGitTestDir, Test } from ${JSON.stringify(testModule)};\n`
        + `for (const passes of [true, false]) {\n`
        + `  Test(passes ? 'passes' : 'fails', async () => {\n`
        + `    const directory = await mkGitTestDir('tao-git-fixture-kept-');\n`
        + `    process.stdout.write((passes ? 'PASSED=' : 'FAILED=') + directory + '\\n');\n`
        + `    Expect(passes).toBe(true);\n`
        + `  });\n`
        + `}\n`,
    )
    const result = await CLI.run('bun', { args: ['test', fixturePath], cwd: Repo.getRoot(), stdio: 'pipe' })
    const passed = /PASSED=(\S+)/u.exec(result.stdout)?.[1]
    const failed = /FAILED=(\S+)/u.exec(result.stdout)?.[1]
    if (failed !== undefined) {
      cleanupPaths.push(failed)
    }

    Expect(result.exitCode).toBe(1)
    Expect(passed).toBeDefined()
    Expect(failed).toBeDefined()
    Expect(await FS.exists(passed!)).toBe(false)
    Expect(await FS.exists(failed!)).toBe(true)
    Expect(result.stderr).toContain(`Kept the failed test's Git fixture for debugging: ${failed}`)
  })

  Test('an absolute fixture prefix cannot silently move a test to host temp', async () => {
    await Expect(mkTestDir(FS.resolvePath('tao-host-test-fixture-', FS.tmpdir())))
      .rejects.toThrow('Test directory prefix must be one name')
  })

  Test('standalone tools fall back to host temp outside a Git checkout', async () => {
    const outside = await mkTestDir('tao-standalone-scratch-', { location: 'host' })
    cleanupPaths.push(outside)
    const source = FS.resolvePath('packages/shared/shared-src/Repo.ts', Repo.getRoot())
    const script = `import * as Repo from ${JSON.stringify(source)};`
      + ` const directory = await Repo.mkScratchDirOrHost('tao-standalone-tool-');`
      + ` process.stdout.write(directory);`
    const result = await CLI.run(Platform.runtimeProcess.execPath, { args: ['-e', script], cwd: outside })
    const directory = result.stdout.trim()

    Expect(result.exitCode).toBe(0)
    Expect(directory.length).toBeGreaterThan(0)
    cleanupPaths.push(directory)
    Expect(FS.pathIsWithin(await FS.realPath(directory), await FS.realPath(FS.tmpdir()))).toBe(true)
  })

  Test('discovers an explicitly requested scratch project without exposing it in repository scans', async () => {
    const directory = await mkTestDir('tao-scratch-discovery-')
    cleanupPaths.push(directory)
    const fixture = FS.resolvePath('Source.tao', directory)
    await FS.writeText(fixture, 'app Source { view Main }')

    Expect(await Repo.filesUnder(directory)).toContain(fixture)
    Expect(await Repo.filesUnder(Repo.getRoot())).not.toContain(fixture)
  })

  Test('resolves repo-relative paths from the Git root', async () => {
    const repoRoot = Repo.resolvePath()
    const sharedPath = FS.resolvePath(`${repoRoot}/packages/shared`)

    Expect(Repo.resolvePath('packages/shared')).toBe(sharedPath)
  })

  Test('displays paths from explicit locations without depending on checkout depth', () => {
    const cwd = FS.resolvePath('/workspace/checkouts/tao')
    const home = FS.resolvePath('/users/ro')
    const inside = FS.resolvePath('packages/App.tao', cwd)
    const outside = FS.resolvePath('../neighbor/App.tao', cwd)
    const inHome = FS.resolvePath('Library/Tao/App.tao', home)

    Expect(FS.displayPathFrom(cwd, cwd, home)).toBe('.')
    Expect(FS.displayPathFrom(inside, cwd, home)).toBe('packages/App.tao')
    // The former shortest-spelling policy would return `../neighbor/App.tao` here.
    Expect(FS.displayPathFrom(outside, cwd, home)).toBe(FS.slashPath(outside))
    Expect(FS.displayPathFrom(home, cwd, home)).toBe('~')
    Expect(FS.displayPathFrom(inHome, cwd, home)).toBe('~/Library/Tao/App.tao')
  })

  Test('creates parent directories and formats JSON files', async () => {
    const root = await tmpDir()
    const textPath = FS.resolvePath('nested/hello.txt', root)
    const jsonPath = FS.resolvePath('nested/data.json', root)

    await FS.writeText(textPath, 'hello')
    await FS.writeJson(jsonPath, { answer: 42 })

    Expect(await FS.readText(textPath)).toBe('hello')
    Expect(await FS.readJson<{ answer: number }>(jsonPath)).toEqual({ answer: 42 })
    Expect(await FS.readText(jsonPath)).toBe('{\n  "answer": 42\n}\n')
  })

  Test('copies, moves, lists, and removes paths', async () => {
    const root = await tmpDir()
    const sourcePath = FS.resolvePath('source.txt', root)
    const copyPath = FS.resolvePath('copies/copy.txt', root)
    const movedPath = FS.resolvePath('moved/copy.txt', root)

    await FS.writeText(sourcePath, 'copy me')
    await FS.copyFile(sourcePath, copyPath)
    await FS.move(copyPath, movedPath)

    Expect(await FS.readText(movedPath)).toBe('copy me')
    Expect(await FS.exists(copyPath)).toBe(false)
    await FS.writeText(FS.resolvePath('added.txt', FS.dirname(movedPath)), 'added later')
    Expect(await FS.listDir(FS.dirname(movedPath))).toEqual(['added.txt', 'copy.txt'])

    await FS.remove(FS.dirname(movedPath))
    Expect(await FS.exists(movedPath)).toBe(false)
  })

  Test('copies directories and walks files with filters', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('src', root)
    const copyDir = FS.resolvePath('copy', root)

    await FS.writeText(FS.resolvePath('a.ts', sourceDir), 'a')
    await FS.writeText(FS.resolvePath('b.txt', sourceDir), 'b')
    await FS.writeText(FS.resolvePath('.hidden.ts', sourceDir), 'hidden')
    await FS.writeText(FS.resolvePath('nested/c.ts', sourceDir), 'c')
    await FS.writeText(FS.resolvePath('ignored/d.ts', sourceDir), 'd')
    await FS.copyDirectory(sourceDir, copyDir)

    const walked: string[] = []
    for await (
      const path of FS.walk(copyDir, {
        extensions: ['.ts'],
        excludeDirectory: name => name === 'ignored',
      })
    ) {
      walked.push(path)
    }

    Expect(walked.sort()).toEqual([
      FS.resolvePath('a.ts', copyDir),
      FS.resolvePath('nested/c.ts', copyDir),
    ])
  })

  Test('synchronizes generated files without replacing their directory tree', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)

    await FS.writeText(FS.resolvePath('kept/value.txt', sourceDir), 'current')
    await FS.writeText(FS.resolvePath('.hidden', sourceDir), 'hidden')
    await FS.writeText(FS.resolvePath('kept/value.txt', targetDir), 'stale')
    await FS.writeText(FS.resolvePath('removed.txt', targetDir), 'remove me')
    await FS.writeText(FS.resolvePath('empty-after-sync/file.txt', targetDir), 'remove me too')

    await FS.synchronizeDirectoryFiles(sourceDir, targetDir)

    Expect(await FS.readText(FS.resolvePath('kept/value.txt', targetDir))).toBe('current')
    Expect(await FS.readText(FS.resolvePath('.hidden', targetDir))).toBe('hidden')
    Expect(await FS.exists(FS.resolvePath('removed.txt', targetDir))).toBe(false)
    Expect(await FS.exists(FS.resolvePath('empty-after-sync/file.txt', targetDir))).toBe(false)
    Expect(await FS.isDirectory(FS.resolvePath('empty-after-sync', targetDir))).toBe(true)
  })

  Test('restores every persistent root after an injected multi-root publication failure', async () => {
    const root = await tmpDir()
    const firstSource = FS.resolvePath('staging/first', root)
    const secondSource = FS.resolvePath('staging/second', root)
    const firstTarget = FS.resolvePath('persistent/first', root)
    const secondTarget = FS.resolvePath('persistent/second', root)
    await FS.writeText(FS.resolvePath('changed.txt', firstSource), 'new first bytes')
    await FS.writeText(FS.resolvePath('changed.txt', secondSource), 'new second bytes')
    await FS.writeText(FS.resolvePath('changed.txt', firstTarget), 'old first bytes')
    await FS.writeText(FS.resolvePath('changed.txt', secondTarget), 'old second bytes')
    await FS.writeText(FS.resolvePath('stale.txt', secondTarget), 'old stale bytes')
    const before = await directoryFileSetsIdentity([firstTarget, secondTarget])
    let injected = false

    await Expect(FS.synchronizeDirectoryFileSets([
      { fromPath: firstSource, toPath: firstTarget },
      { fromPath: secondSource, toPath: secondTarget },
    ], {
      beforeRemove: async path => {
        if (!injected && FS.basename(path) === 'stale.txt') {
          injected = true
          Errors.throwHostEnvironment('EPERM: injected persistent-output removal failure')
        }
      },
      boundaryPath: root,
      lockPath: firstTarget,
      sourceBoundaryPath: root,
    })).rejects.toThrow('EPERM')

    Expect(injected).toBe(true)
    Expect(await directoryFileSetsIdentity([firstTarget, secondTarget])).toBe(before)
  })

  Test('sweeps staging files a killed synchronization orphaned beside the destination', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    const uuid = '0f9b5a2c-1d3e-4f5a-8b7c-6d5e4f3a2b1c'
    // Staging and rollback files are named for the destination and sit beside it, so a killed run
    // leaves them where whatever packages the parent directory next will pick them up.
    const orphanedStaging = FS.resolvePath(`target.${uuid}.0.tmp`, root)
    const orphanedRollback = FS.resolvePath(`target.${uuid}.3.restore`, root)
    const unrelated = FS.resolvePath('target-notes.tmp', root)

    await FS.writeText(FS.resolvePath('value.txt', sourceDir), 'current')
    await FS.mkdir(targetDir)
    await FS.writeText(orphanedStaging, 'orphaned staging')
    await FS.writeText(orphanedRollback, 'orphaned rollback')
    await FS.writeText(unrelated, 'not ours')

    await FS.synchronizeDirectoryFiles(sourceDir, targetDir, { boundaryPath: root })

    Expect(await FS.exists(orphanedStaging)).toBe(false)
    Expect(await FS.exists(orphanedRollback)).toBe(false)
    // Only this synchronization's own naming is swept; a neighbour that merely ends in .tmp stays.
    Expect(await FS.readText(unrelated)).toBe('not ours')
    Expect(await FS.readText(FS.resolvePath('value.txt', targetDir))).toBe('current')
  })

  Test('refuses source and destination symbolic links while synchronizing files', async () => {
    const root = await tmpDir()
    const externalRoot = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    const externalPath = FS.resolvePath('outside.txt', externalRoot)
    await FS.writeText(externalPath, 'outside')
    await FS.mkdir(sourceDir)
    await FS.mkdir(targetDir)
    await FS.symlink(externalPath, FS.resolvePath('linked.txt', sourceDir))

    await Expect(FS.synchronizeDirectoryFiles(sourceDir, targetDir)).rejects.toThrow(
      'Refusing to synchronize a source symbolic link',
    )

    await FS.remove(FS.resolvePath('linked.txt', sourceDir))
    await FS.writeText(FS.resolvePath('linked.txt', sourceDir), 'replacement')
    await FS.symlink(externalPath, FS.resolvePath('linked.txt', targetDir))
    await Expect(FS.synchronizeDirectoryFiles(sourceDir, targetDir)).rejects.toThrow(
      'Refusing to synchronize a destination symbolic link',
    )
    Expect(await FS.readText(externalPath)).toBe('outside')
  })

  Test('rejects destination drift immediately before synchronization commits', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    const targetFile = FS.resolvePath('value.txt', targetDir)
    await FS.writeText(FS.resolvePath('value.txt', sourceDir), 'new generated bytes')
    await FS.writeText(targetFile, 'original bytes')

    await Expect(FS.synchronizeDirectoryFiles(sourceDir, targetDir, {
      beforeCommit: async () => await FS.writeText(targetFile, 'concurrent bytes'),
      boundaryPath: root,
    })).rejects.toThrow('Destination files changed while synchronizing')

    Expect(await FS.readText(targetFile)).toBe('concurrent bytes')
  })

  Test('refuses symbolic-link ancestors between the trusted boundary and either synchronized tree', async () => {
    const root = await tmpDir()
    const externalRoot = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('linked-target/generated', root)
    const externalPath = FS.resolvePath('outside.txt', externalRoot)
    await FS.writeText(FS.resolvePath('value.txt', sourceDir), 'source')
    await FS.writeText(externalPath, 'outside')
    await FS.symlink(externalRoot, FS.resolvePath('linked-target', root))

    await Expect(FS.synchronizeDirectoryFiles(sourceDir, targetDir, { boundaryPath: root })).rejects.toThrow(
      'Refusing to synchronize through a mutation target symbolic link',
    )
    Expect(await FS.readText(externalPath)).toBe('outside')

    await FS.remove(FS.resolvePath('linked-target', root))
    await FS.symlink(externalRoot, FS.resolvePath('linked-source', root))
    await FS.mkdir(FS.resolvePath('target', root))
    await Expect(FS.synchronizeDirectoryFiles(
      FS.resolvePath('linked-source', root),
      FS.resolvePath('target', root),
      { boundaryPath: root },
    )).rejects.toThrow('Refusing to synchronize through a source symbolic link')
    Expect(await FS.readText(externalPath)).toBe('outside')
  })

  Test('serializes directory synchronization by canonical destination across independent processes', async () => {
    const root = await tmpDir()
    const firstSource = FS.resolvePath('first', root)
    const secondSource = FS.resolvePath('second', root)
    const target = FS.resolvePath('target', root)
    const release = FS.resolvePath('release-first', root)
    await FS.writeText(FS.resolvePath('value.txt', firstSource), 'first')
    await FS.writeText(FS.resolvePath('value.txt', secondSource), 'second')
    await FS.writeText(FS.resolvePath('value.txt', target), 'original')
    const sharedModule = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const worker = (id: string, source: string, hold: boolean) => `
      import { Errors, FS, Platform, Time } from ${JSON.stringify(sharedModule)}
      const root = Platform.runtimeProcess.env['TAO_SYNC_ROOT']
      if (!root) Errors.throwUnexpected('Missing synchronization root.')
      let entered = false
      await FS.synchronizeDirectoryFiles(${JSON.stringify(source)}, ${JSON.stringify(target)}, {
        boundaryPath: root,
        beforeMove: async () => {
          if (!entered) {
            entered = true
            await FS.writeText(FS.resolvePath(${JSON.stringify(`entered-${id}`)}, root), '')
            ${hold ? `while (!await FS.exists(${JSON.stringify(release)})) await Time.sleep(5)` : ''}
          }
        },
      })
    `
    const run = (id: string, source: string, hold: boolean) =>
      CLI.run('bun', {
        args: ['-e', worker(id, source, hold)],
        env: { TAO_SYNC_ROOT: root },
        stdio: 'pipe',
      })
    const first = run('first', firstSource, true)
    let second: Promise<CLI.CommandResult> | undefined
    try {
      Expect(
        await Time.pollUntil(async () => await FS.exists(FS.resolvePath('entered-first', root)), {
          intervalMs: 5,
          timeoutMs: 30_000,
        }),
      ).toBe(true)
      second = run('second', secondSource, false)
      await Time.sleep(100)
      Expect(await FS.exists(FS.resolvePath('entered-second', root))).toBe(false)
      await FS.writeText(release, '')
      const results = await Promise.all([first, second])
      Expect(results.map(result => result.exitCode)).toEqual([0, 0])
      Expect(await FS.readText(FS.resolvePath('value.txt', target))).toBe('second')
    } finally {
      await FS.writeText(release, '').catch(() => {})
      await first.catch(() => undefined)
      await second?.catch(() => undefined)
    }
  })

  Test('reclaims a file-mutation lock whose owning process no longer exists', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    await FS.writeText(FS.resolvePath('value.txt', sourceDir), 'current')
    await FS.writeText(FS.resolvePath('value.txt', targetDir), 'stale')
    const lockPath = `${await FS.realPath(targetDir)}.tao-file-mutation.lock`
    const exited = await CLI.run(Platform.runtimeProcess.execPath, {
      args: ['--eval', 'console.log(process.pid)'],
      stdio: 'pipe',
    })
    Expect(exited.exitCode).toBe(0)
    const ownerPid = Number(exited.stdout.trim())
    Expect(ownerPid).toBeGreaterThan(0)
    Expect(Platform.processIsAlive(ownerPid)).toBe(false)
    await FS.writeJson(lockPath, { pid: ownerPid, token: 'dead-owner' })

    await FS.synchronizeDirectoryFiles(sourceDir, targetDir, { boundaryPath: root })

    Expect(await FS.readText(FS.resolvePath('value.txt', targetDir))).toBe('current')
    Expect(await FS.exists(lockPath)).toBe(false)
  })

  Test('publishes a complete lock owner atomically before exposing the shared claim', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    await FS.writeText(FS.resolvePath('value.txt', sourceDir), 'current')
    await FS.writeText(FS.resolvePath('value.txt', targetDir), 'stale')
    let inspectedOwner = false

    await FS.synchronizeDirectoryFiles(sourceDir, targetDir, {
      beforeClaimPublish: async (lockPath, ownerPath) => {
        Expect(await FS.exists(lockPath)).toBe(false)
        const owner = await FS.readJson<{ pid?: unknown; token?: unknown }>(ownerPath)
        Expect(typeof owner.pid).toBe('number')
        Expect(typeof owner.token).toBe('string')
        inspectedOwner = true
      },
      boundaryPath: root,
    })

    Expect(inspectedOwner).toBe(true)
  })

  Test('reclaims a live PID lock when its process-start identity proves PID reuse', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    await FS.writeText(FS.resolvePath('value.txt', sourceDir), 'current')
    await FS.writeText(FS.resolvePath('value.txt', targetDir), 'stale')
    const lockPath = `${await FS.realPath(targetDir)}.tao-file-mutation.lock`
    await FS.writeJson(lockPath, {
      pid: Platform.runtimeProcess.pid,
      processStartedAt: 'previous process start',
      token: 'reused-pid-owner',
    })

    await FS.synchronizeDirectoryFiles(sourceDir, targetDir, {
      boundaryPath: root,
      inspectProcessIdentity: async () => ({ evidence: 'alive', startedAt: 'current process start' }),
    })

    Expect(await FS.readText(FS.resolvePath('value.txt', targetDir))).toBe('current')
    Expect(await FS.exists(lockPath)).toBe(false)
  })

  Test('stale reclaim cannot delete a fresh lock that replaces the observed claim', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    await FS.writeText(FS.resolvePath('value.txt', sourceDir), 'current')
    await FS.writeText(FS.resolvePath('value.txt', targetDir), 'stale')
    const lockPath = `${await FS.realPath(targetDir)}.tao-file-mutation.lock`
    await FS.writeJson(lockPath, {
      pid: Platform.runtimeProcess.pid,
      processStartedAt: 'stale process start',
      token: 'stale-owner',
    })
    let replacementSurvived = false
    let replaced = false

    await FS.synchronizeDirectoryFiles(sourceDir, targetDir, {
      beforeStaleReclaim: async path => {
        if (replaced) {
          return
        }
        replaced = true
        await FS.remove(path)
        await FS.writeJson(path, {
          pid: Platform.runtimeProcess.pid,
          processStartedAt: 'current process start',
          token: 'fresh-owner',
        })
        setTimeout(async () => {
          await Time.sleep(30)
          replacementSurvived = (await FS.readJson<{ token?: string }>(path).catch(() => ({ token: undefined })))
            .token === 'fresh-owner'
          await FS.remove(path)
        }, 0)
      },
      boundaryPath: root,
      inspectProcessIdentity: async () => ({ evidence: 'alive', startedAt: 'current process start' }),
    })

    Expect(replacementSurvived).toBe(true)
    Expect(await FS.readText(FS.resolvePath('value.txt', targetDir))).toBe('current')
  })

  Test('preserves the work failure when lock release also fails', async () => {
    const root = await tmpDir()
    const target = FS.resolvePath('target', root)
    await FS.mkdir(target)
    let thrown: unknown
    try {
      await FS.withFileMutationLock(target, root, async () => {
        Errors.throwUnexpected('primary work failure')
      }, {
        beforeRelease: async () => Errors.throwUnexpected('release cleanup failure'),
      })
    } catch (error) {
      thrown = error
    }

    Expect(Errors.messageOf(thrown)).toBe('primary work failure')
    Expect(Errors.formatForLog(thrown)).toContain('release cleanup failure')
    Expect(await FS.exists(`${await FS.realPath(target)}.tao-file-mutation.lock`)).toBe(false)
  })

  Test('rejects a destination-parent swap before a file move can escape the boundary', async () => {
    const root = await tmpDir()
    const external = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    await FS.writeText(FS.resolvePath('value.txt', sourceDir), 'current')
    await FS.writeText(FS.resolvePath('value.txt', targetDir), 'stale')
    await FS.writeText(FS.resolvePath('sentinel.txt', external), 'outside')
    let swapped = false

    await Expect(FS.synchronizeDirectoryFiles(sourceDir, targetDir, {
      beforeMove: async () => {
        if (swapped) {
          return
        }
        swapped = true
        await FS.remove(targetDir)
        await FS.symlink(external, targetDir)
      },
      boundaryPath: root,
    })).rejects.toThrow('move destination symbolic link')

    Expect(await FS.readText(FS.resolvePath('sentinel.txt', external))).toBe('outside')
    Expect(await FS.exists(FS.resolvePath('value.txt', external))).toBe(false)
  })

  Test('rollback preserves a non-cooperating write and reports primary plus rollback diagnostics', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    const keptPath = FS.resolvePath('kept.txt', targetDir)
    await FS.writeText(FS.resolvePath('kept.txt', sourceDir), 'generated kept')
    await FS.writeText(keptPath, 'original kept')
    await FS.writeText(FS.resolvePath('stale.txt', targetDir), 'original stale')
    let thrown: unknown
    try {
      await FS.synchronizeDirectoryFiles(sourceDir, targetDir, {
        beforeRemove: async path => {
          if (FS.basename(path) !== 'stale.txt') {
            return
          }
          await FS.writeText(keptPath, 'external concurrent write')
          Errors.throwUnexpected('primary stale removal failure')
        },
        boundaryPath: root,
      })
    } catch (error) {
      thrown = error
    }

    Expect(Errors.messageOf(thrown)).toBe('primary stale removal failure')
    Expect(Errors.formatForLog(thrown)).toContain('Rollback preserved a concurrent write')
    Expect(await FS.readText(keptPath)).toBe('external concurrent write')
  })

  Test('restores every destination file when directory synchronization fails during commit', async () => {
    const root = await tmpDir()
    const sourceDir = FS.resolvePath('source', root)
    const targetDir = FS.resolvePath('target', root)
    await FS.writeText(FS.resolvePath('kept.txt', sourceDir), 'new kept')
    await FS.writeText(FS.resolvePath('added.txt', sourceDir), 'new added')
    await FS.writeText(FS.resolvePath('kept.txt', targetDir), 'old kept')
    await FS.writeText(FS.resolvePath('stale.txt', targetDir), 'old stale')
    let rejectedStaleRemoval = false

    await Expect(FS.synchronizeDirectoryFiles(sourceDir, targetDir, {
      beforeRemove: async path => {
        if (!rejectedStaleRemoval && FS.basename(path) === 'stale.txt') {
          rejectedStaleRemoval = true
          Errors.throwUnexpected('injected stale-file removal failure')
        }
      },
    })).rejects.toThrow('injected stale-file removal failure')

    Expect(rejectedStaleRemoval).toBe(true)
    Expect(await FS.readText(FS.resolvePath('kept.txt', targetDir))).toBe('old kept')
    Expect(await FS.readText(FS.resolvePath('stale.txt', targetDir))).toBe('old stale')
    Expect(await FS.exists(FS.resolvePath('added.txt', targetDir))).toBe(false)
    Expect(await FS.exists(`${await FS.realPath(targetDir)}.tao-file-mutation.lock`)).toBe(false)
  })

  Test('walk follows symlinked directories only when requested', async () => {
    const root = await tmpDir()
    const externalDir = await tmpDir()
    const linkPath = FS.resolvePath('linked', root)

    await FS.writeText(FS.resolvePath('local.ts', root), 'local')
    await FS.writeText(FS.resolvePath('external.ts', externalDir), 'external')
    await FS.symlink(externalDir, linkPath)

    const defaultWalked = await walkRelative(root)
    const symlinkWalked = await walkRelative(root, { followSymlinks: true })

    Expect(defaultWalked).toEqual(['local.ts'])
    Expect(symlinkWalked).toEqual(['linked/external.ts', 'local.ts'])
  })

  Test('walk prevents cycles while following symlinked directories', async () => {
    const root = await tmpDir()
    const childDir = FS.resolvePath('child', root)

    await FS.writeText(FS.resolvePath('child/file.ts', root), 'child')
    await FS.symlink(root, FS.resolvePath('loop', childDir))

    const walked = await walkRelative(root, { followSymlinks: true })

    Expect(walked).toEqual(['child/file.ts'])
  })
})

async function walkRelative(root: string, options: FS.WalkOptions = {}): Promise<string[]> {
  const walked: string[] = []
  for await (const path of FS.walk(root, { extensions: ['.ts'], ...options })) {
    walked.push(FS.relativePath(root, path))
  }
  return walked.sort()
}

Describe('HCI', () => {
  Test('writes messages to selected output streams', () => {
    const stdout = fakeTerminal('')
    const stderr = fakeTerminal('')

    HCI.write('out', { output: stdout.output })
    HCI.writeLine(' line', { output: stdout.output })
    HCI.writeError('err', { output: stderr.output })
    HCI.writeErrorLine(' line', { output: stderr.output })
    HCI.writeStderr(' raw', { output: stderr.output })
    HCI.writeSuccess(' success', { output: stdout.output })

    Expect(stripAnsi(stdout.outputText())).toBe('out line\n success')
    Expect(stripAnsi(stderr.outputText())).toBe('err line\n raw')
    Expect(stdout.outputText()).toContain('\u001b[32m')
    Expect(stderr.outputText()).toContain('\u001b[31m')
  })

  Test('colors process log message bodies by severity', async () => {
    const logged = await withCapturedOutput(() => {
      HCI.logProcessInfo('dev', 'info body')
      HCI.logProcessWarn('dev', 'warn body')
      HCI.logProcessError('dev', 'error body')
    })

    Expect(stripAnsi(logged.stdout)).toBe('[dev]: info body\n')
    Expect(stripAnsi(logged.stderr)).toBe('[dev]: warn body\n[dev]: error body\n')
    Expect(logged.stdout).toContain('\u001b[2minfo body\u001b[0m')
    Expect(logged.stderr).toContain('\u001b[33mwarn body\u001b[0m')
    Expect(logged.stderr).toContain('\u001b[31merror body\u001b[0m')
  })

  Test('asks for text with validation', async () => {
    const streams = fakeTerminal(' \nthe Developer\n')

    const value = await HCI.askText({
      message: 'Name',
      validate: value => value.trim() === '' ? 'Required' : undefined,
      ...streams,
    })

    Expect(value).toBe('the Developer')
    Expect(streams.outputText()).toContain('Required')
  })

  Test('asks for confirmations and choices', async () => {
    const confirm = await HCI.askConfirm({ message: 'Continue', ...fakeTerminal('\n'), defaultValue: true })
    const choice = await HCI.askChoice({
      message: 'Pick',
      choices: [
        { value: 'one', label: 'One' },
        { value: 'two', label: 'Two' },
      ],
      ...fakeTerminal('2\n'),
    })

    Expect(confirm).toBe(true)
    Expect(choice).toBe('two')
  })

  Test('renders the confirmation hint from the shared suffix in the asked question', async () => {
    const streams = fakeTerminal('\n')

    await HCI.askConfirm({ message: 'Kill it?', ...streams, defaultValue: false })

    Expect(HCI.confirmChoiceSuffix(false)).toBe(' [y/N]')
    Expect(HCI.confirmChoiceSuffix(true)).toBe(' [Y/n]')
    Expect(HCI.confirmChoiceSuffix(undefined)).toBe(' [y/n]')
    Expect(stripAnsi(streams.outputText())).toContain(`Kill it?${HCI.confirmChoiceSuffix(false)}`)
  })

  Test('cancelling a confirmation closes its terminal reader without accepting later input', async () => {
    const streams = fakeTerminal()
    const abort = new AbortController()
    const answer = HCI.askConfirm({ message: 'Trust?', ...streams, defaultValue: false, signal: abort.signal })
    Expect(streams.outputText()).toContain('Trust?')
    abort.abort()
    await Expect(answer).rejects.toThrow()
    Expect(streams.input.listenerCount('keypress')).toBe(0)
    Expect(streams.rawMode()).toBe(false)
  })

  Test('reads raw keys one at a time from any terminal stream, without waiting for Enter', async () => {
    const terminal = fakeTerminal()
    terminal.input.write('1a')
    let rawModeWhileReading = false

    const keys = await HCI.withRawKeys(async readKey => {
      rawModeWhileReading = terminal.rawMode()
      return [await readKey(), await readKey()]
    }, terminal)

    Expect(keys).toEqual(['1', 'a'])
    Expect(rawModeWhileReading).toBe(true)
    Expect(terminal.rawMode()).toBe(false)
    // A still-flowing input keeps the process alive, so a finished session must release the stream.
    Expect(terminal.input.isPaused()).toBe(true)
  })

  Test('reads an escape sequence as one Escape and a closed input as an interrupt', async () => {
    const terminal = fakeTerminal()

    const keys = await HCI.withRawKeys(async readKey => {
      terminal.input.write(`${HCI.RawKey.escape}[A`)
      const arrowKey = await readKey()
      terminal.input.end()
      return [arrowKey, await readKey()]
    }, terminal)

    Expect(keys).toEqual([HCI.RawKey.escape, HCI.RawKey.interrupt])
  })

  Test('reports every key of a chunk to a raw-key listener until the session is stopped', async () => {
    const terminal = fakeTerminal()
    const keys: string[] = []
    const session = HCI.startRawKeys(key => keys.push(key), terminal)

    terminal.input.write('qr')
    await settle()
    session.stop()
    terminal.input.write('x')
    await settle()

    Expect(session.rawMode).toBe(true)
    Expect(keys).toEqual(['q', 'r'])
    Expect(terminal.rawMode()).toBe(false)
    Expect(terminal.input.isPaused()).toBe(true)
  })

  Test('reports no raw mode for input that is not an interactive terminal', async () => {
    const plainInput = new PassThrough()

    const session = HCI.startRawKeys(() => undefined, { input: plainInput })
    session.stop()

    Expect(session.rawMode).toBe(false)
  })

  Test('uses defaults or rejects in non-interactive mode', async () => {
    await Expect(HCI.askText({ message: 'Name', interactive: false, defaultValue: 'the Developer' })).resolves.toBe(
      'the Developer',
    )
    await Expect(HCI.askConfirm({ message: 'Continue', interactive: false, defaultValue: false })).resolves.toBe(false)
    await Expect(
      HCI.askChoice({
        message: 'Pick',
        choices: [{ value: 'one' }],
        interactive: false,
        defaultValue: 'one',
      }),
    ).resolves.toBe('one')
    await Expect(HCI.askText({ message: 'Name', interactive: false })).rejects.toBeInstanceOf(Errors.UserInputError)
  })
})

Describe('Diagnostics', () => {
  Test('filters and checks diagnostics by source, severity, and message', () => {
    const diagnostics: Diagnostic[] = [
      { message: 'bad token', severity: 'error', source: 'lexer' },
      { message: 'missing view', severity: 'error', source: 'linker' },
      { message: 'duplicate name', severity: 'warning', source: 'validator' },
    ]

    Expect(Diagnostics.messages(diagnostics, 'linker')).toEqual(['missing view'])
    Expect(Diagnostics.messages(diagnostics, 'lexer', 'parser')).toEqual(['bad token'])
    Expect(Diagnostics.hasError(diagnostics, 'lexer', 'parser')).toBe(true)
    Expect(Diagnostics.hasSource(diagnostics, 'compiler')).toBe(false)
    Expect(Diagnostics.allFromSource(diagnostics, 'lexer', 'linker', 'validator')).toBe(true)
    Expect(Diagnostics.allWithSeverity(diagnostics, 'error', 'lexer', 'linker')).toBe(true)
    Expect(Diagnostics.hasMessageContaining(diagnostics, 'missing', 'linker')).toBe(true)
    Expect(Diagnostics.allMessagesContain(diagnostics, 'view', 'linker')).toBe(true)
  })

  Test('keeps diagnostics from different files distinct', () => {
    const diagnostics: Diagnostic[] = [
      { filePath: '/project/A.tao', message: 'Expected }', severity: 'error', source: 'parser' },
      { filePath: '/project/B.tao', message: 'Expected }', severity: 'error', source: 'parser' },
      { filePath: '/project/B.tao', message: 'Expected }', severity: 'error', source: 'parser' },
      {
        filePath: '/project/B.tao',
        message: 'Expected }',
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 2 },
        },
        severity: 'error',
        source: 'parser',
      },
      {
        filePath: '/project/B.tao',
        message: 'Expected }',
        nodeType: 'View',
        severity: 'error',
        source: 'parser',
      },
    ]

    Expect(Diagnostics.unique(diagnostics)).toHaveLength(4)
  })
})

Describe('CLI', () => {
  Test('returns unchecked failures and throws checked failures', async () => {
    const commandSpec = {
      args: ['-c', 'printf bad >&2; exit 7'],
    }

    const result = await CLI.run('/bin/sh', commandSpec)

    Expect(result.exitCode).toBe(7)
    await Expect(CLI.mustRun('/bin/sh', commandSpec)).rejects.toBeInstanceOf(Errors.CommandExecutionError)
    Expect(() => CLI.mustRunSync('/bin/sh', commandSpec)).toThrow(Errors.CommandExecutionError)
  })

  Test('captures output from a synchronous command', () => {
    Expect(CLI.mustRunSync('/bin/sh', { args: ['-c', 'printf out'] }).stdout).toBe('out')
  })

  Test('streams output while preserving captured output', async () => {
    const streamed = await withCapturedOutput(() =>
      CLI.run('/bin/sh', {
        args: ['-c', 'printf out; printf err >&2'],
        stdio: 'stream',
      })
    )

    Expect(streamed.result.stdout).toBe('out')
    Expect(streamed.result.stderr).toBe('err')
    Expect(streamed.stdout).toBe('out')
    Expect(streamed.stderr).toBe('err')
  })

  Test('streams prefixed output while preserving captured output', async () => {
    const streamed = await withCapturedOutput(() =>
      CLI.run('/bin/sh', {
        args: ['-c', 'printf "out\\ntail"; printf "bad\\n" >&2'],
        prefixedOutput: { processName: 'test' },
      })
    )

    Expect(streamed.result.stdout).toBe('out\ntail')
    Expect(streamed.result.stderr).toBe('bad\n')
    Expect(stripAnsi(streamed.stdout)).toBe('[test]: out\n[test]: tail\n')
    Expect(stripAnsi(streamed.stderr)).toBe('[test]: bad\n')
  })

  Test('captures prefixed process output without writing it to the terminal', async () => {
    const streamed = await withCapturedOutput(() =>
      CLI.run('/bin/sh', {
        args: ['-c', 'printf "out\\n"; printf "bad\\n" >&2'],
        prefixedOutput: { processName: 'test', terminal: false },
      })
    )

    Expect(streamed.result.stdout).toBe('out\n')
    Expect(streamed.result.stderr).toBe('bad\n')
    Expect(streamed.stdout).toBe('')
    Expect(streamed.stderr).toBe('')
  })

  Test('streams stdout and stderr chunks to an onOutput callback', async () => {
    const output = { stderr: '', stdout: '' }
    const command = CLI.start('/bin/sh', {
      args: ['-c', 'printf out; printf err >&2'],
      onOutput: (stream, chunk) => output[stream] += chunk.toString('utf8'),
      stdio: 'pipe',
    })
    const close = await command.waitForClose()

    Expect(close.exitCode).toBe(0)
    Expect(command.exitCode).toBe(0)
    Expect(output).toEqual({ stderr: 'err', stdout: 'out' })
  })
})

Describe('Repo', () => {
  Test('finds the current git worktree root from a nested cwd', async () => {
    const root = Repo.getRoot()

    Expect(Repo.getRoot(FS.resolvePath('packages/shared', root))).toBe(root)
  })

  Test('rejects outside a git worktree', async () => {
    const outsideRepo = await tmpDir()

    Expect(() => Repo.getRoot(outsideRepo)).toThrow(Errors.CommandExecutionError)
  })

  Test('reports no root outside a git worktree instead of throwing', async () => {
    const outsideRepo = await tmpDir()

    Expect(Repo.tryGetRoot(outsideRepo)).toBeUndefined()
    Expect(Repo.tryResolvePath('.devenv/profile/bin/node', outsideRepo)).toBeUndefined()
  })

  Test('resolves repository-relative paths inside a git worktree', async () => {
    const root = Repo.getRoot()

    Expect(Repo.tryGetRoot(root)).toBe(root)
    Expect(Repo.tryResolvePath('packages/shared', root)).toBe(FS.resolvePath('packages/shared', root))
  })

  Test('walks files outside a git worktree without applying loose gitignore files', async () => {
    const root = await untrackedTmpDir()
    try {
      await FS.writeText(FS.resolvePath('.gitignore', root), '_gen_*\nignored/\n')
      await FS.writeText(FS.resolvePath('a.ts', root), 'a')
      await FS.writeText(FS.resolvePath('nested/b.ts', root), 'b')
      await FS.writeText(FS.resolvePath('_gen_tao-app/c.ts', root), 'c')
      await FS.writeText(FS.resolvePath('ignored/d.ts', root), 'd')
      await FS.writeText(FS.resolvePath('node_modules/package/e.ts', root), 'e')
      await FS.writeText(FS.resolvePath('android/f.ts', root), 'f')

      const files = (await Repo.filesUnder(root, { extensions: ['.ts'] }))
        .map(path => FS.relativePath(root, path))

      Expect(files).toEqual([
        '_gen_tao-app/c.ts',
        'a.ts',
        'android/f.ts',
        'ignored/d.ts',
        'nested/b.ts',
        'node_modules/package/e.ts',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('applies caller-provided directory exclusions while walking outside a git worktree', async () => {
    const root = await untrackedTmpDir()
    try {
      await FS.writeText(FS.resolvePath('a.ts', root), 'a')
      await FS.writeText(FS.resolvePath('node_modules/package/b.ts', root), 'b')

      const files = (await Repo.filesUnder(root, {
        excludeDirectoryNames: ['node_modules'],
        extensions: ['.ts'],
      })).map(path => FS.relativePath(root, path))

      Expect(files).toEqual(['a.ts'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('omits files below hidden directory segments', async () => {
    const root = await untrackedTmpDir()
    try {
      await FS.writeText(FS.resolvePath('MVP-4/valid.tao', root), '')
      await FS.writeText(FS.resolvePath('Apps/WordFlower/.tao-archive/ignored.tao', root), '')

      const files = (await Repo.filesUnder(root, {
        extensions: ['.tao'],
      })).map(path => FS.relativePath(root, path))

      Expect(files).toEqual(['MVP-4/valid.tao'])
    } finally {
      await FS.remove(root)
    }
  })

  // A listing answers from one discovery what `filesUnder` and `directoriesUnder` answer from one
  // discovery each, so every option has to filter to the same set either way.
  Test('answers every file and directory question from one listing as the per-question calls do', async () => {
    const root = await untrackedTmpDir()
    try {
      await FS.writeText(FS.resolvePath('Root.tao', root), '')
      await FS.writeText(FS.resolvePath('@data/Data.tao', root), '')
      await FS.writeText(FS.resolvePath('@data/nested/Notes.ts', root), '')
      await FS.writeText(FS.resolvePath('@empty/README.md', root), '')
      await FS.writeText(FS.resolvePath('.hidden/@secret/Hidden.tao', root), '')
      await FS.writeText(FS.resolvePath('node_modules/@scoped/Dep.tao', root), '')
      const listing = await Repo.listUnder(root)
      const questions = [
        {},
        { extensions: ['.tao'] },
        { excludeDirectoryNames: ['node_modules'], extensions: ['.tao'] },
        { excludeDirectoryNames: ['node_modules', 'nested'] },
      ] as const

      for (const options of questions) {
        Expect(listing.files(options)).toEqual(await Repo.filesUnder(root, options))
      }
      for (const options of [{}, { namePrefix: '@' }] as const) {
        Expect(listing.directories(options)).toEqual(await Repo.directoriesUnder(root, options))
      }
      Expect(listing.directories({ namePrefix: '@' }).map(path => FS.relativePath(root, path))).toEqual([
        '@data',
        '@empty',
        'node_modules/@scoped',
      ])
      Expect(
        listing.files({ excludeDirectoryNames: ['node_modules'], extensions: ['.tao'] }).map(path =>
          FS.relativePath(root, path)
        ),
      )
        .toEqual(['@data/Data.tao', 'Root.tao'])
    } finally {
      await FS.remove(root)
    }
  })
})

Describe('Errors, Assert, and Switch', () => {
  Test('formats Tao errors for users and logs', () => {
    const userError = new Errors.UserInputError('No file selected')
    const unexpected = Errors.fromUnknown('surprise', { while: 'testing' })

    Expect(Errors.isTaoError(userError)).toBe(true)
    Expect(Errors.formatForUser(userError)).toBe('No file selected')
    Expect(Errors.formatForLog(unexpected)).toContain('UnexpectedBehaviorError')
    Expect(Errors.formatForLog(unexpected)).toContain('surprise')
  })

  Test('quotes the command words a reader could not paste back', () => {
    const commandError = new Errors.CommandExecutionError({
      command: 'tao',
      args: ['run', 'Hello World.tao'],
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: '',
    })

    Expect(commandError.messageForUser).toBe('Command failed: tao run "Hello World.tao"')
  })

  Test('describes message-less platform values without flattening them', () => {
    Expect(Errors.messageOf({ code: 1006, type: 'close' })).toBe('Object (code: 1006, type: close)')
  })

  Test('normalizes unknown failures and builds Web-compatible cancellations', () => {
    const original = new Errors.UserInputError('Fix the value.')
    const normalized = Errors.asError('unexpected value')
    const cancellation = Errors.abortError('Stopped by the caller.')

    Expect(Errors.asError(original)).toBe(original)
    Expect(normalized).toBeInstanceOf(Errors.UnexpectedBehaviorError)
    Expect(normalized.message).toBe('unexpected value')
    Expect(cancellation.name).toBe('AbortError')
    Expect(cancellation.message).toBe('Stopped by the caller.')
  })

  Test('sorts a host or environment failure into its own category', () => {
    const hostError = Errors.fromUnknown(
      new Errors.HostEnvironmentError('The Tao Studio browser bundle is missing.', { cause: 'no bundle' }),
    )

    Expect(Errors.isTaoError(hostError)).toBe(true)
    Expect(Errors.formatForUser(hostError)).toBe('The Tao Studio browser bundle is missing.')
    Expect(Errors.formatForLog(hostError)).toContain('HostEnvironmentError')
    Expect(() => Errors.throwHostEnvironment('knip produced no JSON report to read.'))
      .toThrow(Errors.HostEnvironmentError)
  })

  Test('asserts conditions and narrows values', () => {
    const value: string | undefined = 'tao'

    Assert(value, 'value exists')
    Assert.defined(value, 'value defined')
    Assert.is(value, isString, 'value is a string')
    Expect(value.toUpperCase()).toBe('TAO')
    Expect(() => Assert(false, 'truthy')).toThrow(Errors.UnexpectedBehaviorError)
  })

  Test('blames the author for a failed input assertion and keeps their sentence', () => {
    const iterations: number | undefined = 4
    const rejectEmptySamples = (): void => {
      Assert.input(0, 'Performance samples must not be empty.')
    }

    Assert.input(iterations, 'Performance iterations must be a positive integer.')
    Expect(iterations.toFixed(0)).toBe('4')
    Expect(rejectEmptySamples).toThrow(Errors.UserInputError)
    Expect(rejectEmptySamples).toThrow('Performance samples must not be empty.')
  })

  Test('switches exhaustively by value, type, kind, and property', () => {
    type Item =
      | { $type: 'text'; value: string; state: 'ready' }
      | { $type: 'count'; value: number; state: 'empty' }

    type Status =
      | { kind: 'ready'; value: string }
      | { kind: 'empty'; value: number }

    const item: Item = { $type: 'text', value: 'hello', state: 'ready' }
    const status: Status = { kind: 'ready', value: 'hello' }

    const selectedValue = Switch<'a' | 'b', number>('a', {
      a: () => 1,
      b: () => 2,
    })
    const selectedCallableValue = Switch<'a' | 'b', number>('b', {
      a: () => 1,
      b: () => 2,
    })
    const selectedOptionalValue = Switch<'raw' | undefined, string>(undefined, {
      raw: () => 'raw',
      undefined: () => 'normal',
    })
    const selectedType = Switch.type<Item, string>(item, {
      text: text => text.value,
      count: count => count.value.toString(),
    })
    const selectedOptionalType = Switch.typeMaybe<Item | undefined, string>(undefined, {
      text: (text): string => text.value,
      count: count => count.value.toString(),
      undefined: () => 'missing',
    })
    const selectedKind = Switch.kind<Status, string>(status, {
      ready: ready => ready.value,
      empty: empty => empty.value.toString(),
    })
    const selectedOptionalKind = Switch.kindMaybe<Status | undefined, string>(undefined, {
      ready: ready => ready.value,
      empty: empty => empty.value.toString(),
      undefined: () => 'missing',
    })
    const selectedProperty = Switch.property<Item, 'state', string>(item, 'state', {
      ready: () => 'Ready',
      empty: () => 'Empty',
    })

    Expect(selectedValue).toBe(1)
    Expect(selectedCallableValue).toBe(2)
    Expect(selectedOptionalValue).toBe('normal')
    Expect(selectedType).toBe('hello')
    Expect(selectedOptionalType).toBe('missing')
    Expect(selectedKind).toBe('hello')
    Expect(selectedOptionalKind).toBe('missing')
    Expect(selectedProperty).toBe('Ready')
  })

  Test('exports Switch through the environment-safe core entrypoint', () => {
    Expect(CoreSwitch).toBe(Switch)
  })
})

Describe('Text', () => {
  Test('strips shared indentation from multiline strings', () => {
    Expect(Text.stripIndent(`
      first
        second
      third
    `)).toBe('first\n  second\nthird')
  })

  Test('preserves relative indentation and blank interior lines', () => {
    Expect(Text.stripIndent(`
        first

          second
    `)).toBe('first\n\n  second')
  })

  Test('indents selected lines', () => {
    Expect(Text.indentLines('first\n\nsecond', 2)).toBe('  first\n  \n  second')
    Expect(Text.indentLines('first\n\nsecond', 2, { skipBlankLines: true, skipFirstLine: true })).toBe(
      'first\n\n  second',
    )
  })

  Test('escapes regexp metacharacters', () => {
    const literal = 'a+b?.[x]'
    Expect(new RegExp(Text.escapeRegExp(literal)).test(literal)).toBe(true)
  })

  Test('stripJsonc drops comments and trailing commas but leaves string contents alone', () => {
    const source = '{\n  // note\n  "s": "x, } /* not a comment */",\n  "list": [1, 2, /* two */],\n}\n'
    Expect(JSON.parse(Text.stripJsonc(source))).toEqual({ list: [1, 2], s: 'x, } /* not a comment */' })
  })

  Test('stripJsonc preserves an unterminated block comment as invalid input', () => {
    Expect(() => JSON.parse(Text.stripJsonc('{ "ready": true } /* unfinished'))).toThrow()
  })
})

/**
 * The declared stdlib is the one compile input that need not live inside the repository, so every
 * memoizing scheme in the toolchain reaches it through this identity. What it must do is notice a
 * change to a tree nothing else hashes; what it must not do is answer the same for two different
 * stdlibs.
 */
/**
 * A journey's disposers must all run, and a cleanup failure must never become the failure the test
 * reports when the journey itself already failed. Both smoke journeys had their own copy of this
 * before it moved here.
 */
Describe('Test cleanup', () => {
  Test('runs every disposer and reports beside a primary failure rather than replacing it', async () => {
    const primaryFailure = new Errors.UnexpectedBehaviorError('primary journey failure')
    const cleaned: string[] = []
    const reported: unknown[] = []

    await runCleanups(primaryFailure, [
      {
        label: 'close browser',
        run: () => {
          cleaned.push('browser')
          Errors.throwHostEnvironment('browser cleanup failed')
        },
      },
      {
        label: 'remove runtime',
        run: () => {
          cleaned.push('runtime')
          Errors.throwHostEnvironment('runtime cleanup failed')
        },
      },
      { label: 'remove export', run: () => cleaned.push('export') },
    ], { channel: 'test-cleanup', reportCleanupFailure: error => reported.push(error), subject: 'journey' })

    // A disposer that throws must not stop the ones after it.
    Expect(cleaned).toEqual(['browser', 'runtime', 'export'])
    Expect(reported).toHaveLength(1)
    Expect(Errors.messageOf(reported[0])).toContain('2 journey cleanup operations failed')
    Expect(Errors.messageOf(reported[0])).toContain('close browser: browser cleanup failed')
    Expect(Errors.messageOf(reported[0])).toContain('remove runtime: runtime cleanup failed')
    Expect(primaryFailure.message).toBe('primary journey failure')
  })

  Test('throws a cleanup failure when there is no primary failure to preserve', async () => {
    const reported: unknown[] = []

    await Expect(runCleanups(undefined, [
      { label: 'standalone cleanup', run: () => Errors.throwHostEnvironment('standalone cleanup failed') },
    ], { channel: 'test-cleanup', reportCleanupFailure: error => reported.push(error), subject: 'journey' }))
      .rejects.toThrow('standalone cleanup failed')
    Expect(reported).toEqual([])
  })

  Test('stays silent when every disposer succeeds', async () => {
    const reported: unknown[] = []

    await runCleanups(undefined, [{ label: 'quiet cleanup', run: () => undefined }], {
      channel: 'test-cleanup',
      reportCleanupFailure: error => reported.push(error),
      subject: 'journey',
    })

    Expect(reported).toEqual([])
  })
})

Describe('TaoStdlib', () => {
  Test('identifies the built-in stdlib without naming a tree', async () => {
    await withDeclaredStdlibRoot(undefined, async () => {
      Expect(TaoStdlib.declaredRoot()).toBeUndefined()
      Expect(await TaoStdlib.declaredRootIdentity()).toBe(await TaoStdlib.declaredRootIdentity())
    })
  })

  Test('changes when a file inside the declared tree changes', async () => {
    const payload = await tmpDir()
    await FS.writeText(FS.resolvePath('@tao/ui/Views.tao', payload), 'public view Text(Value text) { }\n')
    await withDeclaredStdlibRoot(payload, async () => {
      const before = await TaoStdlib.declaredRootIdentity()
      await FS.writeText(FS.resolvePath('@tao/ui/Views.tao', payload), 'public view Text(Value text) { }\n// edit\n')

      Expect(await TaoStdlib.declaredRootIdentity()).not.toBe(before)
    })
  })

  Test('ignores hidden TypeScript generation but fingerprints handwritten Tao TypeScript companions', async () => {
    const payload = await tmpDir()
    const authored = FS.resolvePath('@tao/ui/Views.tao.ts', payload)
    await FS.writeText(authored, 'export const authored = 1\n')
    await withDeclaredStdlibRoot(payload, async () => {
      const before = await TaoStdlib.declaredRootIdentity()
      await FS.writeText(FS.resolvePath('.tao-ts/@tao/ui/Views.tao.ts', payload), 'generated contract\n')
      await FS.writeJson(FS.resolvePath('.tao/typescript/tsconfig.json', payload), { compilerOptions: {} })
      Expect(await TaoStdlib.declaredRootIdentity()).toBe(before)

      await FS.writeText(authored, 'export const authored = 2\n')
      Expect(await TaoStdlib.declaredRootIdentity()).not.toBe(before)
    })
  })

  // A scheme that only asked whether the declared root sits inside an already-hashed tree answers
  // the same for both of these. They are different stdlibs, so the identity must differ.
  Test('changes when the variable names a different tree with the same content', async () => {
    const payload = await tmpDir()
    const twin = await tmpDir()
    for (const root of [payload, twin]) {
      await FS.writeText(FS.resolvePath('@tao/ui/Views.tao', root), 'public view Text(Value text) { }\n')
    }

    const one = await withDeclaredStdlibRoot(payload, () => TaoStdlib.declaredRootIdentity())
    const other = await withDeclaredStdlibRoot(twin, () => TaoStdlib.declaredRootIdentity())

    Expect(other).not.toBe(one)
  })

  // Declaring a tree that is not there is not the same as declaring nothing: the first is a broken
  // configuration whose repair must invalidate the key, the second is the built-in stdlib.
  Test('separates an absent declared tree from an unset variable', async () => {
    const missing = FS.resolvePath('not-created', await tmpDir())
    const declared = await withDeclaredStdlibRoot(missing, () => TaoStdlib.declaredRootIdentity())
    const unset = await withDeclaredStdlibRoot(undefined, () => TaoStdlib.declaredRootIdentity())

    Expect(declared).not.toBe(unset)
  })

  // A relative value cannot be honoured, because the two halves of this variable's job disagree on
  // what to resolve it against: this module resolves it against the root the caller's other
  // components are relative to, and `Stdlib.rootPath` hands the raw value to whatever reads it,
  // which resolves against the process's current directory. It identified one tree and compiled
  // against another, silently — no setter in this repository has ever passed one.
  Test('refuses a relative declared root rather than resolving it two different ways', async () => {
    const base = await tmpDir()
    await FS.writeText(FS.resolvePath('payload/@tao/ui/Views.tao', base), 'public view Text(Value text) { }\n')
    await withDeclaredStdlibRoot('payload', async () => {
      await Expect(TaoStdlib.declaredRootIdentity(base)).rejects.toThrow('must be an absolute path')
      Expect(() => TaoStdlib.declaredRoot()).toThrow('must be an absolute path')
    })
  })
})

Describe('TaoHome', () => {
  // The install script spells the same rule in shell; these pin the paths it must agree with.
  Test('defaults to ~/.tao', () => {
    withEnvironment({
      HOME: '/Users/someone',
      TAO_HOME: undefined,
      XDG_DATA_HOME: undefined,
      XDG_CACHE_HOME: undefined,
    }, () => {
      Expect(TaoHome.root()).toBe('/Users/someone/.tao')
      Expect(TaoHome.resolve('hosts')).toBe('/Users/someone/.tao/hosts')
      Expect(TaoHome.cacheRoot()).toBe('/Users/someone/.tao/cache')
      Expect(TaoHome.cacheResolve('test-runs')).toBe('/Users/someone/.tao/cache/test-runs')
    })
  })

  Test('keeps the single home when XDG_DATA_HOME is set', () => {
    withEnvironment({ HOME: '/Users/someone', TAO_HOME: undefined, XDG_DATA_HOME: '/data' }, () => {
      Expect(TaoHome.root()).toBe('/Users/someone/.tao')
    })
    withEnvironment({ HOME: '/Users/someone', TAO_HOME: undefined, XDG_DATA_HOME: 'data' }, () => {
      Expect(TaoHome.root()).toBe('/Users/someone/.tao')
    })
  })

  Test('takes TAO_HOME over everything, and refuses a relative one', () => {
    withEnvironment(
      { HOME: '/Users/someone', TAO_HOME: '/opt/tao', XDG_DATA_HOME: '/data', XDG_CACHE_HOME: '/cache' },
      () => {
        Expect(TaoHome.root()).toBe('/opt/tao')
        Expect(TaoHome.cacheRoot()).toBe('/opt/tao/cache')
      },
    )
    withEnvironment({ HOME: '/Users/someone', TAO_HOME: 'tao', XDG_DATA_HOME: undefined }, () => {
      Expect(() => TaoHome.root()).toThrow('TAO_HOME must be an absolute path')
      Expect(() => TaoHome.cacheRoot()).toThrow('TAO_HOME must be an absolute path')
    })
  })

  Test('keeps the single home when XDG_CACHE_HOME is set', () => {
    withEnvironment({ HOME: '/Users/someone', TAO_HOME: undefined, XDG_CACHE_HOME: '/cache' }, () => {
      Expect(TaoHome.cacheRoot()).toBe('/Users/someone/.tao/cache')
    })
    withEnvironment({ HOME: '/Users/someone', TAO_HOME: undefined, XDG_CACHE_HOME: 'cache' }, () => {
      Expect(TaoHome.cacheRoot()).toBe('/Users/someone/.tao/cache')
    })
  })
})

Describe('TaoResources', () => {
  Test('names no root inside a checkout, so every reader keeps its own layout', async () => {
    await withDeclaredResourceRoot(undefined, () => {
      Expect(TaoResources.declaredRoot()).toBeUndefined()
      Expect(TaoResources.resolve('stdlib')).toBeUndefined()
    })
  })

  Test('resolves a path inside the declared root', async () => {
    const root = await tmpDir()
    await withDeclaredResourceRoot(root, () => {
      Expect(TaoResources.declaredRoot()).toBe(root)
      Expect(TaoResources.resolve('host/package.json')).toBe(FS.resolvePath('host/package.json', root))
    })
  })

  // Same reason the stdlib variable refuses one: a relative root is read against the process's
  // current directory and hashed against something else, so it names two trees.
  Test('refuses a relative declared root', async () => {
    await withDeclaredResourceRoot('resources', () => {
      Expect(() => TaoResources.declaredRoot()).toThrow('must be an absolute path')
    })
  })

  // The stdlib variable still wins, so a test or a packaged Studio can redirect an installed binary.
  Test('yields to the stdlib variable when both name a root', async () => {
    const resources = await tmpDir()
    const stdlib = await tmpDir()
    await withDeclaredResourceRoot(resources, async () => {
      await withDeclaredStdlibRoot(stdlib, () => {
        Expect(TaoStdlib.declaredRoot()).toBe(stdlib)
      })
    })
  })

  Test('supplies the stdlib root when the stdlib variable is unset', async () => {
    const resources = await tmpDir()
    await withDeclaredResourceRoot(resources, async () => {
      await withDeclaredStdlibRoot(undefined, () => {
        Expect(TaoStdlib.declaredRoot()).toBe(FS.resolvePath(TaoResources.STDLIB_DIRECTORY, resources))
      })
    })
  })

  // The regression this pairing exists to prevent. A resource root may move the stdlib without the
  // stdlib variable being set at all, and an identity that stayed `<absent>` across that move would
  // let a compile built against one stdlib be reused against another.
  Test('reaches the identity, so a moved resource root cannot reuse a foreign compile', async () => {
    const resources = await tmpDir()
    const stdlibRoot = FS.resolvePath(TaoResources.STDLIB_DIRECTORY, resources)
    await FS.writeText(FS.resolvePath('@tao/ui/Views.tao', stdlibRoot), 'public view Text(Value text) { }\n')

    const unset = await withDeclaredResourceRoot(undefined, () => TaoStdlib.declaredRootIdentity())
    const declared = await withDeclaredResourceRoot(resources, () => TaoStdlib.declaredRootIdentity())
    Expect(declared).not.toBe(unset)

    await FS.writeText(FS.resolvePath('@tao/ui/Views.tao', stdlibRoot), 'public view Text(Value text) { }\n// edit\n')
    const edited = await withDeclaredResourceRoot(resources, () => TaoStdlib.declaredRootIdentity())

    Expect(edited).not.toBe(declared)
  })
})

/**
 * withEnvironment sets or unsets variables for one synchronous check and restores them. It is
 * synchronous on purpose: with no await between the set and the restore, two uses cannot overlap.
 */
function withEnvironment(values: Record<string, string | undefined>, run: () => void): void {
  const env = Platform.runtimeProcess.env
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, env[name]]))
  const assign = (entries: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(entries)) {
      if (value === undefined) {
        delete env[name]
      } else {
        env[name] = value
      }
    }
  }
  assign(values)
  try {
    run()
  } finally {
    assign(previous)
  }
}

async function withDeclaredResourceRoot<T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> {
  const previous = Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV]
  if (value === undefined) {
    delete Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV]
  } else {
    Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV] = value
  }
  try {
    return await run()
  } finally {
    if (previous === undefined) {
      delete Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV]
    } else {
      Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV] = previous
    }
  }
}

async function withDeclaredStdlibRoot<T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> {
  const previous = Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV]
  if (value === undefined) {
    delete Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV]
  } else {
    Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV] = value
  }
  try {
    return await run()
  } finally {
    if (previous === undefined) {
      delete Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV]
    } else {
      Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV] = previous
    }
  }
}

async function tmpDir() {
  // Several Repo tests here deliberately exercise paths outside any Git worktree.
  const dir = await mkTestDir('tao-shared-test-', { location: 'host' })
  cleanupPaths.push(dir)
  return dir
}

async function directoryFileSetsIdentity(roots: readonly string[]): Promise<string> {
  const entries: Array<readonly [string, string]> = []
  for (const [index, root] of roots.entries()) {
    if (!await FS.isDirectory(root)) {
      continue
    }
    for await (const path of FS.walk(root, { includeHidden: true })) {
      entries.push([`${index}/${FS.relativePath(root, path)}`, path])
    }
  }
  return await FS.filesIdentity(entries)
}

async function untrackedTmpDir() {
  return await mkTestDir('tao-shared-test-', { location: 'host' })
}

const stripAnsi = Text.stripAnsi

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

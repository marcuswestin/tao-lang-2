import { CLI, FS, Platform, Repo, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'

const REPAIR_SCRIPT = Repo.resolvePath('packages/dev/dev-src/cli/repair-dependencies.zsh')

type RepairFixture = {
  attemptLog: string
  backupParent: string
  cacheRoot: string
  commandLog: string
  env: Platform.ProcessEnv
  repository: string
  tempRoot: string
  testRoot: string
}

Describe('dependency tree repair', () => {
  Test('moves a protected-name tree whole, performs a frozen install, and retains the backup', async () => {
    const fixture = await createFixture('success')
    try {
      const protectedFile = FS.resolvePath('node_modules/protected/.env', fixture.repository)
      await FS.writeText(protectedFile, 'do not inspect me')

      const first = await runRepair(fixture)

      Expect(first.exitCode).toBe(0)
      Expect(await FS.readText(FS.resolvePath('node_modules/repaired/package.json', fixture.repository)))
        .toBe('{}\n')
      const backup = successfulBackup(first.stdout)
      Expect(await FS.readText(FS.resolvePath('protected/.env', backup))).toBe('do not inspect me')
      const physicalRepository = await FS.realPath(fixture.repository)
      Expect(await FS.readText(fixture.commandLog)).toBe([
        'install',
        '--cwd',
        physicalRepository,
        '--frozen-lockfile',
        `--cache-dir=${physicalRepository}/.artifacts/cache`,
        `TMPDIR=${physicalRepository}/.artifacts/tmp/`,
        '',
      ].join('\n'))
      Expect(await FS.exists(FS.resolvePath('.artifacts/locks/dependency-repair.lock', fixture.repository)))
        .toBe(true)
      Expect(await FS.exists(FS.resolvePath('forbidden-command.log', fixture.testRoot))).toBe(false)

      const second = await runRepair(fixture)
      Expect(second.exitCode).toBe(0)
      Expect(second.stdout).toContain('Dependencies are healthy; no repair was needed.')
      Expect((await FS.readText(fixture.attemptLog)).trim().split('\n')).toEqual(['attempt'])
    } finally {
      await FS.remove(fixture.testRoot)
    }
  })

  Test('moves a partial install aside and restores the original tree after failure', async () => {
    const fixture = await createFixture('fail')
    try {
      await FS.writeText(FS.resolvePath('node_modules/original/.env', fixture.repository), 'original')

      const result = await runRepair(fixture)

      Expect(result.exitCode).toBe(23)
      Expect(result.stderr).toContain('Restored the original dependency tree')
      Expect(await FS.readText(FS.resolvePath('node_modules/original/.env', fixture.repository)))
        .toBe('original')
      const artifacts = failedArtifacts(result.stderr)
      Expect(await FS.readText(FS.resolvePath('partial-node_modules/partial/package.json', artifacts)))
        .toBe('{}\n')
      Expect(await FS.exists(FS.resolvePath('original-node_modules', artifacts))).toBe(false)
    } finally {
      await FS.remove(fixture.testRoot)
    }
  })

  Test('leaves the original tree untouched when the atomic backup move fails', async () => {
    const fixture = await createFixture('move-fail')
    try {
      await FS.writeText(FS.resolvePath('node_modules/original/.env', fixture.repository), 'original')

      const result = await runRepair(fixture)

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Unable to move the damaged dependency tree')
      Expect(result.stderr).toContain('original dependency tree was not moved and remains unchanged')
      Expect(result.stderr).not.toContain('Partial dependency tree retained')
      Expect(await FS.readText(FS.resolvePath('node_modules/original/.env', fixture.repository)))
        .toBe('original')
    } finally {
      await FS.remove(fixture.testRoot)
    }
  })

  Test('restores the original tree when the install interrupts its parent', async () => {
    const fixture = await createFixture('interrupt')
    try {
      await FS.writeText(FS.resolvePath('node_modules/original/package.json', fixture.repository), '{}')

      const result = await runRepair(fixture)

      Expect(result.stderr).toContain('Dependency repair was interrupted')
      Expect(result.exitCode).toBe(143)
      Expect(await FS.readText(FS.resolvePath('node_modules/original/package.json', fixture.repository)))
        .toBe('{}')
      const artifacts = failedArtifacts(result.stderr)
      Expect(await FS.readText(FS.resolvePath('partial-node_modules/partial/package.json', artifacts)))
        .toBe('{}\n')
    } finally {
      await FS.remove(fixture.testRoot)
    }
  })

  Test('installs safely when node_modules did not exist and leaves it absent on failure', async () => {
    const successful = await createFixture('success')
    try {
      const result = await runRepair(successful)
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('Repair artifact retained at:')
      Expect(await FS.exists(FS.resolvePath('node_modules/repaired/package.json', successful.repository)))
        .toBe(true)
    } finally {
      await FS.remove(successful.testRoot)
    }

    const failed = await createFixture('fail')
    try {
      const result = await runRepair(failed)
      Expect(result.exitCode).toBe(23)
      Expect(result.stderr).toContain('No original dependency tree existed; node_modules remains absent.')
      Expect(await FS.exists(FS.resolvePath('node_modules', failed.repository))).toBe(false)
    } finally {
      await FS.remove(failed.testRoot)
    }
  })

  Test('serializes repairs and lets the waiter observe the first repair as healthy', async () => {
    const fixture = await createFixture('wait')
    try {
      await FS.writeText(FS.resolvePath('node_modules/original/package.json', fixture.repository), '{}')
      const first = runRepair(fixture)
      await until(async () => await FS.exists(FS.resolvePath('install.ready', fixture.testRoot)))

      const secondStarted = FS.resolvePath('second.started', fixture.testRoot)
      const second = runRepair(fixture, secondStarted)
      await until(async () => await FS.exists(secondStarted))
      await Time.sleep(50)
      Expect((await FS.readText(fixture.attemptLog)).trim().split('\n')).toEqual(['attempt'])

      await FS.writeText(FS.resolvePath('install.release', fixture.testRoot), '')
      const [firstResult, secondResult] = await Promise.all([first, second])

      Expect(firstResult.exitCode).toBe(0)
      Expect(secondResult.exitCode).toBe(0)
      Expect(secondResult.stdout).toContain('Dependencies are healthy; no repair was needed.')
      Expect((await FS.readText(fixture.attemptLog)).trim().split('\n')).toEqual(['attempt'])
    } finally {
      await FS.remove(fixture.testRoot)
    }
  })

  Test('the deps recipe reaches automatic replacement after every in-place Bun attempt fails', async () => {
    const testRoot = await mkTestDir('tao-dependency-recipe-')
    const fakeBin = FS.resolvePath('bin', testRoot)
    const attemptLog = FS.resolvePath('attempts.log', testRoot)
    const repairLog = FS.resolvePath('repairs.log', testRoot)
    const healthy = FS.resolvePath('healthy', testRoot)
    try {
      await FS.writeText(
        FS.resolvePath('bun', fakeBin),
        '#!/bin/zsh\nprint -r -- "$*" >> "$TAO_TEST_ATTEMPT_LOG"\nexit 23\n',
      )
      await FS.writeText(
        FS.resolvePath('just', fakeBin),
        [
          '#!/bin/zsh',
          'case "$1" in',
          '  _dependency-health) [[ -f "$TAO_TEST_HEALTHY" ]] ;;',
          '  repair-deps) print -r -- repair >> "$TAO_TEST_REPAIR_LOG"; : > "$TAO_TEST_HEALTHY" ;;',
          '  *) exit 97 ;;',
          'esac',
          '',
        ].join('\n'),
      )
      for (const command of ['bun', 'just']) {
        const outcome = await CLI.run('chmod', { args: ['+x', FS.resolvePath(command, fakeBin)] })
        Expect(outcome.exitCode).toBe(0)
      }

      const result = await CLI.run(await FS.realPath(Repo.resolvePath('.devenv/profile/bin/just')), {
        args: ['deps'],
        cwd: Repo.getRoot(),
        env: {
          PATH: `${fakeBin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
          TAO_TEST_ATTEMPT_LOG: attemptLog,
          TAO_TEST_HEALTHY: healthy,
          TAO_TEST_REPAIR_LOG: repairLog,
        },
      })

      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(attemptLog)).trim().split('\n')).toEqual([
        'install --frozen-lockfile',
        'install --frozen-lockfile --force',
        `install --frozen-lockfile --force --cache-dir=${Repo.resolvePath('.artifacts/cache/bun')}`,
      ])
      Expect(await FS.readText(repairLog)).toBe('repair\n')
    } finally {
      await FS.remove(testRoot)
    }
  })
})

async function createFixture(mode: 'fail' | 'interrupt' | 'move-fail' | 'success' | 'wait'): Promise<RepairFixture> {
  const testRoot = await mkTestDir('tao-dependency-repair-')
  const repository = FS.resolvePath('repository', testRoot)
  const fakeBin = FS.resolvePath('bin', testRoot)
  const tempRoot = FS.resolvePath('.artifacts/tmp', repository)
  const cacheRoot = FS.resolvePath('.artifacts/cache', repository)
  const backupParent = FS.resolvePath('backups', testRoot)
  const attemptLog = FS.resolvePath('attempts.log', testRoot)
  const commandLog = FS.resolvePath('commands.log', testRoot)
  await Promise.all([
    FS.writeText(FS.resolvePath('bun.lock', repository), ''),
    FS.writeText(FS.resolvePath('Justfile', repository), '_dependency-health:\n    true\n'),
    FS.mkdir(backupParent),
  ])
  await FS.writeText(
    FS.resolvePath('just', fakeBin),
    [
      '#!/bin/zsh',
      '[[ -f "$TAO_TEST_REPOSITORY/.healthy" ]]',
      '',
    ].join('\n'),
  )
  await FS.writeText(
    FS.resolvePath('bun', fakeBin),
    [
      '#!/bin/zsh',
      'print -r -- attempt >> "$TAO_TEST_ATTEMPT_LOG"',
      'print -rl -- "$@" > "$TAO_TEST_COMMAND_LOG"',
      'print -r -- "TMPDIR=$TMPDIR" >> "$TAO_TEST_COMMAND_LOG"',
      'mkdir -p "$TAO_TEST_REPOSITORY/node_modules/partial"',
      'print -r -- "{}" > "$TAO_TEST_REPOSITORY/node_modules/partial/package.json"',
      'case "$TAO_TEST_MODE" in',
      '  fail) exit 23 ;;',
      '  interrupt)',
      '    kill -TERM "$PPID"',
      '    sleep 0.05',
      '    exit 0',
      '    ;;',
      '  success)',
      '    mv "$TAO_TEST_REPOSITORY/node_modules/partial" "$TAO_TEST_REPOSITORY/node_modules/repaired"',
      '    : > "$TAO_TEST_REPOSITORY/.healthy"',
      '    ;;',
      '  wait)',
      '    : > "$TAO_TEST_ROOT/install.ready"',
      '    while [[ ! -f "$TAO_TEST_ROOT/install.release" ]]; do sleep 0.01; done',
      '    mv "$TAO_TEST_REPOSITORY/node_modules/partial" "$TAO_TEST_REPOSITORY/node_modules/repaired"',
      '    : > "$TAO_TEST_REPOSITORY/.healthy"',
      '    ;;',
      'esac',
      '',
    ].join('\n'),
  )
  for (const command of ['cat', 'find', 'ls', 'rm']) {
    await FS.writeText(
      FS.resolvePath(command, fakeBin),
      [
        '#!/bin/zsh',
        'print -r -- "$0 $*" >> "$TAO_TEST_ROOT/forbidden-command.log"',
        'exit 97',
        '',
      ].join('\n'),
    )
  }
  for (const command of ['bun', 'cat', 'find', 'just', 'ls', 'rm']) {
    const outcome = await CLI.run('chmod', { args: ['+x', FS.resolvePath(command, fakeBin)] })
    Expect(outcome.exitCode).toBe(0)
  }
  if (mode === 'move-fail') {
    await FS.writeText(FS.resolvePath('mv', fakeBin), '#!/bin/zsh\nexit 31\n')
    const outcome = await CLI.run('chmod', { args: ['+x', FS.resolvePath('mv', fakeBin)] })
    Expect(outcome.exitCode).toBe(0)
  }
  return {
    attemptLog,
    backupParent,
    cacheRoot,
    commandLog,
    env: {
      PATH: `${fakeBin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
      TAO_DEPENDENCY_REPAIR_BACKUP_PARENT: backupParent,
      TAO_TEST_ATTEMPT_LOG: attemptLog,
      TAO_TEST_COMMAND_LOG: commandLog,
      TAO_TEST_MODE: mode,
      TAO_TEST_REPOSITORY: repository,
      TAO_TEST_ROOT: testRoot,
    },
    repository,
    tempRoot,
    testRoot,
  }
}

async function runRepair(fixture: RepairFixture, started?: string): Promise<CLI.CommandResult> {
  if (started !== undefined) {
    return await CLI.run('zsh', {
      args: [
        '-c',
        ': > "$1"; shift; exec zsh "$@"',
        'dependency-repair-test',
        started,
        REPAIR_SCRIPT,
        fixture.repository,
        fixture.tempRoot,
        fixture.cacheRoot,
      ],
      env: fixture.env,
    })
  }
  return await CLI.run('zsh', {
    args: [REPAIR_SCRIPT, fixture.repository, fixture.tempRoot, fixture.cacheRoot],
    env: fixture.env,
  })
}

function successfulBackup(stdout: string): string {
  const prefix = 'Dependency repair succeeded. Original dependency tree retained at: '
  const line = stdout.split('\n').find(candidate => candidate.startsWith(prefix))
  Expect(line).toBeDefined()
  return line!.slice(prefix.length)
}

function failedArtifacts(stderr: string): string {
  const prefixes = [
    'Dependency repair failed; artifacts retained at: ',
    'Dependency repair was interrupted; artifacts retained at: ',
  ]
  const line = stderr.split('\n').find(candidate => prefixes.some(prefix => candidate.startsWith(prefix)))
  Expect(line).toBeDefined()
  const prefix = prefixes.find(candidate => line!.startsWith(candidate))
  Expect(prefix).toBeDefined()
  return line!.slice(prefix!.length)
}

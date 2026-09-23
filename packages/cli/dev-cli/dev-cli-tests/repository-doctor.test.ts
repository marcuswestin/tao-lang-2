import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import {
  type DoctorFacts,
  type DoctorReport,
  doctorReport,
  formatCheck,
  readDoctorFacts,
  repositoryDoctorChecks,
} from '@verification/RepositoryDoctor'
import { RepositoryDoctorCommand } from '../dev-cli-src/doctor/RepositoryDoctorCommand'

function facts(overrides: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    artifactRoots: [{ path: '.artifacts/tmp', present: true, sizeBytes: 2_500_000, writable: true }],
    branch: 'feat/example',
    bunTempDir: { path: '/w/.artifacts/tmp', writable: true },
    bunVersion: '1.4.2',
    dependencyIssues: [],
    devenvProfileNode: '/w/.devenv/profile/bin/node',
    direnvAllowed: true,
    fingerprint: {
      architecture: 'arm64',
      kernel: { name: 'Darwin', version: '27.0.0' },
      os: { build: '26A428', name: 'macOS', version: '27.0' },
      tao: { commit: '3e1ae411dff6', describe: '3e1ae411', modified: false },
      toolchain: [{ name: 'bun', present: true, version: '1.4.2' }],
      version: 1,
    },
    generatedParserArtifacts: [{ path: 'packages/language/parser/parser-src/_gen_tao-parser/ast.ts', present: true }],
    githubTransport: {
      configuredOriginUrl: 'https://github.com/marcuswestin/tao-lang-2.git',
      credentialHelpers: ['!/nix/store/gh/bin/gh auth git-credential'],
      effectiveOriginUrl: 'https://github.com/marcuswestin/tao-lang-2.git',
      landingBrokerReady: true,
    },
    gitHooks: ['commit-msg', 'pre-commit'].map(event => ({
      event,
      ours: true,
      present: true,
      resolvesHere: true,
      scriptPaths: ['packages/cli/agent-cli/agent-cli-src/cli/agent-git-hooks.zsh'],
    })),
    linkedWorktree: true,
    lockfilePresent: true,
    machine: { cpuCount: 8, lanes: [], loadAverage: 1.2 },
    nodeModulesPresent: true,
    nodeVersion: 'v24.14.1',
    ports: [{ listeners: [], port: 8081, purpose: 'Expo Metro' }],
    processGivenPath: '/w',
    processRealPath: '/w',
    repositoryRoot: '/w',
    satisfies: Platform.semverSatisfies,
    watchmanHealthy: true,
    watchmanVersion: '2026.01.19.00',
    ...overrides,
  }
}

function check(report: ReturnType<typeof doctorReport>, name: string) {
  return report.checks.find(candidate => candidate.name === name)
}

Describe('repository doctor', () => {
  Test('passes a healthy checkout and reports it as ready', () => {
    const report = doctorReport(facts())

    Expect(report.status).toBe('pass')
    Expect(report.version).toBe(1)
    Expect(RepositoryDoctorCommand.exitCodeFor(report.status)).toBe(0)
  })

  Test('rejects Bun too old for the pinned standalone build workflow', () => {
    const report = doctorReport(facts({ bunVersion: '1.3.13' }))

    Expect(check(report, 'bun')?.status).toBe('fail')
    Expect(check(report, 'bun')?.detail).toContain('>=1.4.2')
  })

  Test('fails a checkout that cannot run Tao commands at all', () => {
    const report = doctorReport(facts({ devenvProfileNode: undefined, nodeVersion: undefined }))

    Expect(report.status).toBe('fail')
    Expect(check(report, 'devenv profile')?.remediation).toContain('direnv exec . ./agent setup')
    Expect(RepositoryDoctorCommand.exitCodeFor(report.status)).toBe(1)
  })

  Test('warns rather than fails on a detached HEAD, naming the fix', () => {
    const report = doctorReport(facts({ branch: undefined }))

    Expect(check(report, 'worktree')?.status).toBe('warn')
    Expect(check(report, 'worktree')?.remediation).toContain('git switch -c feat/<name>')
    Expect(report.status).toBe('warn')
    Expect(RepositoryDoctorCommand.exitCodeFor(report.status)).toBe(0)
  })

  Test('treats optional tooling as a warning, never a failure', () => {
    const report = doctorReport(facts({
      direnvAllowed: undefined,
      watchmanHealthy: undefined,
      watchmanVersion: undefined,
    }))

    Expect(check(report, 'watchman')?.status).toBe('warn')
    Expect(check(report, 'watchman')?.detail).toContain('EMFILE')
    Expect(check(report, 'direnv')?.status).toBe('warn')
    Expect(report.status).toBe('warn')
  })

  Test('fails an incomplete dependency graph with a repair command', () => {
    const report = doctorReport(facts({ dependencyHealthError: "Cannot find module 'expo/metro-config'" }))

    Expect(check(report, 'dependencies')?.status).toBe('fail')
    Expect(check(report, 'dependencies')?.remediation).toContain('./agent setup')
  })

  Test('surfaces the runtime dependency compatibility gate', () => {
    const report = doctorReport(facts({ dependencyIssues: ['tao-studio resolves react 19.2.8'] }))

    Expect(check(report, 'dependency compatibility')?.status).toBe('fail')
    Expect(check(report, 'dependency compatibility')?.detail).toContain('react 19.2.8')
  })

  Test('requires an explicit HTTPS origin and GitHub credential helper', () => {
    const ssh = doctorReport(facts({
      githubTransport: {
        configuredOriginUrl: 'git@github.com:marcuswestin/tao-lang-2.git',
        credentialHelpers: [],
        effectiveOriginUrl: 'git@github.com:marcuswestin/tao-lang-2.git',
      },
    }))
    const rewritten = doctorReport(facts({
      githubTransport: {
        configuredOriginUrl: 'git@github.com:marcuswestin/tao-lang-2.git',
        credentialHelpers: ['!/nix/store/gh/bin/gh auth git-credential'],
        effectiveOriginUrl: 'https://github.com/marcuswestin/tao-lang-2.git',
      },
    }))
    const missingHelper = doctorReport(facts({
      githubTransport: {
        configuredOriginUrl: 'https://github.com/marcuswestin/tao-lang-2.git',
        credentialHelpers: ['osxkeychain'],
        effectiveOriginUrl: 'https://github.com/marcuswestin/tao-lang-2.git',
      },
    }))
    const missingBroker = doctorReport(facts({
      githubTransport: {
        configuredOriginUrl: 'https://github.com/marcuswestin/tao-lang-2.git',
        credentialHelpers: ['!/nix/store/gh/bin/gh auth git-credential'],
        effectiveOriginUrl: 'https://github.com/marcuswestin/tao-lang-2.git',
        landingBrokerReady: false,
      },
    }))

    Expect(check(ssh, 'GitHub transport')?.status).toBe('fail')
    Expect(check(ssh, 'GitHub transport')?.remediation).toContain('just github-setup')
    Expect(check(rewritten, 'GitHub transport')?.status).toBe('warn')
    Expect(check(rewritten, 'GitHub transport')?.detail).toContain('stored as git@github.com')
    Expect(check(missingHelper, 'GitHub transport')?.status).toBe('warn')
    Expect(check(missingHelper, 'GitHub transport')?.detail).toContain('no GitHub CLI credential helper')
    Expect(check(missingBroker, 'GitHub transport')?.status).toBe('warn')
    Expect(check(missingBroker, 'GitHub transport')?.remediation).toContain('just landing-setup')
  })

  Test('warns when a shared hook was never installed', () => {
    const report = doctorReport(facts({
      gitHooks: [
        { event: 'commit-msg', ours: false, present: false, resolvesHere: false, scriptPaths: [] },
        { event: 'pre-commit', ours: false, present: false, resolvesHere: false, scriptPaths: [] },
      ],
    }))

    const hooks = report.checks.filter(check => check.name === 'git hooks')
    Expect(hooks.every(hook => hook.status === 'warn')).toBe(true)
    Expect(hooks[0]?.detail).toContain('commit-msg is not installed')
    Expect(hooks[0]?.remediation).toContain('./agent setup')
    Expect(report.status).toBe('warn')
  })

  Test('warns when the shared hook names a script path stale in this worktree', () => {
    // The hooks directory is shared by every worktree on the machine and last-writer-wins: an
    // older worktree can leave a path here that only exists in its own layout.
    const report = doctorReport(facts({
      gitHooks: [
        {
          event: 'commit-msg',
          ours: true,
          present: true,
          resolvesHere: false,
          scriptPaths: ['packages/dev/dev-src/cli/agent-git-hooks.zsh'],
        },
        { event: 'pre-commit', ours: true, present: true, resolvesHere: true, scriptPaths: ['x.zsh'] },
      ],
    }))

    const stale = check(report, 'git hooks')
    Expect(stale?.status).toBe('warn')
    Expect(stale?.detail).toContain('commit-msg names packages/dev/dev-src/cli/agent-git-hooks.zsh')
    Expect(stale?.detail).toContain('silently skipped')
    Expect(stale?.remediation).toContain('./agent setup')
    Expect(report.status).toBe('warn')
  })

  Test('passes a foreign hook without examining it, and a resolved shared hook', () => {
    const report = doctorReport(facts({
      gitHooks: [
        { event: 'commit-msg', ours: false, present: true, resolvesHere: false, scriptPaths: [] },
        {
          event: 'pre-commit',
          ours: true,
          present: true,
          resolvesHere: true,
          scriptPaths: ['packages/cli/agent-cli/agent-cli-src/cli/agent-git-hooks.zsh'],
        },
      ],
    }))

    const hooks = report.checks.filter(check => check.name === 'git hooks')
    Expect(hooks.every(hook => hook.status === 'pass')).toBe(true)
    Expect(hooks[0]?.detail).toContain('was not written by this repository')
  })

  Test('names the process holding a conventional port, and who else it might belong to', () => {
    const report = doctorReport(facts({
      ports: [{ listeners: [{ command: 'node', pid: 4242 }], port: 8081, purpose: 'Expo Metro' }],
    }))

    Expect(check(report, 'ports')?.status).toBe('warn')
    Expect(check(report, 'ports')?.detail).toContain('node pid 4242')
    // A conventional port on a machine running several worktrees is as likely to be a sibling
    // worktree's dev server as this one's, so the identification step comes before the kill.
    Expect(check(report, 'ports')?.remediation).toContain('another worktree')
    Expect(check(report, 'ports')?.remediation).toContain('ps -o pid=,ppid=,lstart=,command= -p 4242')
    Expect(check(report, 'ports')?.remediation).toContain('kill -TERM 4242')
  })

  Test('never offers to kill a process this repository does not recognise', () => {
    const report = doctorReport(facts({
      ports: [{ listeners: [{ command: 'Python', pid: 60803 }], port: 8081, purpose: 'Expo Metro' }],
    }))

    // A read-only diagnosis handing out `kill -TERM` for somebody else's process is the one
    // way it could do harm.
    Expect(check(report, 'ports')?.remediation).not.toContain('kill -TERM')
    Expect(check(report, 'ports')?.remediation).toContain('ps -o pid=,ppid=,lstart=,command= -p 60803')
  })

  Test('names the other worktrees whose lanes are sharing this machine', () => {
    const report = doctorReport(facts({
      machine: {
        cpuCount: 8,
        lanes: [
          {
            lane: 'verify',
            maxSlots: 8,
            pid: 4242,
            repositoryRoot: '/w',
            slots: 4,
            startedAt: '2026-09-03T12:00:00.000Z',
          },
          {
            lane: 'dev-test',
            maxSlots: 8,
            pid: 4243,
            repositoryRoot: '/other',
            slots: 4,
            startedAt: '2026-09-03T12:00:01.000Z',
          },
        ],
        loadAverage: 9,
      },
    }))

    // A slow lane or a timed-out suite has an ordinary explanation here, and the doctor is where
    // somebody looks before they go looking for a regression.
    Expect(check(report, 'machine lanes')?.status).toBe('warn')
    Expect(check(report, 'machine lanes')?.detail).toContain('2 Tao lanes running')
    Expect(check(report, 'machine lanes')?.detail).toContain('dev-test in /other')
    Expect(check(report, 'machine lanes')?.detail).toContain('verify in this checkout')
    Expect(RepositoryDoctorCommand.exitCodeFor(report.status)).toBe(0)
  })

  Test('warns on a machine that is busy even when no other lane registered', () => {
    // An Xcode build, a Metro bundler, another repository entirely: none of them register a lane,
    // and all of them slow this one down.
    const report = doctorReport(facts({ machine: { cpuCount: 8, lanes: [], loadAverage: 30 } }))

    Expect(check(report, 'machine lanes')?.status).toBe('warn')
    Expect(check(report, 'machine lanes')?.detail).toContain('no other Tao lane is registered')
    Expect(check(report, 'machine lanes')?.detail).toContain('load 30.0 on 8 CPUs')
  })

  Test('warns about same-checkout lanes and an unavailable registry', () => {
    const local = doctorReport(facts({
      machine: {
        cpuCount: 8,
        lanes: [{
          lane: 'test',
          maxSlots: 8,
          pid: 4242,
          repositoryRoot: '/w',
          slots: 2,
          startedAt: '2026-09-03T12:00:00.000Z',
        }],
        loadAverage: 1,
        registryAvailable: true,
      },
    }))
    Expect(check(local, 'machine lanes')?.status).toBe('warn')
    Expect(check(local, 'machine lanes')?.detail).toContain('test in this checkout')

    const unavailable = doctorReport(facts({
      machine: { cpuCount: 8, lanes: [], loadAverage: 1, registryAvailable: false },
    }))
    Expect(check(unavailable, 'machine lanes')?.status).toBe('warn')
    Expect(check(unavailable, 'machine lanes')?.detail).toContain('could not be inspected')
  })

  Test('excludes only the enclosing lane from nested doctor diagnostics', () => {
    const report = doctorReport(facts({
      machine: {
        cpuCount: 8,
        currentLaneId: 'outer',
        lanes: [
          {
            id: 'outer',
            lane: 'verify-full',
            maxSlots: 8,
            pid: 4242,
            repositoryRoot: '/w',
            slots: 1,
            startedAt: '2026-09-03T12:00:00.000Z',
          },
          {
            id: 'sibling',
            lane: 'test',
            maxSlots: 8,
            pid: 4243,
            repositoryRoot: '/w',
            slots: 1,
            startedAt: '2026-09-03T12:00:01.000Z',
          },
        ],
        loadAverage: 1,
      },
    }))

    Expect(check(report, 'machine lanes')?.detail).not.toContain('verify-full')
    Expect(check(report, 'machine lanes')?.detail).toContain('test in this checkout')
  })

  Test('reports an unreadable port as unknown rather than free', () => {
    const report = doctorReport(facts({ ports: [{ port: 8081, purpose: 'Expo Metro' }] }))

    Expect(check(report, 'ports')?.status).toBe('warn')
    Expect(check(report, 'ports')?.detail).toContain('could not be inspected')
  })

  Test('formats each check as a status line with its remediation', () => {
    const lines = repositoryDoctorChecks(facts({ branch: undefined })).map(formatCheck)

    Expect(lines.some(line => line.startsWith('PASS  '))).toBe(true)
    Expect(lines.find(line => line.startsWith('WARN  worktree'))).toContain(
      '\n       Name a branch before committing: git switch -c feat/<name>',
    )
  })

  Test('offers the environment fingerprint on screen and in the structured report', async () => {
    const report = doctorReport(facts())
    const printed = await withCapturedOutput(() => RepositoryDoctorCommand.writeReport(report, {}))
    const json = await withCapturedOutput(() => RepositoryDoctorCommand.writeReport(report, { json: true }))

    // The screen is where somebody about to file a report learns that a pasteable block exists.
    Expect(printed.stdout).toContain('macOS 27.0 (26A428) · Darwin 27.0.0 · arm64')
    Expect(printed.stdout).toContain('Tao 3e1ae411dff6 · bun 1.4.2')
    Expect(printed.stdout).toContain('./agent doctor --fingerprint')
    Expect((JSON.parse(json.stdout) as DoctorReport).fingerprint).toEqual(report.fingerprint)
  })

  Test('creates nothing in a checkout that has never been built', async () => {
    // `git status` cannot see this: `.artifacts` is gitignored, so the mutation the doctor used
    // to make was invisible to the assertion that claimed to rule it out.
    const root = await mkTestDir('tao-doctor-untouched-')
    try {
      await readDoctorFacts(root)

      Expect(await FS.listDir(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('reads stale lane evidence without pruning the shared registry', async () => {
    const root = await mkTestDir('tao-doctor-registry-')
    const registryRoot = FS.resolvePath('registry', root)
    const stalePath = FS.resolvePath('stale.json', registryRoot)
    await FS.mkdir(registryRoot)
    await FS.writeJson(stalePath, {
      lane: 'verify',
      maxSlots: 4,
      pid: 2 ** 30,
      repositoryRoot: root,
      slots: 0,
      startedAt: new Date().toISOString(),
    })
    try {
      await readDoctorFacts(root, { machineRegistryRoot: registryRoot })

      Expect(await FS.exists(stalePath)).toBe(true)
      Expect(Platform.processIsAlive(2 ** 30)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reads this checkout without changing it', async () => {
    const before = await CLI.run('git', { args: ['status', '--porcelain'], cwd: Repo.getRoot() })
    const listedBefore = (await FS.listDir(Repo.resolvePath('.artifacts'))).toSorted()
    const report = doctorReport(await readDoctorFacts())
    const after = await CLI.run('git', { args: ['status', '--porcelain'], cwd: Repo.getRoot() })

    Expect((await FS.listDir(Repo.resolvePath('.artifacts'))).toSorted()).toEqual(listedBefore)
    Expect(after.stdout).toBe(before.stdout)
    Expect(report.repositoryRoot).toBe(Repo.getRoot())
    Expect(check(report, 'dependency compatibility')?.status).toBe('pass')
    Expect(check(report, 'parser artifacts')?.status).toBe('pass')
  })
  Test('fails when the worktree is reached through a symlink', () => {
    const checks = repositoryDoctorChecks(facts({ processGivenPath: '/tmp/probe', processRealPath: '/w' }))
    const check = checks.find(candidate => candidate.name === 'worktree path')
    Expect(check?.status).toBe('fail')
    Expect(check?.remediation).toContain('git worktree move /tmp/probe /w')
  })

  Test('passes when the worktree is at its real path', () => {
    const checks = repositoryDoctorChecks(facts())
    Expect(checks.find(candidate => candidate.name === 'worktree path')?.status).toBe('pass')
  })
})

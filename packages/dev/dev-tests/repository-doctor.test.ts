import { CLI, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  type DoctorFacts,
  doctorReport,
  formatCheck,
  readDoctorFacts,
  repositoryDoctorChecks,
} from '../dev-src/doctor/RepositoryDoctor'
import { RepositoryDoctorCommand } from '../dev-src/doctor/RepositoryDoctorCommand'

function facts(overrides: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    artifactRoots: [{ path: '.artifacts/tmp', present: true, sizeBytes: 2_500_000, writable: true }],
    branch: 'feat/example',
    bunTempDir: { path: '/w/.artifacts/tmp', writable: true },
    bunVersion: '1.3.13',
    dependencyIssues: [],
    devenvProfileNode: '/w/.devenv/profile/bin/node',
    direnvAllowed: true,
    generatedParserArtifacts: [{ path: 'packages/parser/parser-src/_gen_tao-parser/ast.ts', present: true }],
    linkedWorktree: true,
    lockfilePresent: true,
    nodeModulesPresent: true,
    nodeVersion: 'v24.14.1',
    ports: [{ listeners: [], port: 8081, purpose: 'Expo Metro' }],
    repositoryRoot: '/w',
    satisfies: (version, range) => Bun.semver.satisfies(version, range),
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
    Expect(check(report, 'dependencies')?.remediation).toContain('just clean-scratch && just deps')
  })

  Test('surfaces the runtime dependency compatibility gate', () => {
    const report = doctorReport(facts({ dependencyIssues: ['tao-studio resolves react 19.2.8'] }))

    Expect(check(report, 'dependency compatibility')?.status).toBe('fail')
    Expect(check(report, 'dependency compatibility')?.detail).toContain('react 19.2.8')
  })

  Test('names the process holding a conventional port', () => {
    const report = doctorReport(facts({
      ports: [{ listeners: [{ command: 'node', pid: 4242 }], port: 8081, purpose: 'Expo Metro' }],
    }))

    Expect(check(report, 'ports')?.status).toBe('warn')
    Expect(check(report, 'ports')?.detail).toContain('node pid 4242')
    Expect(check(report, 'ports')?.remediation).toBe('Stop it with: kill -TERM 4242')
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

  Test('reads this checkout without changing it', async () => {
    const before = await CLI.run('git', { args: ['status', '--porcelain'], cwd: Repo.getRoot() })
    const report = doctorReport(await readDoctorFacts())
    const after = await CLI.run('git', { args: ['status', '--porcelain'], cwd: Repo.getRoot() })

    Expect(after.stdout).toBe(before.stdout)
    Expect(report.repositoryRoot).toBe(Repo.getRoot())
    Expect(check(report, 'dependency compatibility')?.status).toBe('pass')
    Expect(check(report, 'parser artifacts')?.status).toBe('pass')
  })
})

import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { classifyFailure, formatGateSummary, gateExitCode, runGates } from '../dev-src/repository-tests/GateRunner'

type GateScript = Record<string, { exitCode: number; output: string }>

async function run(gates: readonly string[], script: GateScript, extra: Record<string, unknown> = {}) {
  const root = await mkTestDir('tao-gate-runner-')
  try {
    const started: string[] = []
    const summary = await runGates({
      gates,
      jobs: 2,
      logRoot: FS.resolvePath('logs', root),
      repositoryRoot: root,
      runGate: async (name, logPath) => {
        started.push(name)
        const result = script[name] ?? { exitCode: 0, output: '' }
        await FS.writeText(logPath, result.output)
        return result
      },
      ...extra,
    })
    return { root, started, summary }
  } finally {
    await FS.remove(root)
  }
}

Describe('repository gate runner', () => {
  Test('reports every gate with its status, cost, and log path', async () => {
    const { summary } = await run(['_repo-lint', '_typecheck'], {})

    Expect(summary.status).toBe('passed')
    Expect(summary.version).toBe(1)
    Expect(summary.gates.map(gate => gate.name)).toEqual(['_repo-lint', '_typecheck'])
    Expect(summary.gates.every(gate => gate.status === 'passed')).toBe(true)
    Expect(summary.gates.every(gate => gate.logPath !== undefined)).toBe(true)
    Expect(gateExitCode(summary)).toBe(0)
  })

  Test('fails the wrapper when one gate fails, never hiding its status', async () => {
    const { summary } = await run(['_repo-lint', '_typecheck'], {
      _typecheck: { exitCode: 2, output: 'error TS2345: bad argument' },
    })

    Expect(summary.status).toBe('failed')
    Expect(gateExitCode(summary)).toBe(1)
    Expect(summary.gates.find(gate => gate.name === '_typecheck')?.exitCode).toBe(2)
    Expect(summary.gates.find(gate => gate.name === '_repo-lint')?.status).toBe('passed')
  })

  Test('names the first actionable failure in declaration order', async () => {
    const { summary } = await run(['_repo-lint', '_typecheck', '_test'], {
      _test: { exitCode: 1, output: 'test failed' },
      _typecheck: { exitCode: 2, output: 'error TS2345: bad argument' },
    })

    Expect(summary.firstFailure?.name).toBe('_typecheck')
    Expect(summary.firstFailure?.output).toContain('error TS2345')
    Expect(formatGateSummary(summary)).toContain('First failure — _typecheck')
  })

  Test('reports a skipped gate as skipped, with why, and never as passed', async () => {
    const { summary } = await run(['_repo-lint'], {}, {
      skipped: ['studio-smoke=slow lane; run just studio-smoke or just full-verify'],
    })

    const skipped = summary.gates.find(gate => gate.name === 'studio-smoke')
    Expect(skipped?.status).toBe('skipped')
    Expect(skipped?.reason).toBe('slow lane; run just studio-smoke or just full-verify')
    Expect(summary.gates.filter(gate => gate.status === 'passed').map(gate => gate.name)).toEqual(['_repo-lint'])
    Expect(formatGateSummary(summary)).toContain('1 passed, 0 failed, 1 skipped')
  })

  Test('surfaces warnings a gate printed without failing on them', async () => {
    const { summary } = await run(['_ide-extension-build'], {
      '_ide-extension-build': { exitCode: 0, output: 'Warning: rule declared but never referenced' },
    })

    Expect(summary.warnings).toEqual(['_ide-extension-build: Warning: rule declared but never referenced'])
    Expect(summary.status).toBe('passed')
    Expect(formatGateSummary(summary)).toContain('! _ide-extension-build: Warning:')
  })

  Test('runs every gate exactly once, whatever the concurrency', async () => {
    const { started } = await run(['a', 'b', 'c', 'd', 'e'], {})

    Expect(started.toSorted()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  Test('writes a JSON summary artifact when one is requested', async () => {
    const root = await mkTestDir('tao-gate-runner-json-')
    try {
      await runGates({
        gates: ['_repo-lint'],
        jsonPath: 'summary.json',
        logRoot: FS.resolvePath('logs', root),
        repositoryRoot: root,
        runGate: async () => ({ exitCode: 0, output: '' }),
      })

      const written = await FS.readJson<{ status: string; version: number }>(FS.resolvePath('summary.json', root))
      Expect(written.version).toBe(1)
      Expect(written.status).toBe('passed')
    } finally {
      await FS.remove(root)
    }
  })
})

Describe('gate failure classification', () => {
  Test('separates the four failures that need different people to act', () => {
    Expect(classifyFailure('PermissionDenied: copy file android/.idea/migrations.xml'))
      .toBe('sandbox-restriction')
    Expect(classifyFailure("Tao's pinned devenv profile is unavailable.")).toBe('environment-setup')
    Expect(classifyFailure("error: Cannot find module 'ink'")).toBe('environment-setup')
    Expect(classifyFailure('watchman is not installed')).toBe('optional-tooling')
    Expect(classifyFailure('error TS2345: Argument of type string is not assignable')).toBe('repository')
  })

  Test('names the kind of failure alongside the exit status', async () => {
    const { summary } = await run(['_typecheck'], {
      _typecheck: { exitCode: 2, output: 'error TS2345: bad argument' },
    })

    Expect(summary.gates[0]?.failureKind).toBe('repository')
    Expect(summary.gates[0]?.reason).toBe('exited 2 (repository)')
  })
})

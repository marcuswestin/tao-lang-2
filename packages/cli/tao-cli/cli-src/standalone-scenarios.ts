import { Errors, FS, HCI } from '@shared'

type Scenario = { name: string; run: () => Promise<unknown> }
type Result = {
  name: string
  status: 'unrun' | 'running' | 'passed' | 'failed'
  durationMs?: number
  error?: string
}

/** Named, fail-fast installed CLI proofs, retained even when a later proof fails. */
export const StandaloneScenarios = { run, commandOutput } as const

async function run(scenarios: readonly Scenario[], summaryPath: string): Promise<void> {
  const results: Result[] = scenarios.map(({ name }) => ({ name, status: 'unrun' }))
  const summary = { format: 'tao-standalone-acceptance-v1', scenarios: results }
  await publishSummary(summaryPath, summary)
  for (const [index, scenario] of scenarios.entries()) {
    const result = results[index]!
    const startedAt = Date.now()
    result.status = 'running'
    await publishSummary(summaryPath, summary)
    HCI.writeLine(`[${index + 1}/${scenarios.length}] RUN ${scenario.name}`)
    try {
      await scenario.run()
      result.status = 'passed'
    } catch (error) {
      result.status = 'failed'
      result.error = Errors.formatForUser(error)
      throw error
    } finally {
      result.durationMs = Date.now() - startedAt
      await publishSummary(summaryPath, summary)
      HCI.writeLine(`[${index + 1}/${scenarios.length}] ${result.status.toUpperCase()} ${scenario.name}`)
    }
  }
}

/** Publish complete JSON in one rename; an interrupted write preserves the previous checkpoint. */
async function publishSummary(summaryPath: string, summary: unknown): Promise<void> {
  // Each acceptance run owns its summary path and this sibling, including a partial prior write.
  const pending = `${summaryPath}.pending`
  try {
    await FS.writeJson(pending, summary)
    await FS.move(pending, summaryPath)
  } finally {
    if (await FS.isFile(pending)) {
      await FS.remove(pending)
    }
  }
}

/** An expected rejection proves the diagnostic as well as a nonzero command exit. */
function commandOutput(
  script: string,
  result: { exitCode: number | null; stdout: string; stderr: string; error?: unknown },
  expectedDiagnostic?: RegExp,
): string {
  const output = result.stdout + result.stderr
  if (result.exitCode === null || result.error !== undefined) {
    Errors.throwHostEnvironment(`\`${script}\` did not complete normally:\n${output}`)
  }
  if (expectedDiagnostic !== undefined) {
    if (result.exitCode === 0 || !expectedDiagnostic.test(output)) {
      Errors.throwUnexpected(
        `\`${script}\` did not reject with ${expectedDiagnostic} (exit ${result.exitCode}):\n${output}`,
      )
    }
  } else if (result.exitCode !== 0) {
    Errors.throwUnexpected(`\`${script}\` failed (exit ${result.exitCode}):\n${output}`)
  }
  return result.stdout
}

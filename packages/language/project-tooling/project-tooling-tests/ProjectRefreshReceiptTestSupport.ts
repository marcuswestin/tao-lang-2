import { Workspace } from '@compiler/workspace'
import { FS } from '@shared'
import { Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import type { ProjectToolingResult, ProjectToolingWatch } from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'

export const validationSlot = testOverrideSlot({
  read: () => Workspace.prototype.validateFiles,
  write: value => {
    Workspace.prototype.validateFiles = value
  },
})

export function semanticResult(result: ProjectToolingResult) {
  const { revision: _revision, changedOutputPaths: _changed, ...semantic } = result
  return semantic
}

export async function warmReceipt(
  watch: ProjectToolingWatch,
  previous?: ProjectToolingResult,
): Promise<ProjectToolingResult> {
  previous ??= watch.lastResult
  for (let index = 0; index < 4; index += 1) {
    const current = await watch.requestRefresh()
    if (current.revision === previous.revision) {
      return current
    }
    previous = current
  }
  Expect('a stable fresh watch must reuse its completed revision').toBe('receipt reused')
  return previous
}

type ReceiptFixture = Readonly<Record<string, string>>

/** One cache invalidation scenario: the file it rewrites, its new bytes, and the status the next refresh reports. */
export type ReceiptMutationCase = {
  title: string
  target: (paths: Readonly<Record<string, string>>, root: string) => string
  content: string
  expectedStatus: 'fresh' | 'stale'
  /** The target is a generated output, which the next publication repairs without a restore. */
  generatedOutput?: boolean
}

/**
 * Registers cache invalidation scenarios that share one warm watch, so the cold start is paid once
 * per file rather than once per scenario. Each scenario starts from a reused receipt, checks the
 * incremental result against a forced cold refresh, restores its file, and re-warms the receipt; a
 * scenario that leaves the project changed fails its own fresh repair or the next one's reuse.
 */
export function registerReceiptMutationCases(
  title: string,
  fixture: ReceiptFixture,
  cases: readonly ReceiptMutationCase[],
): void {
  Test(title, async () => {
    await withTaoFiles('tao-refresh-receipt-inputs-', fixture, async (paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      try {
        let warm = await warmReceipt(watch)
        for (const mutation of cases) {
          warm = await labelFailure(mutation.title, () => applyReceiptMutation(watch, paths, root, warm, mutation))
        }
      } finally {
        await watch.dispose()
      }
    }, { location: 'host' })
  })
}

async function applyReceiptMutation(
  watch: ProjectToolingWatch,
  paths: Readonly<Record<string, string>>,
  root: string,
  previous: ProjectToolingResult,
  mutation: ReceiptMutationCase,
): Promise<ProjectToolingResult> {
  const path = mutation.target(paths, root)
  const saved = await FS.isFile(path) ? await FS.readText(path) : undefined
  const contract = FS.resolvePath('.tao-ts/Main.tao.ts', root)
  const savedContract = await FS.readText(contract)
  await FS.writeText(path, mutation.content)
  const changed = await watch.requestRefresh()
  Expect(changed.revision).toBeGreaterThan(previous.revision)
  Expect(changed.status).toBe(mutation.expectedStatus)
  const parity = await watch.requestRefresh({ force: true })
  Expect(semanticResult(changed)).toEqual(semanticResult(parity))
  if (path === contract) {
    Expect(changed.changedOutputPaths).toContain(contract)
    Expect(await FS.readText(contract)).toBe(savedContract)
  }
  if (mutation.generatedOutput) {
    // Publication already repaired this output; cold parity proves its authoritative bytes.
    Expect(parity.status).toBe('fresh')
    return await warmReceipt(watch, parity)
  }
  if (saved === undefined) {
    await FS.remove(path)
    if (path.includes('Nested/.tao/')) {
      await FS.remove(FS.resolvePath('Nested/.tao', root))
    }
  } else {
    await FS.writeText(path, saved)
  }
  const repaired = await watch.requestRefresh({ force: true })
  Expect(repaired.status).toBe('fresh')
  return await warmReceipt(watch, repaired)
}

/** labelFailure names the scenario in a failure, since several scenarios share one test. */
async function labelFailure<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof Error) {
      error.message = `${label}: ${error.message}`
    }
    throw error
  }
}

export function registerMissingContractMutationTest(): void {
  Test('reconstructs a missing generated contract and reports its changed output', async () => {
    await withTaoFiles('tao-refresh-receipt-inputs-', {
      'Main.tao': 'type Answer is one of One, Two\n',
      'Nested/Value.ts': 'export const value = 1\n',
    }, async (_paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      try {
        const previous = await warmReceipt(watch)
        const contract = FS.resolvePath('.tao-ts/Main.tao.ts', root)
        const savedContract = await FS.readText(contract)
        await FS.remove(contract)
        const missing = await watch.requestRefresh()
        Expect(missing.revision).toBeGreaterThan(previous.revision)
        Expect(missing.changedOutputPaths).toContain(contract)
        Expect(await FS.readText(contract)).toBe(savedContract)
        const repaired = await watch.requestRefresh({ force: true })
        Expect(repaired.status).toBe('fresh')
        await warmReceipt(watch, repaired)
      } finally {
        await watch.dispose()
      }
    }, { location: 'host' })
  })
}

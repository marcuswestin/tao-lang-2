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
  previous ??= await watch.requestRefresh()
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

/** Registers one independent cache invalidation scenario against an otherwise identical cold watch. */
export function registerReceiptMutationTest(
  title: string,
  fixture: ReceiptFixture,
  target: (paths: Readonly<Record<string, string>>, root: string) => string,
  content: string,
  expectedStatus: 'fresh' | 'stale',
): void {
  Test(title, async () => {
    await withTaoFiles('tao-refresh-receipt-inputs-', fixture, async (paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      try {
        const previous = await warmReceipt(watch)
        const path = target(paths, root)
        const saved = await FS.isFile(path) ? await FS.readText(path) : undefined
        const contract = FS.resolvePath('.tao-ts/Main.tao.ts', root)
        const savedContract = await FS.readText(contract)
        await FS.writeText(path, content)
        const changed = await watch.requestRefresh()
        Expect(changed.revision).toBeGreaterThan(previous.revision)
        Expect(changed.status).toBe(expectedStatus)
        Expect(semanticResult(changed)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
        if (path === contract) {
          Expect(changed.changedOutputPaths).toContain(contract)
          Expect(await FS.readText(contract)).toBe(savedContract)
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
        await warmReceipt(watch, repaired)
      } finally {
        await watch.dispose()
      }
    }, { location: 'host' })
  })
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

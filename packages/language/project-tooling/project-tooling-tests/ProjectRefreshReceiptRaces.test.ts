import { Workspace } from '@compiler/workspace'
import { FS } from '@shared'
import { Describe, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import { ProjectRefreshReceipt } from '../project-tooling-src/ProjectRefreshReceipt'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { semanticResult, validationSlot, warmReceipt } from './ProjectRefreshReceiptTestSupport'

const auditSlot = testOverrideSlot({
  read: () => ProjectRefreshReceipt.prototype.audit,
  write: value => {
    ProjectRefreshReceipt.prototype.audit = value
  },
})
const rememberSlot = testOverrideSlot({
  read: () => ProjectRefreshReceipt.prototype.remember,
  write: value => {
    ProjectRefreshReceipt.prototype.remember = value
  },
})
Describe('watched project refresh receipt races', () => {
  Test('rejects an ABA source read whose parsed text differs from both filesystem audits', async () => {
    await withTaoFiles('tao-refresh-receipt-raced-parse-', {
      'Main.tao': 'type Original is one of One, Two\n',
    }, async (paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      const original = Workspace.prototype.validateFiles
      const saved = await FS.readText(paths['Main.tao'])
      await warmReceipt(watch)
      let raced = false
      const restore = validationSlot.install(async function(this: Workspace, entries) {
        if (!raced && entries.includes(paths['Main.tao'])) {
          raced = true
          await FS.writeText(paths['Main.tao'], 'type Interleaved is one of Changed, Value\n')
          try {
            return await original.call(this, entries)
          } finally {
            await FS.writeText(paths['Main.tao'], saved)
          }
        }
        return await original.call(this, entries)
      })
      try {
        await warmReceipt(watch)
        // Warm-up must not trigger the race: force explicitly enters the parsed graph.
        Expect(raced).toBe(false)
        const interleaved = await watch.requestRefresh({ force: true })
        Expect(raced).toBe(true)
        Expect(interleaved.status).toBe('fresh')
        const corrected = await watch.requestRefresh()
        Expect(corrected.revision).toBeGreaterThan(interleaved.revision)
        Expect(corrected.status).toBe('fresh')
        const content = await FS.readText(corrected.contractPaths[0]!)
        Expect(content).toContain('Original')
        Expect(content).not.toContain('Interleaved')
        Expect(semanticResult(corrected)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
      } finally {
        restore()
        await watch.dispose()
      }
    }, { location: 'host' })
  })

  Test('rejects ABA ownership discovery that omitted an authored contract between equal disk audits', async () => {
    await withTaoFiles('tao-refresh-receipt-raced-ownership-', {
      'Main.tao': 'type MainAnswer is one of One, Two\n',
      'Nested/Extra.tao': 'type ExtraAnswer is one of One, Two\n',
    }, async (_paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      await warmReceipt(watch)
      const extraContract = FS.resolvePath('.tao-ts/Nested/Extra.tao.ts', root)
      Expect(watch.lastResult.contractPaths).toContain(extraContract)
      const marker = FS.resolvePath('Nested/.tao', root)
      const originalAudit = ProjectRefreshReceipt.prototype.audit
      const originalValidation = Workspace.prototype.validateFiles
      let arm = true
      let markerAdded = false
      let markerRemoved = false
      const restoreAudit = auditSlot.install(
        async function(this: ProjectRefreshReceipt, options, force, nativeIdentity) {
          const audit = await originalAudit.call(this, options, force, nativeIdentity)
          if (arm) {
            arm = false
            await FS.mkdir(marker)
            markerAdded = true
          }
          return audit
        },
      )
      const restoreValidation = validationSlot.install(async function(this: Workspace, entries) {
        if (markerAdded && !markerRemoved) {
          await FS.remove(marker)
          markerRemoved = true
        }
        return await originalValidation.call(this, entries)
      })
      try {
        const omitted = await watch.requestRefresh({ force: true })
        Expect(markerAdded).toBe(true)
        Expect(markerRemoved).toBe(true)
        Expect(omitted.status).toBe('fresh')
        Expect(omitted.contractPaths).not.toContain(extraContract)
        const restored = await watch.requestRefresh()
        Expect(restored.revision).toBeGreaterThan(omitted.revision)
        Expect(restored.status).toBe('fresh')
        Expect(restored.contractPaths).toContain(extraContract)
        Expect(await FS.isFile(extraContract)).toBe(true)
        Expect(semanticResult(restored)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
      } finally {
        restoreValidation()
        restoreAudit()
        await watch.dispose()
      }
    }, { location: 'host' })
  })

  Test('revalidates identity after an invalid-valid-invalid marker race during a cold refresh', async () => {
    await withTaoFiles('tao-refresh-receipt-raced-identity-', {
      '.tao/.gitkeep': '',
      'Main.ts': 'export const value: number = 1\n',
    }, async (_paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      await warmReceipt(watch)
      const identity = FS.resolvePath('.tao/store/project.json', root)
      const valid = await FS.readText(identity)
      const invalid = '{"id":"invalid"}\n'
      const originalAudit = ProjectRefreshReceipt.prototype.audit
      const originalRemember = ProjectRefreshReceipt.prototype.remember
      let arm = true
      let validated = false
      const restoreAudit = auditSlot.install(
        async function(this: ProjectRefreshReceipt, options, force, nativeIdentity) {
          if (arm && force) {
            arm = false
            await FS.writeText(identity, invalid)
            const audit = await originalAudit.call(this, options, force, nativeIdentity)
            await FS.writeText(identity, valid)
            validated = true
            return audit
          }
          return await originalAudit.call(this, options, force, nativeIdentity)
        },
      )
      const restoreRemember = rememberSlot.install(async function(this: ProjectRefreshReceipt, before, options, data) {
        await FS.writeText(identity, invalid)
        return await originalRemember.call(this, before, options, data)
      })
      try {
        const raced = await watch.requestRefresh({ force: true })
        Expect(validated).toBe(true)
        Expect(raced.diagnostics).toEqual([])
        Expect(raced.status).toBe('fresh')
        Expect(await FS.readText(identity)).toBe(invalid)
        const rejected = await watch.requestRefresh()
        Expect(rejected.revision).toBeGreaterThan(raced.revision)
        Expect(rejected.status).toBe('stale')
        Expect(rejected.diagnostics.some(diagnostic => diagnostic.message.includes('Invalid Tao project identity')))
          .toBe(true)
        Expect(semanticResult(rejected)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
      } finally {
        restoreRemember()
        restoreAudit()
        await watch.dispose()
      }
    }, { location: 'host' })
  })
})

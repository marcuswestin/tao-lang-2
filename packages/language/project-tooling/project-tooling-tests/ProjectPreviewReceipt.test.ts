import { FS, Platform } from '@shared'
import { Expect, Test, withTaoFiles } from '@shared/test'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { warmReceipt } from './ProjectRefreshReceiptTestSupport'

Test('preview receipt accepts exact source bytes only inside the unchanged authoritative input and output graph', async () => {
  await withTaoFiles('tao-preview-receipt-', {
    'Main.tao': 'type Answer is one of One, Two\n',
    'Value.ts': 'export const value = 1\n',
  }, async (paths, root) => {
    const watch = await ProjectTooling.watch(root, { automaticRefresh: false })
    const versions = async () => ({ 'Main.tao': Platform.sha256Hex(await FS.readText(paths['Main.tao']!)) })
    const audited = async () => await watch.auditPreview!(await versions(), Platform.sha256Hex)
    try {
      await warmReceipt(watch)
      const savedValue = await FS.readText(paths['Value.ts']!)
      Expect(await audited()).toBe(true)
      const before = await versions()
      await FS.writeText(paths['Main.tao']!, 'type Answer is one of One, Two, Three\n')
      Expect(await watch.auditPreview!(before, Platform.sha256Hex)).toBe(false)
      Expect(await audited()).toBe(true)
      await FS.writeText(paths['Value.ts']!, 'export const value = 2\n')
      Expect(await audited()).toBe(false)
      await FS.writeText(paths['Value.ts']!, savedValue)
      Expect(await audited()).toBe(true)
      const contract = FS.resolvePath('.tao-ts/Main.tao.ts', root)
      const saved = await FS.readText(contract)
      await FS.writeText(contract, saved + '// other writer\n')
      Expect(await audited()).toBe(false)
      await FS.writeText(contract, saved)
      Expect(await audited()).toBe(true)
      const added = FS.resolvePath('Added.tao', root)
      await FS.writeText(added, 'type Added is one of Item\n')
      Expect(await audited()).toBe(false)
      await FS.remove(added)
      Expect(await audited()).toBe(true)
      await FS.remove(paths['Main.tao']!)
      Expect(await audited().catch(() => false)).toBe(false)
    } finally {
      await watch.dispose()
    }
    Expect(await watch.auditPreview!({ 'Main.tao': 'obsolete' }, Platform.sha256Hex)).toBe(false)
  }, { location: 'host' })
})

import { FS } from '@shared'
import { Expect, Test, withTaoFiles } from '@shared/test'
import {
  StudioGeneratedSources,
  studioGeneratedSourceHeader,
} from '../studio-src/StudioGeneratedSources'

Test('Studio writes generated public views read-only and repairs their mode on reopen', async () => {
  await withTaoFiles('tao-studio-generated-', { 'Project.tao': 'project Garden\n' }, async (_paths, root) => {
    const generated = new StudioGeneratedSources(root)
    const path = await generated.writeView('View1', 'public\nview View1() { render Placeholder("View 1") }')

    Expect(await FS.readText(path)).toBe(
      `${studioGeneratedSourceHeader}\n\npublic\nview View1() { render Placeholder("View 1") }\n`,
    )
    Expect(await FS.fileMode(path)).toBe(0o444)

    await FS.chmod(path, 0o644)
    await generated.repair()
    Expect(await FS.fileMode(path)).toBe(0o444)
  })
})

Test('Studio restores generated source to read-only after a failed rewrite', async () => {
  await withTaoFiles('tao-studio-generated-failure-', { 'Project.tao': 'project Garden\n' }, async (_paths, root) => {
    const generated = new StudioGeneratedSources(root)
    const path = await generated.writeView('View1', 'public\nview View1() {}')

    await Expect(generated.writeView('View1', 'public\nview View1() { render Text("Later") }', async target => {
      Expect(await FS.fileMode(target)).toBe(0o644)
      throw new Error('simulated generated write failure')
    })).rejects.toThrow('simulated generated write failure')
    Expect(await FS.fileMode(path)).toBe(0o444)
  })
})

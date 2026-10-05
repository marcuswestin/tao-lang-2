import { FS, ProjectIdentity } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('project identity', () => {
  Test('assigns one checked-in ID across concurrent initialization and preserves a copied marker', async () => {
    const root = await mkTestDir('tao-project-identity-')
    try {
      const first = FS.resolvePath('First', root)
      const copied = FS.resolvePath('Copied', root)
      await FS.mkdir(FS.resolvePath('.tao', first))
      await FS.mkdir(FS.resolvePath('.tao', copied))
      const ids = await Promise.all(Array.from({ length: 4 }, () => ProjectIdentity.ensure(first)))
      Expect(new Set(ids).size).toBe(1)
      Expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      const marker = await FS.readText(FS.resolvePath('.tao/store/project.json', first))
      await FS.writeText(FS.resolvePath('.tao/store/project.json', copied), marker)
      Expect(ProjectIdentity.read(copied)).toBe(ids[0])
      Expect(await ProjectIdentity.ensure(copied)).toBe(ids[0])
      Expect(await FS.readText(FS.resolvePath('.tao/store/project.json', copied))).toBe(marker)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects an invalid existing marker without replacing it', async () => {
    const root = await mkTestDir('tao-project-invalid-identity-')
    try {
      const path = FS.resolvePath('.tao/store/project.json', root)
      await FS.writeText(path, '{"id":"not-a-uuid"}\n')
      await Expect(ProjectIdentity.ensure(root)).rejects.toThrow('Invalid Tao project identity')
      Expect(await FS.readText(path)).toBe('{"id":"not-a-uuid"}\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps a main-era checked-in identity when moving it into the project store', async () => {
    const root = await mkTestDir('tao-project-old-identity-')
    try {
      const old = FS.resolvePath('.tao/project.json', root)
      const marker = FS.resolvePath('.tao/store/project.json', root)
      const content = '{"id":"123e4567-e89b-42d3-a456-426614174000"}\n'
      await FS.writeText(old, content)
      Expect(await ProjectIdentity.ensure(root)).toBe('123e4567-e89b-42d3-a456-426614174000')
      Expect(await FS.readText(marker)).toBe(content)
      Expect(await FS.exists(old)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
})

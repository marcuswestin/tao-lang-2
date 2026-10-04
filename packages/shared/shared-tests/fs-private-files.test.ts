import { FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'

Test('exclusive files preserve private text and binary content', async () => {
  const root = await mkTestDir('exclusive-private-files-')
  const text = FS.resolvePath('receipt.json', root)
  const binary = FS.resolvePath('capture.png', root)
  const bytes = new Uint8Array([0, 137, 80, 255])
  await FS.writeExclusiveFile(text, 'private receipt', { mode: 0o600 })
  await FS.writeExclusiveFile(binary, bytes, { mode: 0o600 })
  Expect(await FS.readText(text)).toBe('private receipt')
  Expect(Array.from(await FS.readFile(binary))).toEqual(Array.from(bytes))
  Expect(await FS.fileMode(text)).toBe(0o600)
  Expect(await FS.fileMode(binary)).toBe(0o600)
})

Test('exclusive file collisions preserve existing entries and symlink targets', async () => {
  const root = await mkTestDir('exclusive-file-collisions-')
  const existing = FS.resolvePath('existing.txt', root)
  const link = FS.resolvePath('linked.txt', root)
  await FS.writeText(existing, 'borrowed content', { mode: 0o644 })
  const originalMode = await FS.fileMode(existing)
  await FS.symlink(existing, link)
  await Expect(FS.writeExclusiveFile(existing, 'replacement', { mode: 0o600 })).rejects.toThrow()
  await Expect(FS.writeExclusiveFile(link, 'replacement', { mode: 0o600 })).rejects.toThrow()
  Expect(await FS.readText(existing)).toBe('borrowed content')
  Expect(await FS.readText(link)).toBe('borrowed content')
  Expect(await FS.fileMode(existing)).toBe(originalMode)
  Expect(await FS.isSymbolicLink(link)).toBe(true)
})

Test('exclusive writes refuse missing parents without creating them', async () => {
  const root = await mkTestDir('exclusive-missing-parent-')
  const parent = FS.resolvePath('unallocated', root)
  await Expect(FS.writeExclusiveFile(FS.resolvePath('receipt.json', parent), 'private', { mode: 0o600 }))
    .rejects.toThrow()
  Expect(await FS.exists(parent)).toBe(false)
})

Test('file URLs import the exact local module with spaces, hashes and percent signs', async () => {
  const root = await mkTestDir('escaped-module-url-')
  const path = FS.resolvePath('space #100%.ts', root)
  await FS.writeText(path, "export default 'exact private module'\n")
  const url = FS.fileUrl(path)
  Expect(url.endsWith('/space%20%23100%25.ts')).toBe(true)
  Expect(new URL(url).protocol).toBe('file:')
  Expect(new URL(url).hash).toBe('')
  Expect((await import(url)).default).toBe('exact private module')
})

import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { StandaloneResources } from '../cli-src/standalone-resources'

Describe('standalone resources', () => {
  Test('unpacks the payload into a stamped tree', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      const archive = await payload({ 'stdlib/@tao/ui/Views.tao': 'public view Text(Value text) { }\n' })

      Expect(await StandaloneResources.unpack(archive, directory)).toBe(directory)

      Expect(await FS.readText(FS.resolvePath('stdlib/@tao/ui/Views.tao', directory)))
        .toBe('public view Text(Value text) { }\n')
      // The name is the on-disk contract `TaoResources` probes for; an installed tree outlives a build.
      Expect(await FS.isFile(FS.resolvePath('.tao-resources', directory))).toBe(true)
    })
  })

  Test('keeps a tree already unpacked from the same payload', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      const archive = await payload({ 'host/package.json': '{}\n' })
      await StandaloneResources.unpack(archive, directory)
      await FS.writeText(FS.resolvePath('host/_gen_tao-app/App.tsx', directory), 'generated\n')

      await StandaloneResources.unpack(archive, directory)

      Expect(await FS.readText(FS.resolvePath('host/_gen_tao-app/App.tsx', directory))).toBe('generated\n')
    })
  })

  // A binary rebuilt into the same directory must not read a stdlib the older build shipped.
  Test('replaces a tree unpacked from another payload and removes the old one', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      await StandaloneResources.unpack(await payload({ 'stdlib/@tao/ui/Old.tao': 'old\n' }), directory)

      await StandaloneResources.unpack(await payload({ 'stdlib/@tao/ui/New.tao': 'new\n' }), directory)

      Expect(await FS.exists(FS.resolvePath('stdlib/@tao/ui/Old.tao', directory))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('stdlib/@tao/ui/New.tao', directory))).toBe('new\n')
      // The resource directory and the one tree behind it; the earlier payload's tree is gone.
      Expect(await FS.listDir(root)).toHaveLength(2)
    })
  })

  // A first run that probes mid-replacement and finds nothing settles on `/$bunfs` for its whole run.
  Test('never leaves the resource directory missing while it replaces a tree', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      const stamp = FS.resolvePath('.tao-resources', directory)
      await StandaloneResources.unpack(await payload({ 'stdlib/Project.tao': 'old\n' }), directory)
      const replacement = await payload({ 'stdlib/Project.tao': 'new\n' })

      let settled = false
      const replacing = StandaloneResources.unpack(replacement, directory).finally(() => {
        settled = true
      })
      const observed: boolean[] = []
      while (!settled) {
        observed.push(FS.existsSync(stamp))
        await new Promise(resolve => setImmediate(resolve))
      }
      await replacing

      Expect(await FS.readText(FS.resolvePath('stdlib/Project.tao', directory))).toBe('new\n')
      Expect(observed.length).toBeGreaterThan(0)
      Expect(observed.filter(present => !present)).toEqual([])
    })
  })

  // A shell completion and the command it completes are enough to start two first runs at once.
  Test('lets concurrent first runs race to one complete tree', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      const archive = await payload({ 'modules/@tao/runtime/package.json': '{}\n' })

      // Enough runs that some usually lose the rename of their staging tree into place; with a
      // handful, each tends to find the tree already there and never reach it.
      const runs = Array.from({ length: 32 }, () => StandaloneResources.unpack(archive, directory))
      const results = await Promise.all(runs)

      Expect(new Set(results)).toEqual(new Set([directory]))
      Expect(await FS.readText(FS.resolvePath('modules/@tao/runtime/package.json', directory))).toBe('{}\n')
      Expect(await FS.listDir(root)).toHaveLength(2)
    })
  })

  Test('names the directory it could not unpack into', async () => {
    await withRoot(async root => {
      const blocker = FS.resolvePath('not-a-directory', root)
      await FS.writeText(blocker, '')
      const directory = FS.resolvePath('resources', blocker)

      await Expect(StandaloneResources.unpack(await payload({ 'stdlib/Project.tao': '' }), directory))
        .rejects.toThrow(`Tao could not unpack its resources into ${directory}`)
    })
  })
})

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-standalone-resources-')
  try {
    await run(root)
  } finally {
    await FS.remove(root)
  }
}

async function payload(files: Record<string, string>): Promise<Uint8Array> {
  return await new Bun.Archive(files, { compress: 'gzip' }).bytes()
}

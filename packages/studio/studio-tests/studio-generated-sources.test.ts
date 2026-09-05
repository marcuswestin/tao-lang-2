import { Errors, FS } from '@shared'
import { Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import {
  studioGeneratedSourceHeader,
  StudioGeneratedSources,
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

Test('Studio repairs every contained source before reporting an invalid generated path', async () => {
  await withTaoFiles('tao-studio-generated-repair-all-', {
    'Outside.tao': 'view Outside() { }\n',
    'Project.tao': 'project Garden\n',
  }, async (paths, root) => {
    const escaped = FS.resolvePath('@/studio/View1.tao', root)
    const contained = FS.resolvePath('@/studio/View2.tao', root)
    await FS.symlink(paths['Outside.tao'], escaped)
    await FS.writeText(contained, `${studioGeneratedSourceHeader}\n\npublic view View2() { }\n`)
    await FS.chmod(contained, 0o644)

    await Expect(new StudioGeneratedSources(root).repair()).rejects.toThrow('could not restore read-only ownership')
    Expect(await FS.fileMode(contained)).toBe(0o444)
  })
})

Test('Studio authenticates generated ownership before returning source for a transaction', async () => {
  await withTaoFiles('tao-studio-generated-read-', { 'Project.tao': 'project Garden\n' }, async (_paths, root) => {
    const generated = new StudioGeneratedSources(root)
    const path = await generated.writeView('View1', 'public\nview View1() {}')

    Expect(await generated.readView('View1')).toEqual({ content: await FS.readText(path), path })
    await FS.chmod(path, 0o644)
    await FS.writeText(path, 'public view View1() {}\n')
    await Expect(generated.readView('View1')).rejects.toThrow('missing its ownership header')
  })
})

Test('Studio restores generated source to read-only after a failed rewrite', async () => {
  await withTaoFiles('tao-studio-generated-failure-', { 'Project.tao': 'project Garden\n' }, async (_paths, root) => {
    const generated = new StudioGeneratedSources(root)
    const path = await generated.writeView('View1', 'public\nview View1() {}')

    await Expect(generated.writeView('View1', 'public\nview View1() { render Text("Later") }', async target => {
      Expect(await FS.fileMode(target)).toBe(0o644)
      Errors.throwHostEnvironment('Simulated generated write failure.')
    })).rejects.toThrow('Simulated generated write failure.')
    Expect(await FS.fileMode(path)).toBe(0o444)
  })
})

Test('Studio creates generated views without replacement and removes only generated rollback files', async () => {
  await withTaoFiles('tao-studio-generated-create-', { 'Project.tao': 'project Garden\n' }, async (_paths, root) => {
    const generated = new StudioGeneratedSources(root)
    const path = await generated.createView('View1', 'public\nview View1() {}')

    await Expect(generated.createView('View1', 'public\nview View1() { render Text("Replacement") }'))
      .rejects.toThrow('already exists')
    Expect(await FS.readText(path)).toContain('view View1() {}')

    await generated.removeView('View1')
    Expect(await FS.exists(path)).toBe(false)

    await FS.writeText(path, 'public view View1() {}\n')
    await Expect(generated.removeView('View1')).rejects.toThrow('non-generated')
    Expect(await FS.exists(path)).toBe(true)
  })
})

Test('Studio removes a partial file when creating generated source fails', async () => {
  await withTaoFiles('tao-studio-generated-create-failure-', {
    'Project.tao': 'project Garden\n',
  }, async (_paths, root) => {
    const generated = new StudioGeneratedSources(root)
    const path = FS.resolvePath('@/studio/View1.tao', root)

    await Expect(generated.createView('View1', 'public\nview View1() {}', async target => {
      await FS.writeText(target, 'partial')
      Errors.throwHostEnvironment('Simulated create failure.')
    })).rejects.toThrow('Simulated create failure.')
    Expect(await FS.exists(path)).toBe(false)
  })
})

Test('Studio moves a generated view into an authored package with writable source ownership', async () => {
  await withTaoFiles('tao-studio-generated-move-', {
    '@/studio/View1.tao':
      `${studioGeneratedSourceHeader}\n\npublic view View1() {\n   #studio_rect_006100720074\n   render Text("Art")\n}\n`,
    '@views/Existing.tao': 'public view Existing() { }\n',
    'Project.tao': 'project Garden\n',
  }, async (paths, root) => {
    await FS.chmod(paths['@/studio/View1.tao'], 0o444)
    const generated = new StudioGeneratedSources(root)
    const target = await generated.moveView(
      'View1',
      '@views',
      `${studioGeneratedSourceHeader}\n\npublic view View1() {\n   #studio_rect_006100720074\n   render Placeholder("Moved")\n}\n`,
    )

    Expect(await FS.exists(paths['@/studio/View1.tao'])).toBe(false)
    Expect(target).toBe(FS.resolvePath('@views/View1.tao', root))
    Expect(await FS.fileMode(target)).toBe(0o644)
    Expect(await FS.readText(target)).toBe('public view View1() {\n   render Placeholder("Moved")\n}\n')
  })
})

Test('Studio restores generated ownership and content when preparing a move fails', async () => {
  await withTaoFiles('tao-studio-generated-move-failure-', {
    '@/studio/View1.tao': `${studioGeneratedSourceHeader}\n\npublic view View1() { }\n`,
    '@views/Existing.tao': 'public view Existing() { }\n',
    'Project.tao': 'project Garden\n',
  }, async (paths, root) => {
    const source = paths['@/studio/View1.tao']
    await FS.chmod(source, 0o444)
    const original = await FS.readText(source)
    const generated = new StudioGeneratedSources(root)

    await Expect(generated.moveView('View1', '@views', original, async path => {
      await FS.writeText(path, 'partial authored source')
      Errors.throwHostEnvironment('Simulated move preparation failure.')
    })).rejects.toThrow('Simulated move preparation failure.')
    Expect(await FS.readText(source)).toBe(original)
    Expect(await FS.fileMode(source)).toBe(0o444)
    Expect(await FS.exists(FS.resolvePath('@views/View1.tao', root))).toBe(false)
  })
})

Test('Studio refuses to move source whose ownership header is absent or displaced', async () => {
  await withTaoFiles('tao-studio-generated-move-header-', {
    '@/studio/View1.tao': `${studioGeneratedSourceHeader}\n\npublic view View1() { }\n`,
    '@views/Existing.tao': 'public view Existing() { }\n',
    'Project.tao': 'project Garden\n',
  }, async (paths, root) => {
    const generated = new StudioGeneratedSources(root)
    const displaced = `public view View1() { }\n\n${studioGeneratedSourceHeader}\n\n`

    await Expect(generated.moveView('View1', '@views', displaced)).rejects.toThrow('missing its ownership header')
    Expect(await FS.readText(paths['@/studio/View1.tao'])).toContain('public view View1()')
    Expect(await FS.exists(FS.resolvePath('@views/View1.tao', root))).toBe(false)
  })
})

Test(
  'Studio refuses a generated root symlink that resolves outside the real project before writing or repairing',
  async () => {
    await withTaoFiles('tao-studio-generated-root-symlink-', {
      'Project.tao': 'project Garden\n',
    }, async (_paths, root) => {
      const outside = await mkTestDir('tao-studio-generated-outside-')
      try {
        await FS.writeText(FS.resolvePath('Existing.tao', outside), 'view Existing() { }\n')
        await FS.symlink(outside, FS.resolvePath('@/studio', root))
        const generated = new StudioGeneratedSources(root)

        await Expect(generated.repair()).rejects.toThrow('Generated Studio root resolves outside the project')
        await Expect(generated.writeView('View1', 'public view View1() { }')).rejects.toThrow(
          'Generated Studio root resolves outside the project',
        )
        Expect(await FS.exists(FS.resolvePath('View1.tao', outside))).toBe(false)
        Expect(await FS.fileMode(FS.resolvePath('Existing.tao', outside))).toBe(0o644)
      } finally {
        await FS.remove(outside)
      }
    })
  },
)

Test('Studio refuses an authored-package symlink that resolves outside the real project before moving', async () => {
  await withTaoFiles('tao-studio-generated-target-symlink-', {
    '@/studio/View1.tao': `${studioGeneratedSourceHeader}\n\npublic view View1() { }\n`,
    'Project.tao': 'project Garden\n',
  }, async (paths, root) => {
    const outside = await mkTestDir('tao-studio-authored-outside-')
    try {
      await FS.symlink(outside, FS.resolvePath('@views', root))
      const generated = new StudioGeneratedSources(root)

      await Expect(generated.moveView(
        'View1',
        '@views',
        `${studioGeneratedSourceHeader}\n\npublic view View1() { }\n`,
      )).rejects.toThrow('Target Tao package resolves outside the project')
      Expect(await FS.exists(paths['@/studio/View1.tao'])).toBe(true)
      Expect(await FS.exists(FS.resolvePath('View1.tao', outside))).toBe(false)
    } finally {
      await FS.remove(outside)
    }
  })
})

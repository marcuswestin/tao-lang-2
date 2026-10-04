import { CLI, FS, ProjectLocal } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, mkTestDir, Test } from '@shared/test'

Describe('project local state', () => {
  Test('resolves committed, durable, and regenerable paths separately', async () => {
    const project = await mkTestDir('tao-project-layout-')
    try {
      Expect(ProjectLocal.storeResolve('lock.jsonc', project)).toBe(FS.resolvePath('.tao/store/lock.jsonc', project))
      Expect(ProjectLocal.localResolve('studio/session.json', project))
        .toBe(FS.resolvePath('.tao/local/studio/session.json', project))
      Expect(ProjectLocal.cacheResolve('studio/tmp', project)).toBe(FS.resolvePath('.tao/cache/studio/tmp', project))
      Expect(ProjectLocal.stagingPath(ProjectLocal.storeResolve('lock.jsonc', project), project))
        .toContain(FS.resolvePath('.tao/cache/tmp/lock.jsonc.', project))
      await ProjectLocal.prepare(project)
      Expect(await FS.listDir(FS.resolvePath('.tao', project))).toEqual(['.gitignore', 'cache', 'local', 'store'])
      Expect(await FS.exists(FS.resolvePath('.gitignore', project))).toBe(false)
    } finally {
      await FS.remove(project)
    }
  })

  Test('moves recognized old state once and keeps unknown or conflicting entries', async () => {
    const project = await mkTestDir('tao-project-migration-')
    const inProject = (relative: string) => FS.resolvePath(relative, project)
    try {
      await FS.writeText(inProject('.tao/sessions/owner.json'), 'old owner')
      await FS.writeText(inProject('.tao/builds/build-1/build.json'), 'old build')
      await FS.writeText(inProject('.tao/builds/existing.json'), 'legacy conflict')
      await FS.writeText(inProject('.tao/dev/data/Notes-1a2b3c4d/settings.json'), 'old data')
      await FS.writeText(inProject('.tao/dev/runtime/main.js'), 'old runtime')
      await FS.writeText(inProject('.tao/dev/unknown.txt'), 'unknown dev')
      await FS.writeText(inProject('.tao/bridge-check.tsconfig.json'), '{}')
      await FS.writeText(inProject('.tao/browser-acceptance/run.json'), '{}')
      await FS.writeText(inProject('.tao/store/sessions/existing.json'), 'WIP session')
      await FS.writeText(inProject('.tao/store/builds/conflict.json'), 'WIP build')
      await FS.writeText(inProject('.tao/local/builds/existing.json'), 'current build')
      await FS.writeText(inProject('target.json'), 'link target')
      await FS.symlink(inProject('target.json'), inProject('.tao/builds/legacy-link'))
      await FS.writeText(
        inProject('.tao-project/lock.jsonc'),
        '{ "schemaVersion": 1, // pinned\n "toolchainVersion": "1" }',
      )
      await FS.writeText(inProject('.tao-project/skills.version'), '1.0.0\n')
      await FS.writeText(inProject('.tao-project/studio/sketches.jsonc'), '{}')
      await FS.writeText(inProject('.tao-project/unrecognized.txt'), 'leave me')
      await FS.writeText(inProject('secrets/secrets.jsonc'), '{ "encrypted": true }')

      await Promise.all([ProjectLocal.prepare(project), ProjectLocal.prepare(project)])
      await ProjectLocal.prepare(project)

      Expect(await FS.readText(inProject('.tao/.gitignore'))).toBe('local/\ncache/\n')
      Expect(await FS.readText(inProject('.tao/local/sessions/owner.json'))).toBe('old owner')
      Expect(await FS.readText(inProject('.tao/local/sessions/existing.json'))).toBe('WIP session')
      Expect(await FS.readText(inProject('.tao/local/builds/existing.json'))).toBe('current build')
      Expect(await FS.readText(inProject('.tao/builds/existing.json'))).toBe('legacy conflict')
      Expect(await FS.readText(inProject('.tao/local/builds/build-1/build.json'))).toBe('old build')
      Expect(await FS.readText(inProject('.tao/local/builds/conflict.json'))).toBe('WIP build')
      Expect(await FS.isSymbolicLink(inProject('.tao/builds/legacy-link'))).toBe(true)
      Expect(await FS.readText(inProject('.tao/local/dev-data/Notes/settings.json'))).toBe('old data')
      Expect(await FS.readText(inProject('.tao/cache/dev/runtime/main.js'))).toBe('old runtime')
      Expect(await FS.readText(inProject('.tao/dev/unknown.txt'))).toBe('unknown dev')
      Expect(await FS.isFile(inProject('.tao/cache/bridge-check/tsconfig.json'))).toBe(true)
      Expect(await FS.isFile(inProject('.tao/cache/browser-acceptance/run.json'))).toBe(true)
      Expect(await FS.isFile(inProject('.tao/store/studio/sketches.jsonc'))).toBe(true)
      Expect(await FS.readText(inProject('.tao/store/secrets.jsonc'))).toBe('{ "encrypted": true }')
      Expect(await FS.readJson<{ skillsVersion: string }>(inProject('.tao/store/lock.jsonc')))
        .toMatchObject({ schemaVersion: 1, toolchainVersion: '1', skillsVersion: '1.0.0' })
      Expect(await FS.isFile(inProject('.tao-project/skills.version'))).toBe(false)
      Expect(await FS.readText(inProject('.tao-project/unrecognized.txt'))).toBe('leave me')
      Expect(await FS.listDir(inProject('.tao/cache/locks'))).toEqual([])
    } finally {
      await FS.remove(project)
    }
  })

  Test('moves both desktop host cache layouts without replacing conflicts', async () => {
    const project = await mkTestDir('tao-desktop-layout-')
    const path = (relative: string) => FS.resolvePath(relative, project)
    try {
      await FS.writeText(path('.tao/dev/desktop/legacy.txt'), 'legacy')
      await FS.writeText(path('.tao/cache/dev/desktop/current.txt'), 'current')
      await FS.writeText(path('.tao/cache/dev/desktop/conflict.txt'), 'source conflict')
      await FS.writeText(path('.tao/cache/dev/desktop-host/conflict.txt'), 'destination conflict')
      await ProjectLocal.prepare(project)
      Expect(await FS.readText(path('.tao/cache/dev/desktop-host/legacy.txt'))).toBe('legacy')
      Expect(await FS.readText(path('.tao/cache/dev/desktop-host/current.txt'))).toBe('current')
      Expect(await FS.readText(path('.tao/cache/dev/desktop-host/conflict.txt'))).toBe('destination conflict')
      Expect(await FS.readText(path('.tao/cache/dev/desktop/conflict.txt'))).toBe('source conflict')
      await ProjectLocal.prepare(project)
      Expect(await FS.readText(path('.tao/cache/dev/desktop-host/legacy.txt'))).toBe('legacy')
    } finally {
      await FS.remove(project)
    }
  })

  Test(
    'moves main-era project identity, generated tooling, and install state without replacing conflicts',
    async () => {
      const project = await mkTestDir('tao-project-main-layout-')
      const path = (relative: string) => FS.resolvePath(relative, project)
      try {
        await FS.writeText(path('.tao/project.json'), '{"id":"old-project"}\n')
        await FS.writeText(path('.tao/lock.jsonc'), '{"schemaVersion":1,"toolchainVersion":"old"}\n')
        await FS.writeText(path('.tao/store/lock.jsonc'), '{"schemaVersion":1,"skillsVersion":"current"}\n')
        await FS.writeText(path('.tao/typescript/tsconfig.json'), 'old generated config')
        await FS.writeText(path('.tao/typescript/outputs.json'), 'old generated manifest')
        await FS.writeText(path('.tao/cache/typescript/tsconfig.json'), 'current generated config')
        await FS.writeText(path('.tao/install/origins/one/node_modules/pkg/index.js'), 'installed')
        await FS.writeText(path('tsconfig.json'), '{ "extends": "./.tao/typescript/tsconfig.json" }\n')

        await ProjectLocal.prepare(project)
        await ProjectLocal.prepare(project)

        Expect(await FS.readText(path('.tao/store/project.json'))).toBe('{"id":"old-project"}\n')
        Expect(await FS.readText(path('.tao/store/lock.jsonc')))
          .toBe('{"schemaVersion":1,"skillsVersion":"current"}\n')
        Expect(await FS.readText(path('.tao/lock.jsonc')))
          .toBe('{"schemaVersion":1,"toolchainVersion":"old"}\n')
        Expect(await FS.readText(path('.tao/cache/typescript/tsconfig.json'))).toBe('current generated config')
        Expect(await FS.readText(path('.tao/typescript/tsconfig.json'))).toBe('old generated config')
        Expect(await FS.readText(path('.tao/cache/typescript/outputs.json'))).toBe('old generated manifest')
        Expect(await FS.readText(path('.tao/cache/install/origins/one/node_modules/pkg/index.js'))).toBe('installed')
        Expect(await FS.readText(path('tsconfig.json')))
          .toBe('{ "extends": "./.tao/cache/typescript/tsconfig.json" }\n')
      } finally {
        await FS.remove(project)
      }
    },
  )

  Test('replaces whitespace-only main-era marker placeholders after preparing the new layout', async () => {
    const root = await mkTestDir('tao-project-placeholder-')
    try {
      const empty = FS.resolvePath('Empty', root)
      const newline = FS.resolvePath('Newline', root)
      const authored = FS.resolvePath('Authored', root)
      const linked = FS.resolvePath('Linked', root)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', empty), '')
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', newline), '\n')
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', authored), 'keep this content')
      await FS.writeText(FS.resolvePath('placeholder-target', linked), '\n')
      await FS.symlink(FS.resolvePath('placeholder-target', linked), FS.resolvePath('.tao/.gitkeep', linked))
      await Promise.all([
        ProjectLocal.prepare(empty),
        ProjectLocal.prepare(newline),
        ProjectLocal.prepare(authored),
        ProjectLocal.prepare(linked),
      ])
      Expect(await FS.exists(FS.resolvePath('.tao/.gitkeep', empty))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('.tao/.gitkeep', newline))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('.tao/.gitignore', empty))).toBe('local/\ncache/\n')
      Expect(await FS.isDirectory(FS.resolvePath('.tao/store', empty))).toBe(true)
      Expect(await FS.readText(FS.resolvePath('.tao/.gitkeep', authored))).toBe('keep this content')
      Expect(await FS.isSymbolicLink(FS.resolvePath('.tao/.gitkeep', linked))).toBe(true)
      Expect(await FS.readText(FS.resolvePath('placeholder-target', linked))).toBe('\n')
      await ProjectLocal.prepare(empty)
      Expect((await FS.listDir(FS.resolvePath('.tao', empty))).toSorted()).toEqual([
        '.gitignore',
        'cache',
        'local',
        'store',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('folds a lone skills version and moves WIP cache entries', async () => {
    const project = await mkTestDir('tao-project-wip-migration-')
    const inProject = (relative: string) => FS.resolvePath(relative, project)
    try {
      await FS.writeText(inProject('.tao-project/skills.version'), '1.0.0\n')
      await FS.writeText(inProject('.tao/cache/bridge-check.tsconfig.json'), '{ "files": [] }')
      await FS.writeText(inProject('.tao/cache/dev/logs/expo.log'), 'old log')

      await ProjectLocal.prepare(project)

      Expect(await FS.readJson(inProject('.tao/store/lock.jsonc')))
        .toEqual({ schemaVersion: 1, skillsVersion: '1.0.0' })
      Expect(await FS.readText(inProject('.tao/cache/bridge-check/tsconfig.json'))).toBe('{ "files": [] }')
      Expect(await FS.readText(inProject('.tao/cache/logs/expo.log'))).toBe('old log')
      Expect(await FS.isFile(inProject('.tao-project/skills.version'))).toBe(false)
    } finally {
      await FS.remove(project)
    }
  })

  Test('removes the old root ignore rule so committed store is visible to Git', async () => {
    const project = await mkGitTestDir('tao-project-ignore-migration-')
    try {
      await initGitTestRepository(project)
      const inProject = (relative: string) => FS.resolvePath(relative, project)
      const oldIgnore = '*.tao.ts\n# custom rule\nlocal-only/\n.tao/\nnode_modules/\n'
      await FS.writeText(inProject('.gitignore'), oldIgnore)
      await FS.writeText(inProject('.tao-project/lock.jsonc'), '{ "schemaVersion": 1 }\n')

      await ProjectLocal.prepare(project)

      Expect(await FS.readText(inProject('.gitignore')))
        .toBe('*.tao.ts\n# custom rule\nlocal-only/\nnode_modules/\n')
      const ignored = async (path: string) =>
        (await CLI.run('git', { args: ['-C', project, 'check-ignore', '-q', path], stdio: 'pipe' })).exitCode
      Expect(await ignored('.tao/store/lock.jsonc')).toBe(1)
      Expect(await ignored('.tao/local/session.json')).toBe(0)
      Expect(await ignored('.tao/cache/runtime.js')).toBe(0)
      Expect(await ignored('local-only/data.json')).toBe(0)
      Expect(await ignored('Generated.tao.ts')).toBe(0)
    } finally {
      await FS.remove(project)
    }
  })

  Test('migrates CRLF blanket ignores without hiding the store or exposing retained private files', async () => {
    const project = await mkGitTestDir('tao-project-crlf-ignore-migration-')
    const inProject = (relative: string) => FS.resolvePath(relative, project)
    try {
      await initGitTestRepository(project)
      await FS.writeText(inProject('.gitignore'), '# custom\r\n.tao/\r\nnode_modules/\r\n')
      await FS.writeText(inProject('.tao/.gitignore'), '*\r\n')
      await FS.writeText(inProject('.tao/unknown-private.json'), '{}')
      await FS.writeText(inProject('.tao-project/lock.jsonc'), '{ "schemaVersion": 1 }\n')

      await ProjectLocal.prepare(project)

      const rewritten = await FS.readText(inProject('.gitignore'))
      Expect(rewritten.slice(0, '# custom\r\nnode_modules/\r\n'.length)).toBe('# custom\r\nnode_modules/\r\n')
      const ignored = async (path: string) =>
        (await CLI.run('git', { args: ['-C', project, 'check-ignore', '-q', path], stdio: 'pipe' })).exitCode
      Expect(await ignored('.tao/store/lock.jsonc')).toBe(1)
      Expect(await ignored('.tao/unknown-private.json')).toBe(0)
      Expect(await ignored('.tao/local/session.json')).toBe(0)
      Expect(await ignored('.tao/cache/runtime.js')).toBe(0)
    } finally {
      await FS.remove(project)
    }
  })

  Test('refuses custom nested ignore rules before moving legacy state or exposing private files', async () => {
    const project = await mkGitTestDir('tao-project-custom-nested-ignore-')
    const inProject = (relative: string) => FS.resolvePath(relative, project)
    const rootIgnore = '# root rule\nlocal-only/\n'
    const nestedIgnore = '# private store data\nlocal/\ncache/\nstore/private/\n'
    try {
      await initGitTestRepository(project)
      await FS.writeText(inProject('.gitignore'), rootIgnore)
      await FS.writeText(inProject('.tao/.gitignore'), nestedIgnore)
      await FS.writeText(inProject('.tao/store/private/secret.json'), 'private')
      await FS.writeText(inProject('.tao/store/public.json'), 'shared')
      await FS.writeText(inProject('.tao/sessions/legacy.json'), 'legacy session')
      await FS.writeText(inProject('.tao-project/lock.jsonc'), '{ "schemaVersion": 1 }\n')

      await Expect(ProjectLocal.prepare(project)).rejects.toThrow('Move custom rules to the project root .gitignore')

      Expect(await FS.readText(inProject('.gitignore'))).toBe(rootIgnore)
      Expect(await FS.readText(inProject('.tao/.gitignore'))).toBe(nestedIgnore)
      Expect(await FS.readText(inProject('.tao/sessions/legacy.json'))).toBe('legacy session')
      Expect(await FS.exists(inProject('.tao/local/sessions/legacy.json'))).toBe(false)
      Expect(await FS.readText(inProject('.tao-project/lock.jsonc'))).toBe('{ "schemaVersion": 1 }\n')
      Expect(await FS.exists(inProject('.tao/store/lock.jsonc'))).toBe(false)
      const ignored = async (path: string) =>
        (await CLI.run('git', { args: ['-C', project, 'check-ignore', '-q', path], stdio: 'pipe' })).exitCode
      Expect(await ignored('.tao/store/private/secret.json')).toBe(0)
      Expect(await ignored('.tao/store/public.json')).toBe(1)
    } finally {
      await FS.remove(project)
    }
  })

  Test('accepts comments and blank lines around recognized nested ignore rules', async () => {
    const project = await mkTestDir('tao-project-commented-ignore-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitignore', project), '# prior layout\n\n*\nlocal/\ncache/\n')
      await FS.writeText(FS.resolvePath('.tao/sessions/legacy.json', project), 'legacy session')
      await ProjectLocal.prepare(project)
      Expect(await FS.readText(FS.resolvePath('.tao/.gitignore', project))).toBe('local/\ncache/\n')
      Expect(await FS.readText(FS.resolvePath('.tao/local/sessions/legacy.json', project))).toBe('legacy session')
    } finally {
      await FS.remove(project)
    }
  })

  Test('keeps retained legacy entries ignored while exposing committed store files', async () => {
    const project = await mkGitTestDir('tao-project-retained-legacy-')
    try {
      await initGitTestRepository(project)
      const inProject = (relative: string) => FS.resolvePath(relative, project)
      await FS.writeText(inProject('.gitignore'), '# custom\n.tao/\nother-local/\n')
      await FS.writeText(inProject('.tao/.gitignore'), '*\n')
      await FS.writeText(inProject('.tao/unknown[1].txt'), 'unknown private')
      await FS.writeText(inProject('.tao/sessions/conflict.json'), 'older private')
      await FS.writeText(inProject('.tao/local/sessions/conflict.json'), 'newer private')
      await FS.writeText(inProject('.tao/store/sessions/wip-private.json'), 'WIP private')
      await FS.writeText(inProject('.tao/local/sessions/wip-private.json'), 'current private')
      await FS.writeText(inProject('.tao/store/studio/unknown.tmp'), 'temporary')
      await FS.writeText(inProject('.tao-project/lock.jsonc'), '{ "schemaVersion": 1 }\n')
      await FS.writeText(inProject('.tao-project/studio/sketches.jsonc'), '{}\n')

      await ProjectLocal.prepare(project)
      const rewritten = await FS.readText(inProject('.gitignore'))
      await FS.writeText(inProject('.tao/store/adapter/data.json'), 'new shared data')
      await ProjectLocal.prepare(project)

      Expect(await FS.readText(inProject('.gitignore'))).toBe(rewritten)
      Expect(rewritten).toContain('# custom\nother-local/\n')
      Expect(rewritten).not.toContain('\n.tao/\n')
      Expect(await FS.readText(inProject('.tao/.gitignore'))).toBe('local/\ncache/\n')
      Expect(await FS.readText(inProject('.tao/sessions/conflict.json'))).toBe('older private')
      Expect(await FS.readText(inProject('.tao/store/sessions/wip-private.json'))).toBe('WIP private')
      const ignored = async (path: string) =>
        (await CLI.run('git', { args: ['-C', project, 'check-ignore', '-q', path], stdio: 'pipe' })).exitCode
      Expect(await ignored('.tao/store/lock.jsonc')).toBe(1)
      Expect(await ignored('.tao/store/studio/sketches.jsonc')).toBe(1)
      Expect(await ignored('.tao/.gitignore')).toBe(1)
      Expect(await ignored('.tao/unknown[1].txt')).toBe(0)
      Expect(await ignored('.tao/sessions/conflict.json')).toBe(0)
      Expect(await ignored('.tao/store/sessions/wip-private.json')).toBe(0)
      Expect(await ignored('.tao/store/studio/unknown.tmp')).toBe(0)
      Expect(await ignored('.tao/store/adapter/data.json')).toBe(1)
      Expect(await ignored('.tao/local/sessions/conflict.json')).toBe(0)
      Expect(await ignored('.tao/cache/locks/unused')).toBe(0)
      Expect(await ignored('other-local/data')).toBe(0)
    } finally {
      await FS.remove(project)
    }
  })

  Test('refuses linked ignore files without changing their targets', async () => {
    for (const relative of ['.gitignore', '.tao/.gitignore']) {
      const project = await mkTestDir('tao-project-linked-ignore-')
      const target = FS.resolvePath('user-ignore.txt', project)
      const link = FS.resolvePath(relative, project)
      try {
        await FS.writeText(target, 'user owned rules\n')
        await FS.mkdir(FS.dirname(link))
        await FS.symlink(target, link)
        await Expect(ProjectLocal.prepare(project)).rejects.toThrow('Cannot migrate the project ignore file')
        Expect(await FS.isSymbolicLink(link)).toBe(true)
        Expect(await FS.readText(target)).toBe('user owned rules\n')
      } finally {
        await FS.remove(project)
      }
    }
  })

  Test('leaves a linked legacy skills version untouched', async () => {
    const project = await mkTestDir('tao-project-linked-skills-')
    const target = FS.resolvePath('user-version.txt', project)
    const link = FS.resolvePath('.tao-project/skills.version', project)
    try {
      await FS.writeText(target, 'user owned version\n')
      await FS.mkdir(FS.dirname(link))
      await FS.symlink(target, link)
      await ProjectLocal.prepare(project)
      Expect(await FS.isSymbolicLink(link)).toBe(true)
      Expect(await FS.exists(ProjectLocal.storeResolve('lock.jsonc', project))).toBe(false)
      Expect(await FS.readText(target)).toBe('user owned version\n')
    } finally {
      await FS.remove(project)
    }
  })

  Test('creates root ignore rules when only the older nested ignore hid unknown state', async () => {
    const project = await mkGitTestDir('tao-project-nested-ignore-migration-')
    try {
      await initGitTestRepository(project)
      const inProject = (relative: string) => FS.resolvePath(relative, project)
      await FS.writeText(inProject('.tao/.gitignore'), '*\n')
      await FS.writeText(inProject('.tao/unknown.txt'), 'private')
      await FS.writeText(inProject('.tao-project/lock.jsonc'), '{ "schemaVersion": 1 }\n')

      await ProjectLocal.prepare(project)

      const ignored = async (path: string) =>
        (await CLI.run('git', { args: ['-C', project, 'check-ignore', '-q', path], stdio: 'pipe' })).exitCode
      Expect(await ignored('.tao/unknown.txt')).toBe(0)
      Expect(await ignored('.tao/store/lock.jsonc')).toBe(1)
      Expect(await ignored('.tao/.gitignore')).toBe(1)
      Expect(await FS.readText(inProject('.tao/unknown.txt'))).toBe('private')
    } finally {
      await FS.remove(project)
    }
  })

  Test('leaves existing custom store files visible without an older blanket', async () => {
    const project = await mkGitTestDir('tao-project-visible-store-')
    try {
      await initGitTestRepository(project)
      const inProject = (relative: string) => FS.resolvePath(relative, project)
      await FS.writeText(inProject('.gitignore'), '# custom\n')
      await FS.writeText(inProject('.tao/.gitignore'), 'local/\ncache/\n')
      await FS.writeText(inProject('.tao/store/custom.json'), 'shared')

      await ProjectLocal.prepare(project)

      Expect(await FS.readText(inProject('.gitignore'))).toBe('# custom\n')
      const result = await CLI.run('git', {
        args: ['-C', project, 'check-ignore', '-q', '.tao/store/custom.json'],
        stdio: 'pipe',
      })
      Expect(result.exitCode).toBe(1)
    } finally {
      await FS.remove(project)
    }
  })

  Test('leaves linked legacy source parents and their external contents untouched', async () => {
    const project = await mkTestDir('tao-project-linked-sources-')
    const external = await mkTestDir('tao-project-linked-targets-')
    const inProject = (relative: string) => FS.resolvePath(relative, project)
    const outside = (relative: string) => FS.resolvePath(relative, external)
    try {
      await FS.writeText(outside('project/lock.jsonc'), '{ "schemaVersion": 1 }')
      await FS.writeText(outside('project/skills.version'), '1.0.0\n')
      await FS.writeText(outside('project/studio/sketches.jsonc'), '{ "sketch": true }')
      await FS.writeText(outside('secrets/secrets.jsonc'), '{ "secret": true }')
      await FS.writeText(outside('data/Notes-1a2b3c4d/settings.json'), '{ "note": true }')
      await FS.symlink(outside('project'), inProject('.tao-project'))
      await FS.symlink(outside('secrets'), inProject('secrets'))
      await FS.symlink(outside('data'), inProject('.tao/dev/data'))

      await ProjectLocal.prepare(project)

      Expect(await FS.readText(outside('project/lock.jsonc'))).toBe('{ "schemaVersion": 1 }')
      Expect(await FS.readText(outside('project/skills.version'))).toBe('1.0.0\n')
      Expect(await FS.readText(outside('project/studio/sketches.jsonc'))).toBe('{ "sketch": true }')
      Expect(await FS.readText(outside('secrets/secrets.jsonc'))).toBe('{ "secret": true }')
      Expect(await FS.readText(outside('data/Notes-1a2b3c4d/settings.json'))).toBe('{ "note": true }')
      Expect(await FS.isFile(inProject('.tao/store/lock.jsonc'))).toBe(false)
      Expect(await FS.isFile(inProject('.tao/store/secrets.jsonc'))).toBe(false)
      Expect(await FS.isFile(inProject('.tao/local/dev-data/Notes/settings.json'))).toBe(false)
      Expect(await FS.isSymbolicLink(inProject('.tao-project'))).toBe(true)
      Expect(await FS.isSymbolicLink(inProject('secrets'))).toBe(true)
      Expect(await FS.isSymbolicLink(inProject('.tao/dev/data'))).toBe(true)
    } finally {
      await FS.remove(project)
      await FS.remove(external)
    }
  })

  Test('leaves linked destination parents and external files untouched', async () => {
    const project = await mkTestDir('tao-project-linked-destinations-')
    const external = await mkTestDir('tao-project-destination-targets-')
    const inProject = (relative: string) => FS.resolvePath(relative, project)
    const outside = (relative: string) => FS.resolvePath(relative, external)
    try {
      await FS.writeText(inProject('.tao/sessions/old.json'), 'old session')
      await FS.writeText(inProject('.tao/bridge-check.tsconfig.json'), 'old bridge')
      await FS.writeText(inProject('.tao-project/studio/sketches.jsonc'), 'old sketches')
      await FS.writeText(inProject('.tao-project/skills.version'), '1.0.0\n')
      await FS.writeText(outside('sessions/current.json'), 'current session')
      await FS.writeText(outside('bridge/tsconfig.json'), 'current bridge')
      await FS.writeText(outside('studio/sketches.jsonc'), 'current sketches')
      await FS.writeText(outside('lock.jsonc'), '{ "schemaVersion": 1 }')
      await FS.symlink(outside('sessions'), inProject('.tao/local/sessions'))
      await FS.symlink(outside('bridge'), inProject('.tao/cache/bridge-check'))
      await FS.symlink(outside('studio'), inProject('.tao/store/studio'))
      await FS.symlink(outside('lock.jsonc'), inProject('.tao/store/lock.jsonc'))

      await ProjectLocal.prepare(project)

      Expect(await FS.readText(inProject('.tao/sessions/old.json'))).toBe('old session')
      Expect(await FS.readText(inProject('.tao/bridge-check.tsconfig.json'))).toBe('old bridge')
      Expect(await FS.readText(inProject('.tao-project/studio/sketches.jsonc'))).toBe('old sketches')
      Expect(await FS.readText(inProject('.tao-project/skills.version'))).toBe('1.0.0\n')
      Expect(await FS.readText(outside('sessions/current.json'))).toBe('current session')
      Expect(await FS.readText(outside('bridge/tsconfig.json'))).toBe('current bridge')
      Expect(await FS.readText(outside('studio/sketches.jsonc'))).toBe('current sketches')
      Expect(await FS.readText(outside('lock.jsonc'))).toBe('{ "schemaVersion": 1 }')
    } finally {
      await FS.remove(project)
      await FS.remove(external)
    }
  })
})

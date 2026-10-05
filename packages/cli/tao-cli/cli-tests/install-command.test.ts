import { BridgeMetadata } from '@compiler/bridge-metadata'
import { Errors, FS, Time } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test } from '@shared/test'
import { runTaoInstall } from '../cli-src/install-command'
import { ManagedInstallEnvironment } from '../cli-src/managed-install-environment'
import { readProjectLock } from '../cli-src/ship-lock'

Describe('tao install', () => {
  Test('records a selected local publication and its aliased module origin', async () => {
    const directory = await mkTestDir('tao-install-local-')
    const consumer = FS.resolvePath('consumer', directory)
    const library = FS.resolvePath('library', directory)
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', consumer), '')
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', library), '')
      await FS.writeText(FS.resolvePath('Package.tao', library), 'package { version 1.2.0 license MIT includes @ui }\n')
      await FS.writeText(
        FS.resolvePath('@ui/Card.tao', library),
        'public view Card() { render inject ```ts return null ``` }\n',
      )
      await FS.writeText(
        FS.resolvePath('App.tao', consumer),
        `
app Consumer {
   id "consumer"
   version "1.0.0"
   name "Consumer"
   requires ../library version ^1.0.0 { @ui as @cards }
   view Main
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
      )

      await runTaoInstall(consumer, { appName: 'Consumer' })

      const lock = await readProjectLock(consumer)
      Expect(lock.installs?.local).toEqual({
        '.->../library#': {
          sourceRoot: '.',
          root: '../library',
          version: '1.2.0',
          bindings: { '@cards': '@ui' },
        },
      })
      Expect(Object.values(lock.installs?.environments ?? {}).map(environment => environment.npm)).toEqual([{}, {}])
    } finally {
      await FS.remove(directory)
    }
  })

  Test('records transitive publications with their physical source roots', async () => {
    const directory = await mkTestDir('tao-install-transitive-')
    const consumer = FS.resolvePath('consumer', directory)
    const library = FS.resolvePath('library', directory)
    const foundation = FS.resolvePath('foundation', directory)
    try {
      for (const root of [consumer, library, foundation]) {
        await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      }
      await FS.writeText(
        FS.resolvePath('Package.tao', foundation),
        'package { version 3.2.0 license MIT includes @core }\n',
      )
      await FS.writeText(
        FS.resolvePath('@core/Core.tao', foundation),
        'public view Core() { render inject ```ts return null ``` }\n',
      )
      await FS.writeText(
        FS.resolvePath('Package.tao', library),
        'package { version 2.1.0 license MIT includes @ui requires ../foundation version ^3.0.0 { @core as @foundation } }\n',
      )
      await FS.writeText(
        FS.resolvePath('@ui/Card.tao', library),
        'public view Card() { render inject ```ts return null ``` }\n',
      )
      await FS.writeText(
        FS.resolvePath('App.tao', consumer),
        `app Consumer {
   id "consumer"
   version "1.0.0"
   name "Consumer"
   requires ../library version ^2.0.0 { @ui as @cards }
   view Main
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
      )

      await runTaoInstall(consumer, { appName: 'Consumer' })

      const lock = await readProjectLock(consumer)
      Expect(lock.installs?.local['.->../library#']?.version).toBe('2.1.0')
      Expect(lock.installs?.local['../library->../foundation#']).toEqual({
        sourceRoot: '../library',
        root: '../foundation',
        version: '3.2.0',
        bindings: { '@foundation': '@core' },
      })
      Expect(Object.values(lock.installs?.environments ?? {}).map(entry => entry.projectRoot).toSorted())
        .toEqual(['.', '../foundation', '../library'].toSorted())
    } finally {
      await FS.remove(directory)
    }
  })

  Test('isolates one npm alias at different exact versions in separate dependency origins', async () => {
    const directory = await mkTestDir('tao-install-private-')
    const consumer = FS.resolvePath('consumer', directory)
    const older = FS.resolvePath('older', directory)
    const newer = FS.resolvePath('newer', directory)
    try {
      for (const root of [consumer, older, newer]) {
        await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
        await FS.writeText(
          FS.resolvePath('@ui/View.tao', root),
          'public view View() { render inject ```ts return null ``` }\n',
        )
      }
      await FS.writeText(
        FS.resolvePath('Package.tao', older),
        'package { version 1.0.0 license MIT includes @ui requires ts npm:date-fns version 3.6.0 as util }\n',
      )
      await FS.writeText(
        FS.resolvePath('Package.tao', newer),
        'package { version 1.0.0 license MIT includes @ui requires ts npm:date-fns version 4.1.0 as util }\n',
      )
      await FS.writeText(
        FS.resolvePath('App.tao', consumer),
        `app Consumer {
   id "consumer"
   version "1.0.0"
   name "Consumer"
   requires ../older version ^1.0.0 { @ui as @older }
   requires ../newer version ^1.0.0 { @ui as @newer }
   view Main
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
      )
      const installed: string[] = []
      const terminal = fakeTerminal()
      await runTaoInstall(consumer, { appName: 'Consumer', output: terminal.output }, {
        installNpm: async (path, _root, args) => {
          Expect(args).toEqual(['install', '--prefix', path, '--no-audit', '--no-fund', '--legacy-peer-deps'])
          const manifest = await FS.readJson<{ dependencies: Record<string, string> }>(
            FS.resolvePath('package.json', path),
          )
          const specifier = manifest.dependencies['util']!
          const version = specifier.slice(specifier.lastIndexOf('@') + 1)
          // The package announcement must arrive before the potentially slow installer runs.
          Expect(terminal.outputText()).toContain(`Checking/installing npm package date-fns@${version} as util...\n`)
          Expect(terminal.outputText()).not.toContain('Installed dependencies for ')
          installed.push(version)
          await FS.writeJson(FS.resolvePath('node_modules/util/package.json', path), { name: 'date-fns', version })
        },
      })

      Expect(installed.toSorted()).toEqual(['3.6.0', '4.1.0'])
      const output = terminal.outputText()
      Expect(output).toContain('Discovering Tao source files...\n')
      Expect(output).toContain('Resolving app and package dependencies...\n')
      Expect(output).toContain('Linking npm alias util...\n')
      Expect(output.indexOf('Saving dependency lock...')).toBeGreaterThan(
        output.lastIndexOf('Linking npm alias util'),
      )
      Expect(output.indexOf('Installed dependencies for ')).toBeGreaterThan(output.indexOf('Saving dependency lock...'))
      const lock = await readProjectLock(consumer)
      for (const [origin, version] of [[older, '3.6.0'], [newer, '4.1.0']] as const) {
        const namespace = BridgeMetadata.dependencyNamespace(origin)
        const environment = lock.installs?.environments[FS.relativePath(consumer, origin)]
        Expect(environment?.npm['util']).toEqual({ name: 'date-fns', requested: version, version })
        const modulesRoot = ManagedInstallEnvironment.modulesRoot(consumer, origin, namespace)
        Expect(await FS.realPath(FS.resolvePath('util', modulesRoot))).toBe(
          ManagedInstallEnvironment.environmentRoot(consumer, namespace) + '/node_modules/util',
        )
        Expect(await FS.realPath(ManagedInstallEnvironment.generatedModulesLink(consumer, namespace)))
          .toBe(modulesRoot)
      }
      Expect(await FS.exists(FS.resolvePath('node_modules/util', consumer))).toBe(false)
    } finally {
      await FS.remove(directory)
    }
  })

  Test('keys environments by project root and reuses a pin recorded under another checkout’s namespace', async () => {
    const root = await mkTestDir('tao-install-portable-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      await FS.writeText(
        FS.resolvePath('App.tao', root),
        `app Reader {
   id "reader"
   version "1.0.0"
   name "Reader"
   requires ts npm:date-fns version ^4.0.0 as util
   view Main
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
      )
      const pinned = { name: 'date-fns', requested: '^4.0.0', version: '4.1.0' }
      await FS.writeJson(FS.resolvePath('.tao/store/lock.jsonc', root), {
        schemaVersion: 1,
        installs: {
          lockfileVersion: 2,
          local: {},
          environments: {
            'namespace-from-another-checkout': { projectRoot: '.', publications: [], npm: { util: pinned } },
          },
        },
      })
      const specifiers: string[] = []

      await runTaoInstall(root, { appName: 'Reader' }, {
        installNpm: async path => {
          const manifest = await FS.readJson<{ dependencies: Record<string, string> }>(
            FS.resolvePath('package.json', path),
          )
          specifiers.push(manifest.dependencies['util']!)
          await FS.writeJson(FS.resolvePath('node_modules/util/package.json', path), {
            name: 'date-fns',
            version: '4.1.0',
          })
        },
      })

      Expect(specifiers).toEqual(['npm:date-fns@4.1.0'])
      Expect((await readProjectLock(root)).installs?.environments).toEqual({
        '.': { projectRoot: '.', publications: [], npm: { util: pinned } },
      })
    } finally {
      await FS.remove(root)
    }
  })

  Test('scoped app installs preserve another app’s selected publication', async () => {
    const directory = await mkTestDir('tao-install-scoped-')
    const consumer = FS.resolvePath('consumer', directory)
    const first = FS.resolvePath('first', directory)
    const second = FS.resolvePath('second', directory)
    try {
      for (const root of [consumer, first, second]) {
        await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      }
      for (const root of [first, second]) {
        await FS.writeText(
          FS.resolvePath('Package.tao', root),
          'package { version 1.0.0 license MIT includes @ui requires ts npm:date-fns version 4.1.0 as util }\n',
        )
        await FS.writeText(
          FS.resolvePath('@ui/Card.tao', root),
          'public view Card() { render inject ```ts return null ``` }\n',
        )
      }
      await FS.writeText(
        FS.resolvePath('App.tao', consumer),
        `app First {
   id "first"
   version "1.0.0"
   name "First"
   requires ../first version ^1.0.0 { @ui as @first }
   view Main
}
app Second {
   id "second"
   version "1.0.0"
   name "Second"
   requires ../second version ^1.0.0 { @ui as @second }
   view Main
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
      )

      const calls: string[] = []
      const installNpm = async (path: string) => {
        calls.push(path)
        await FS.writeJson(FS.resolvePath('node_modules/util/package.json', path), {
          name: 'date-fns',
          version: '4.1.0',
        })
      }
      await runTaoInstall(consumer, { appName: 'First' }, { installNpm })
      Expect(Object.keys((await readProjectLock(consumer)).installs?.local ?? {})).toEqual(['.->../first#'])
      await runTaoInstall(consumer, { appName: 'Second' }, { installNpm })
      const lock = await readProjectLock(consumer)
      Expect(Object.keys(lock.installs?.local ?? {}).toSorted())
        .toEqual(['.->../first#', '.->../second#'])
      Expect(lock.installs?.environments[FS.relativePath(consumer, first)]?.npm['util']?.version).toBe('4.1.0')
      Expect(lock.installs?.environments[FS.relativePath(consumer, second)]?.npm['util']?.version).toBe(
        '4.1.0',
      )
      Expect(calls.toSorted()).toEqual([
        ManagedInstallEnvironment.environmentRoot(consumer, BridgeMetadata.dependencyNamespace(first)),
        ManagedInstallEnvironment.environmentRoot(consumer, BridgeMetadata.dependencyNamespace(second)),
      ].toSorted())
    } finally {
      await FS.remove(directory)
    }
  })

  Test('reruns npm while preserving unchanged managed files and repairing a missing alias link', async () => {
    const root = await mkTestDir('tao-install-repeat-')
    try {
      await writeNpmApp(root)
      const namespace = BridgeMetadata.dependencyNamespace(root)
      const directory = ManagedInstallEnvironment.environmentRoot(root, namespace)
      const manifestPath = FS.resolvePath('package.json', directory)
      const installed = FS.resolvePath('node_modules/util', directory)
      const linkPath = FS.resolvePath('util', ManagedInstallEnvironment.modulesRoot(root, root, namespace))
      const args = ['install', '--prefix', directory, '--no-audit', '--no-fund', '--legacy-peer-deps']
      const calls: string[][] = []
      const installNpm = async (path: string, _consumer: string, argv: readonly string[]) => {
        calls.push([...argv])
        await FS.writeJson(FS.resolvePath('node_modules/util/package.json', path), {
          name: 'date-fns',
          version: '4.1.0',
        })
      }
      const run = () => runTaoInstall(root, { appName: 'Reader' }, { installNpm })
      await run()
      Expect(calls).toEqual([args])
      await FS.setModifiedTimeMs(manifestPath, 1_600_000_000_000)
      const originalManifest = await FS.entryMetadata(manifestPath)
      const originalLink = await FS.entryMetadata(linkPath)
      await Time.sleep(20)
      await run()
      Expect(calls).toEqual([args, args])
      Expect(await FS.entryMetadata(manifestPath)).toEqual(originalManifest)
      Expect(await FS.entryMetadata(linkPath)).toEqual(originalLink)
      await FS.remove(linkPath)
      await run()
      Expect(calls).toEqual([args, args, args])
      Expect(await FS.realPath(linkPath)).toBe(installed)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports phase and command elapsed time and npm count on success and failure', async () => {
    const root = await mkTestDir('tao-install-timings-')
    try {
      await writeNpmApp(root)
      let tick = 0
      const success = fakeTerminal()
      await runTaoInstall(root, { appName: 'Reader', output: success.output }, {
        nowMs: () => tick,
        installNpm: async path => {
          const output = success.outputText()
          Expect(output.indexOf('Checking/installing npm package date-fns@4.1.0 as util...'))
            .toBeGreaterThan(output.indexOf('Finished dependency lock read (0ms).'))
          Expect(output).not.toContain('Finished npm package date-fns@4.1.0 as util')
          tick += 250
          await FS.writeJson(FS.resolvePath('node_modules/util/package.json', path), {
            name: 'date-fns',
            version: '4.1.0',
          })
        },
      })
      const output = success.outputText()
      Expect(output).toContain('Finished npm package date-fns@4.1.0 as util (250ms).')
      Expect(output).toContain('Finished dependency lock write (0ms).')
      Expect(output).toContain('in 250ms (1 npm invocation).')
      const failure = fakeTerminal()
      await Expect(runTaoInstall(root, { appName: 'Reader', output: failure.output }, {
        nowMs: () => tick,
        installNpm: async () => {
          tick += 125
          Errors.throwUnexpected('npm broke')
        },
      })).rejects.toThrow('npm broke')
      const failedOutput = failure.outputText()
      Expect(failedOutput).toContain('Failed npm package date-fns@4.1.0 as util after 125ms.')
      Expect(failedOutput).toContain('Install failed after 125ms (1 npm invocation).')
      Expect(failedOutput).not.toContain('Installed dependencies for ')
    } finally {
      await FS.remove(root)
    }
  })

  Test('installs every alias of one origin with a single npm invocation into one shared tree', async () => {
    const root = await mkTestDir('tao-install-batched-')
    try {
      await writeNpmApp(root, ['date-fns version 4.1.0 as util', 'lodash version 4.17.21 as fp'])
      const namespace = BridgeMetadata.dependencyNamespace(root)
      const directory = ManagedInstallEnvironment.environmentRoot(root, namespace)
      const manifests: unknown[] = []
      const terminal = fakeTerminal()
      await runTaoInstall(root, { appName: 'Reader', output: terminal.output }, {
        installNpm: async path => {
          manifests.push(await FS.readJson(FS.resolvePath('package.json', path)))
          await writeInstalled(path, 'util', 'date-fns', '4.1.0')
          await writeInstalled(path, 'fp', 'lodash', '4.17.21')
        },
      })

      Expect(manifests).toEqual([{
        private: true,
        dependencies: { fp: 'npm:lodash@4.17.21', util: 'npm:date-fns@4.1.0' },
      }])
      Expect(terminal.outputText()).toContain(
        'Checking/installing npm packages date-fns@4.1.0 as util, lodash@4.17.21 as fp...\n',
      )
      Expect(terminal.outputText()).toContain('(1 npm invocation).')
      const modulesRoot = ManagedInstallEnvironment.modulesRoot(root, root, namespace)
      for (const alias of ['util', 'fp']) {
        Expect(await FS.realPath(FS.resolvePath(alias, modulesRoot))).toBe(
          await FS.realPath(FS.resolvePath(`node_modules/${alias}`, directory)),
        )
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('a scoped install keeps an alias another app installed into the shared tree', async () => {
    const root = await mkTestDir('tao-install-shared-scope-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      await FS.writeText(
        FS.resolvePath('App.tao', root),
        `app First {
   id "first"
   version "1.0.0"
   name "First"
   requires ts npm:date-fns version 4.1.0 as util
   view Main
}
app Second {
   id "second"
   version "1.0.0"
   name "Second"
   requires ts npm:lodash version 4.17.21 as fp
   view Main
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
      )
      const manifests: { dependencies: Record<string, string> }[] = []
      const installNpm = async (path: string) => {
        const manifest = await FS.readJson<{ dependencies: Record<string, string> }>(
          FS.resolvePath('package.json', path),
        )
        manifests.push(manifest)
        for (const alias of Object.keys(manifest.dependencies)) {
          await writeInstalled(
            path,
            alias,
            alias === 'util' ? 'date-fns' : 'lodash',
            alias === 'util' ? '4.1.0' : '4.17.21',
          )
        }
      }
      await runTaoInstall(root, { appName: 'First' }, { installNpm })
      await runTaoInstall(root, { appName: 'Second' }, { installNpm })

      // npm prunes what its manifest omits, so the second, Second-only install still lists util.
      Expect(manifests.map(manifest => manifest.dependencies)).toEqual([
        { util: 'npm:date-fns@4.1.0' },
        { fp: 'npm:lodash@4.17.21', util: 'npm:date-fns@4.1.0' },
      ])
      const environment = (await readProjectLock(root)).installs?.environments['.']
      Expect(Object.keys(environment?.npm ?? {}).toSorted()).toEqual(['fp', 'util'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('moves an alias the per-alias layout installed into the shared tree and removes the old one', async () => {
    const root = await mkTestDir('tao-install-legacy-')
    try {
      await writeNpmApp(root)
      const namespace = BridgeMetadata.dependencyNamespace(root)
      const legacy = ManagedInstallEnvironment.aliasPackageRoot(root, namespace, 'util')
      const linkPath = FS.resolvePath('util', ManagedInstallEnvironment.modulesRoot(root, root, namespace))
      await writeInstalled(legacy, 'util', 'date-fns', '4.1.0')
      await FS.replaceSymlink(FS.resolvePath('node_modules/util', legacy), linkPath)
      await FS.writeJson(FS.resolvePath('.tao/store/lock.jsonc', root), {
        schemaVersion: 1,
        installs: {
          lockfileVersion: 2,
          local: {},
          environments: {
            '.': {
              projectRoot: '.',
              publications: [],
              npm: { util: { name: 'date-fns', requested: '4.1.0', version: '4.1.0' } },
            },
          },
        },
      })

      await runTaoInstall(root, { appName: 'Reader' }, {
        installNpm: path => writeInstalled(path, 'util', 'date-fns', '4.1.0'),
      })

      Expect(await FS.realPath(linkPath)).toBe(
        await FS.realPath(
          FS.resolvePath('node_modules/util', ManagedInstallEnvironment.environmentRoot(root, namespace)),
        ),
      )
      Expect(await FS.exists(ManagedInstallEnvironment.aliasNamespaceRoot(root, namespace))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('computes exact legacy and current package targets for scoped npm aliases', () => {
    const root = FS.resolvePath('fixture-consumer')
    Expect(ManagedInstallEnvironment.aliasLinkTargets(root, 'origin-namespace', '@tools/util')).toEqual([
      FS.resolvePath('.tao/cache/install/environments/origin-namespace/node_modules/@tools/util', root),
      FS.resolvePath('.tao/cache/install/packages/origin-namespace/4868cd7539a9cb35/node_modules/@tools/util', root),
      FS.resolvePath('.tao/install/packages/origin-namespace/4868cd7539a9cb35/node_modules/@tools/util', root),
    ])
  })

  for (const contents of ['populated', 'dangling']) {
    Test(`repairs a locked ${contents} legacy link after install and keeps repeated links stable`, async () => {
      const root = await mkTestDir('tao-install-legacy-')
      try {
        const alias = 'util'
        await writeNpmApp(root)
        const packageName = 'date-fns'
        const namespace = BridgeMetadata.dependencyNamespace(root)
        const legacy = FS.resolvePath(
          `node_modules/${alias}`,
          FS.resolvePath(
            `.tao/install/packages/${namespace}/9342af224fa264b0`,
            root,
          ),
        )
        const current = FS.resolvePath(
          `node_modules/${alias}`,
          ManagedInstallEnvironment.environmentRoot(root, namespace),
        )
        const link = FS.resolvePath(`node_modules/${alias}`, root)
        await writeNpmLock(root, '.', alias)
        // Migration moves these contents, leaving the old symlink target dangling.
        if (contents === 'populated') {
          await FS.writeText(FS.resolvePath('native.ts', legacy), 'retained native contents')
        }
        await FS.symlink(FS.relativePath(FS.dirname(link), legacy), link)
        const before = await FS.entryMetadata(link)
        let calls = 0
        const installNpm = async (path: string) => {
          calls++
          Expect(await FS.entryMetadata(link)).toEqual(calls === 1 ? before : repaired)
          const manifest = await FS.readJson<{ dependencies: Record<string, string> }>(
            FS.resolvePath('package.json', path),
          )
          Expect(manifest.dependencies).toEqual({ [alias]: `npm:${packageName}@4.1.0` })
          await FS.writeJson(FS.resolvePath(`node_modules/${alias}/package.json`, path), {
            name: packageName,
            version: '4.1.0',
          })
        }
        const run = () => runTaoInstall(root, { appName: 'Reader', output: fakeTerminal().output }, { installNpm })
        await run()
        Expect(await FS.realPath(link)).toBe(current)
        const repaired = await FS.entryMetadata(link)
        await run()
        Expect(calls).toBe(2)
        Expect(await FS.entryMetadata(link)).toEqual(repaired)
        // Whatever the migration carried into the per-alias tree goes once the alias links into the shared one.
        Expect(await FS.exists(ManagedInstallEnvironment.aliasNamespaceRoot(root, namespace))).toBe(false)
        Expect((await readProjectLock(root)).installs?.environments['.']?.npm[alias])
          .toEqual({ name: packageName, requested: '4.1.0', version: '4.1.0' })
      } finally {
        await FS.remove(root)
      }
    })
  }

  for (const outcome of ['npm failure', 'missing installed manifest']) {
    Test(`keeps a locked legacy link when repair stops at ${outcome}`, async () => {
      const root = await mkTestDir('tao-install-legacy-failure-')
      try {
        await writeNpmApp(root)
        await writeNpmLock(root, '.', 'util')
        const namespace = BridgeMetadata.dependencyNamespace(root)
        const legacy = FS.resolvePath(
          'node_modules/util',
          ManagedInstallEnvironment.legacyPackageRoot(root, namespace, 'util'),
        )
        const link = FS.resolvePath('node_modules/util', root)
        await FS.symlink(legacy, link)
        const before = await FS.entryMetadata(link)
        let calls = 0
        await Expect(runTaoInstall(root, { appName: 'Reader', output: fakeTerminal().output }, {
          installNpm: async () => {
            calls++
            if (outcome === 'npm failure') {
              Errors.throwUnexpected('npm failed')
            }
          },
        })).rejects.toThrow()
        Expect(calls).toBe(1)
        Expect(await FS.entryMetadata(link)).toEqual(before)
      } finally {
        await FS.remove(root)
      }
    })
  }

  for (const kind of ['unowned', 'wrong namespace', 'wrong alias', 'prefix', 'arbitrary', 'directory']) {
    Test(`rejects a ${kind} legacy alias before npm or package mutation`, async () => {
      const root = await mkTestDir('tao-install-legacy-unowned-')
      try {
        await writeNpmApp(root)
        if (kind !== 'unowned') {
          await writeNpmLock(root, '.', 'util')
        }
        const namespace = BridgeMetadata.dependencyNamespace(root)
        const legacy = FS.resolvePath(
          'node_modules/util',
          ManagedInstallEnvironment.legacyPackageRoot(root, namespace, 'util'),
        )
        const link = FS.resolvePath('node_modules/util', root)
        const target = kind === 'wrong namespace'
          ? FS.resolvePath(
            'node_modules/util',
            ManagedInstallEnvironment.legacyPackageRoot(root, 'other-namespace', 'util'),
          )
          : kind === 'wrong alias'
          ? FS.resolvePath('node_modules/util', ManagedInstallEnvironment.legacyPackageRoot(root, namespace, 'other'))
          : kind === 'prefix'
          ? `${legacy}/child`
          : kind === 'arbitrary'
          ? FS.resolvePath('unrelated', root)
          : legacy
        if (kind === 'directory') {
          await FS.mkdir(link)
        } else {
          await FS.symlink(target, link)
        }
        const before = await FS.entryMetadata(link)
        const lock = await readProjectLock(root)
        let calls = 0
        await Expect(runTaoInstall(root, { appName: 'Reader', output: fakeTerminal().output }, {
          installNpm: async () => {
            calls++
          },
        })).rejects.toThrow('Tao-managed')
        Expect(calls).toBe(0)
        Expect(await FS.entryMetadata(link)).toEqual(before)
        Expect(await readProjectLock(root)).toEqual(lock)
        Expect(await FS.exists(ManagedInstallEnvironment.environmentRoot(root, namespace))).toBe(false)
      } finally {
        await FS.remove(root)
      }
    })
  }

  for (const kind of ['owned', 'unowned', 'wrong namespace', 'directory']) {
    Test(`${kind === 'owned' ? 'repairs' : 'rejects'} a ${kind} legacy dependency origin link`, async () => {
      const directory = await mkTestDir('tao-install-legacy-origin-')
      const root = FS.resolvePath('consumer', directory)
      const library = FS.resolvePath('library', directory)
      try {
        await writeNpmApp(root)
        await FS.writeText(FS.resolvePath('.tao/.gitkeep', library), '')
        await FS.writeText(
          FS.resolvePath('App.tao', root),
          `app Reader {
   id "reader"
   version "1.0.0"
   name "Reader"
   requires ts npm:date-fns version 4.1.0 as util
   requires ../library version ^1.0.0 { @ui }
   view Main
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
        )
        await FS.writeText(
          FS.resolvePath('Package.tao', library),
          'package { version 1.0.0 license MIT includes @ui requires ts npm:date-fns version 4.1.0 as util }\n',
        )
        await FS.writeText(
          FS.resolvePath('@ui/Card.tao', library),
          'public view Card() { render inject ```ts return null ``` }\n',
        )
        if (kind !== 'unowned') {
          await writeNpmLock(root, '../library', 'util')
        }
        const namespace = BridgeMetadata.dependencyNamespace(library)
        const modules = ManagedInstallEnvironment.modulesRoot(root, library, namespace)
        const aliasLink = FS.resolvePath('util', modules)
        const generated = ManagedInstallEnvironment.generatedModulesLink(root, namespace)
        const legacyModules = ManagedInstallEnvironment.legacyModulesRoot(root, namespace)
        if (kind === 'directory') {
          await FS.mkdir(generated)
        } else {
          await FS.symlink(
            kind === 'wrong namespace' ? ManagedInstallEnvironment.legacyModulesRoot(root, 'other') : legacyModules,
            generated,
          )
        }
        if (kind === 'owned') {
          await FS.symlink(
            FS.resolvePath('node_modules/util', ManagedInstallEnvironment.legacyPackageRoot(root, namespace, 'util')),
            FS.resolvePath('util', legacyModules),
          )
        }
        const before = await FS.entryMetadata(generated)
        let calls = 0
        const run = () =>
          runTaoInstall(root, { appName: 'Reader', output: fakeTerminal().output }, {
            installNpm: async path => {
              calls++
              await FS.writeJson(FS.resolvePath('node_modules/util/package.json', path), {
                name: 'date-fns',
                version: '4.1.0',
              })
            },
          })
        if (kind === 'owned') {
          await run()
          Expect(await FS.realPath(generated)).toBe(modules)
          Expect(await FS.realPath(aliasLink)).toBe(
            FS.resolvePath('node_modules/util', ManagedInstallEnvironment.environmentRoot(root, namespace)),
          )
          const repaired = await FS.entryMetadata(generated)
          const repairedAlias = await FS.entryMetadata(aliasLink)
          await run()
          Expect(calls).toBe(4)
          Expect(await FS.entryMetadata(generated)).toEqual(repaired)
          Expect(await FS.entryMetadata(aliasLink)).toEqual(repairedAlias)
        } else {
          await Expect(run()).rejects.toThrow('not Tao-managed')
          Expect(calls).toBe(0)
          Expect(await FS.entryMetadata(generated)).toEqual(before)
          Expect(await FS.exists(ManagedInstallEnvironment.environmentRoot(root, namespace))).toBe(false)
        }
      } finally {
        await FS.remove(directory)
      }
    })
  }

  Test('refuses to replace an unrelated root npm installation', async () => {
    const root = await mkTestDir('tao-install-unowned-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      await FS.writeText(
        FS.resolvePath('App.tao', root),
        `app Reader {
   id "reader"
   version "1.0.0"
   name "Reader"
   requires ts npm:date-fns version 4.1.0 as util
   view Main
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
      )
      const unrelated = FS.resolvePath('node_modules/util/package.json', root)
      await FS.writeText(unrelated, '{"name":"unrelated","version":"1.0.0"}\n')

      await Expect(runTaoInstall(root, { appName: 'Reader' }, {
        installNpm: async () => {
          Errors.throwUnexpected('unexpected npm call')
        },
      })).rejects.toThrow('not Tao-managed')
      Expect(await FS.readText(unrelated)).toBe('{"name":"unrelated","version":"1.0.0"}\n')
      Expect((await readProjectLock(root)).installs).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })
})

async function writeNpmLock(root: string, projectRoot: string, alias: string): Promise<void> {
  await FS.writeJson(FS.resolvePath('.tao/store/lock.jsonc', root), {
    schemaVersion: 1,
    installs: {
      lockfileVersion: 2,
      local: {},
      environments: {
        [projectRoot]: {
          projectRoot,
          publications: [],
          npm: { [alias]: { name: 'date-fns', requested: '4.1.0', version: '4.1.0' } },
        },
      },
    },
  })
}

async function writeNpmApp(root: string, requirements = ['date-fns version 4.1.0 as util']): Promise<void> {
  await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
  await FS.writeText(
    FS.resolvePath('App.tao', root),
    `app Reader {
   id "reader"
   version "1.0.0"
   name "Reader"
${requirements.map(requirement => `   requires ts npm:${requirement}\n`).join('')}   view Main
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
  )
}

/** writeInstalled stands in for npm placing `alias` in the tree under `prefix`. */
async function writeInstalled(prefix: string, alias: string, name: string, version: string): Promise<void> {
  await FS.writeJson(FS.resolvePath(`node_modules/${alias}/package.json`, prefix), { name, version })
}

import { BridgeMetadata } from '@compiler/bridge-metadata'
import { Errors, FS } from '@shared'
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
        installNpm: async path => {
          const manifest = await FS.readJson<{ dependencies: Record<string, string> }>(
            FS.resolvePath('package.json', path),
          )
          const specifier = manifest.dependencies['util']!
          const version = specifier.slice(specifier.lastIndexOf('@') + 1)
          // The package announcement must arrive before the potentially slow installer runs.
          Expect(terminal.outputText()).toContain(`Installing npm package date-fns@${version} as util...\n`)
          Expect(terminal.outputText()).not.toContain('Installed dependencies for ')
          installed.push(version)
          await FS.writeJson(FS.resolvePath('node_modules/util/package.json', path), { name: 'date-fns', version })
        },
      })

      Expect(installed.toSorted()).toEqual(['3.6.0', '4.1.0'])
      const output = terminal.outputText()
      Expect(output).toContain('Discovering Tao source files...\n')
      Expect(output).toContain('Resolving app and package dependencies...\n')
      Expect(output).toContain('Linking npm alias util (3.6.0)...\n')
      Expect(output).toContain('Linking npm alias util (4.1.0)...\n')
      Expect(output.indexOf('Saving dependency lock...')).toBeGreaterThan(
        output.lastIndexOf('Linking npm alias util'),
      )
      Expect(output.indexOf('Installed dependencies for ')).toBeGreaterThan(output.indexOf('Saving dependency lock...'))
      const lock = await readProjectLock(consumer)
      for (const [origin, version] of [[older, '3.6.0'], [newer, '4.1.0']] as const) {
        const namespace = BridgeMetadata.dependencyNamespace(origin)
        const environment = lock.installs?.environments[namespace]
        Expect(environment?.npm['util']).toEqual({ name: 'date-fns', requested: version, version })
        const modulesRoot = ManagedInstallEnvironment.modulesRoot(consumer, origin, namespace)
        Expect(await FS.realPath(FS.resolvePath('util', modulesRoot))).toBe(
          ManagedInstallEnvironment.packageRoot(consumer, namespace, 'util') + '/node_modules/util',
        )
        Expect(await FS.realPath(ManagedInstallEnvironment.generatedModulesLink(consumer, namespace)))
          .toBe(modulesRoot)
      }
      Expect(await FS.exists(FS.resolvePath('node_modules/util', consumer))).toBe(false)
    } finally {
      await FS.remove(directory)
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
        await FS.writeText(FS.resolvePath('Package.tao', root), 'package { version 1.0.0 license MIT includes @ui }\n')
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

      await runTaoInstall(consumer, { appName: 'First' })
      Expect(Object.keys((await readProjectLock(consumer)).installs?.local ?? {})).toEqual(['.->../first#'])
      await runTaoInstall(consumer, { appName: 'Second' })
      Expect(Object.keys((await readProjectLock(consumer)).installs?.local ?? {}).toSorted())
        .toEqual(['.->../first#', '.->../second#'])
    } finally {
      await FS.remove(directory)
    }
  })

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

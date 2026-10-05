import { generateNativeBindingFiles } from '@native-bindings'
import { Errors, FS, Platform, Repo, TaoStdlib } from '@shared'
import { Deferred, Describe, Expect, settle, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import { publishNativeBindingFileSets } from '../native-bindings-src/write-bindings'

const input = {
  'node_modules/expo-publication/package.json': JSON.stringify({
    name: 'expo-publication',
    version: '1.0.0',
    types: 'index.d.ts',
  }),
  'node_modules/expo-publication/index.d.ts': `
export declare enum Choice { First = 'first', Second = 'second' }
export declare function choose(value: Choice): Promise<void>;
`,
}

const declaredStdlib = testOverrideSlot<string | undefined>({
  read: () => Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV]
    } else {
      Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV] = value
    }
  },
})

Describe('hidden native binding publication', () => {
  Test(
    'keeps prepared publication outside Tao discovery and stdlib identity until changed outputs commit',
    async () => {
      await withTaoFiles(
        'native-publication-hidden-staging',
        { ...input, 'stdlib/.tao/.gitkeep': '' },
        async (_paths, root) => {
          const stdlib = FS.resolvePath('stdlib', root)
          const options = {
            source: 'expo',
            from: root,
            out: FS.resolvePath('@tao/device/files', stdlib),
            typescriptOut: FS.resolvePath('.tao-ts/native-bindings/files', stdlib),
          }
          const paths = await generateNativeBindingFiles('expo-publication', options)
          const sets = await Promise.all([options.out, options.typescriptOut].map(async directory => ({
            directory,
            files: Object.fromEntries(
              await Promise.all(
                paths.filter(path => FS.pathIsWithin(path, directory))
                  .map(async path => [FS.relativePath(directory, path), await FS.readText(path)]),
              ),
            ),
          })))
          const stagingRoot = FS.resolvePath('.tao/cache/native-bindings', stdlib)
          const restore = declaredStdlib.install(stdlib)
          try {
            const discovered = await Repo.filesUnder(stdlib, { extensions: ['.tao'] })
            Expect(discovered).toEqual([FS.resolvePath('Bindings.tao', options.out)])
            const publishPaused = async () => {
              const before = await TaoStdlib.declaredRootIdentity()
              const entered = Deferred()
              const release = Deferred()
              let validations = 0
              const writer = publishNativeBindingFileSets(sets, 'write', async () => {
                validations += 1
                if (validations === 1) {
                  entered.resolve()
                  await release.promise
                }
                Expect(await TaoStdlib.declaredRootIdentity()).toBe(before)
              }, stagingRoot)
              await entered.promise
              try {
                Expect(await FS.isEmptyDirectory(stagingRoot)).toBe(false)
                Expect(await Repo.filesUnder(stdlib, { extensions: ['.tao'] })).toEqual(discovered)
                Expect(await TaoStdlib.declaredRootIdentity()).toBe(before)
              } finally {
                release.resolve()
                await writer
              }
              Expect(validations).toBe(2)
              Expect(await FS.isEmptyDirectory(stagingRoot)).toBe(true)
              return before
            }
            const unchanged = await publishPaused()
            Expect(await TaoStdlib.declaredRootIdentity()).toBe(unchanged)
            sets[0]!.files['Bindings.tao'] += '\n// new native output\n'
            const previous = await publishPaused()
            Expect(await TaoStdlib.declaredRootIdentity()).not.toBe(previous)
            const lastGood = await Promise.all(paths.map(path => FS.readText(path)))
            const lastGoodIdentity = await TaoStdlib.declaredRootIdentity()
            sets[0]!.files['Bindings.tao'] += '// must not publish\n'
            let failedValidations = 0
            await Expect(publishNativeBindingFileSets(sets, 'write', async () => {
              failedValidations += 1
              if (failedValidations === 2) {
                Errors.throwUserInput('fixture input changed before publication')
              }
            }, stagingRoot)).rejects.toThrow('fixture input changed before publication')
            Expect(failedValidations).toBe(2)
            Expect(await Promise.all(paths.map(path => FS.readText(path)))).toEqual(lastGood)
            Expect(await TaoStdlib.declaredRootIdentity()).toBe(lastGoodIdentity)
            Expect(await FS.isEmptyDirectory(stagingRoot)).toBe(true)
          } finally {
            restore()
          }
        },
        { verbatim: true },
      )
    },
  )

  Test('keeps a check outside the publication transaction until all roots are complete', async () => {
    await withTaoFiles('native-publication-lock', input, async (_paths, root) => {
      const options = {
        source: 'expo',
        from: root,
        out: FS.resolvePath('@device/photos', root),
        typescriptOut: FS.resolvePath('.tao-ts/native-bindings/photos', root),
      }
      const paths = await generateNativeBindingFiles('expo-publication', options)
      const sets = await Promise.all([options.out, options.typescriptOut].map(async directory => ({
        directory,
        files: Object.fromEntries(
          await Promise.all(
            paths.filter(path => FS.pathIsWithin(path, directory))
              .map(async path => [FS.relativePath(directory, path), await FS.readText(path)]),
          ),
        ),
      })))
      const entered = Deferred()
      const release = Deferred()
      const writer = publishNativeBindingFileSets(sets, 'write', async () => {
        entered.resolve()
        await release.promise
      })
      await entered.promise
      let checked = false
      const check = publishNativeBindingFileSets(sets, 'check', async () => {
        checked = true
      })
      try {
        await settle(20)
        Expect(checked).toBe(false)
      } finally {
        release.resolve()
      }
      await Promise.all([writer, check])
      Expect(checked).toBe(true)
      await generateNativeBindingFiles('expo-publication', { ...options, mode: 'check' })
    }, { verbatim: true })
  })

  Test('publishes separate owned roots with physical relative imports and checks freshness', async () => {
    await withTaoFiles('native-publication', input, async (_paths, root) => {
      const out = FS.resolvePath('@device/photos', root)
      const typescriptOut = FS.resolvePath('.tao-ts/native-bindings/photos', root)
      const options = { source: 'expo', from: root, out, typescriptOut }
      const published = await generateNativeBindingFiles('expo-publication', options)
      Expect(published.sort()).toEqual([
        FS.resolvePath('Bindings.tao', out),
        FS.resolvePath('bindings.json', out),
        FS.resolvePath('Bindings.ts', typescriptOut),
        FS.resolvePath('bindings.json', typescriptOut),
      ].sort())
      Expect(await FS.readText(FS.resolvePath('Bindings.tao', out)))
        .toContain('from ../../.tao-ts/native-bindings/photos/Bindings.ts')
      Expect(await FS.readText(FS.resolvePath('Bindings.ts', typescriptOut)))
        .toContain('../../../@device/photos/Bindings.tao')
      Expect(await FS.exists(FS.resolvePath('Bindings.ts', out))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('bindings.json', out)))
        .toBe(await FS.readText(FS.resolvePath('bindings.json', typescriptOut)))
      await generateNativeBindingFiles('expo-publication', { ...options, mode: 'check' })
      await FS.writeText(FS.resolvePath('Bindings.ts', typescriptOut), 'edited generated implementation')
      await Expect(generateNativeBindingFiles('expo-publication', { ...options, mode: 'check' }))
        .rejects.toThrow('stale or missing')
      await generateNativeBindingFiles('expo-publication', options)
      await generateNativeBindingFiles('expo-publication', { ...options, mode: 'check' })
      await FS.writeText(FS.resolvePath('obsolete.ts', typescriptOut), 'stale generated output')
      await Expect(generateNativeBindingFiles('expo-publication', { ...options, mode: 'check' }))
        .rejects.toThrow('stale generated files')
    }, { verbatim: true })
  })

  Test('preserves both previous outputs when a new input cannot be generated', async () => {
    await withTaoFiles('native-publication', input, async (_paths, root) => {
      const options = {
        source: 'expo',
        from: root,
        out: FS.resolvePath('@device/photos', root),
        typescriptOut: FS.resolvePath('.tao-ts/native-bindings/photos', root),
      }
      const paths = await generateNativeBindingFiles('expo-publication', options)
      const previous = await Promise.all(paths.map(path => FS.readText(path)))
      await FS.writeText(
        FS.resolvePath('node_modules/expo-publication/index.d.ts', root),
        'export declare function impossible(callback: () => number): void;',
      )
      await Expect(generateNativeBindingFiles('expo-publication', options)).rejects.toThrow('impossible')
      Expect(await Promise.all(paths.map(path => FS.readText(path)))).toEqual(previous)
      await Expect(generateNativeBindingFiles('expo-publication', { ...options, mode: 'check' }))
        .rejects.toThrow('impossible')
    }, { verbatim: true })
  })

  Test('refuses an unowned second root before replacing the first root', async () => {
    await withTaoFiles(
      'native-publication',
      { ...input, 'handwritten/Notes.ts': 'export const Note = 1' },
      async (_paths, root) => {
        const options = { source: 'expo', from: root, out: FS.resolvePath('@device/photos', root) }
        const paths = await generateNativeBindingFiles('expo-publication', options)
        const previous = await Promise.all(paths.map(path => FS.readText(path)))
        await Expect(generateNativeBindingFiles('expo-publication', {
          ...options,
          typescriptOut: FS.resolvePath('handwritten', root),
        })).rejects.toThrow('not a generated binding directory')
        Expect(await Promise.all(paths.map(path => FS.readText(path)))).toEqual(previous)
        Expect(await FS.readText(FS.resolvePath('handwritten/Notes.ts', root))).toBe('export const Note = 1')
      },
      { verbatim: true },
    )
  })

  Test('rejects unresolved imported types without replacing either previous output root', async () => {
    await withTaoFiles('native-publication-resolution', input, async (_paths, root) => {
      const options = {
        source: 'expo',
        from: root,
        out: FS.resolvePath('@device/files', root),
        typescriptOut: FS.resolvePath('.tao-ts/native-bindings/files', root),
      }
      const paths = await generateNativeBindingFiles('expo-publication', options)
      const previous = await Promise.all(paths.map(path => FS.readText(path)))
      await FS.writeText(
        FS.resolvePath('node_modules/expo-publication/index.d.ts', root),
        `import type { Missing } from 'missing-package';
export declare function readBroken(): Missing;`,
      )
      await Expect(generateNativeBindingFiles('expo-publication', options)).rejects.toThrow('Missing')
      Expect(await Promise.all(paths.map(path => FS.readText(path)))).toEqual(previous)
      await Expect(generateNativeBindingFiles('expo-publication', { ...options, mode: 'check' }))
        .rejects.toThrow('Missing')
      Expect(await Promise.all(paths.map(path => FS.readText(path)))).toEqual(previous)
    }, { verbatim: true })
  })
})

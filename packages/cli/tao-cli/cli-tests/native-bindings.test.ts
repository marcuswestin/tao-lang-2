import { ExpoApiSource, type NativeApiSource, NativeBindings, ReactNativeApiSource } from '@compiler/native-bindings'
import { FS, Repo } from '@shared'
import { Deferred, Describe, Expect, Test, testOverrideSlot } from '@shared/test'
import { generateNativeBindingFiles } from '../cli-src/native-bindings/native-binding-command'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, runTaoCliForTest, withTaoFixture } from './test-cli-files'

const fromDirectory = Repo.resolvePath('packages/apps/expo-host')
const sourceReadSlot = testOverrideSlot({ read: () => ExpoApiSource.read, write: value => ExpoApiSource.read = value })

Describe('native binding generation', () => {
  Test('generates the complete installed Haptics surface and checks its Tao and TypeScript contracts', async () => {
    const generated = await NativeBindings.generate({
      source: ExpoApiSource,
      packageName: 'expo-haptics',
      fromDirectory,
    })
    Expect(generated.catalog.operations.map(operation => operation.name).sort()).toEqual([
      'impactAsync',
      'notificationAsync',
      'performAndroidHapticsAsync',
      'selectionAsync',
    ])
    Expect(generated.catalog.enums.map(type => [type.name, type.members.length]).sort()).toEqual([
      ['AndroidHaptics', 19],
      ['ImpactFeedbackStyle', 5],
      ['NotificationFeedbackType', 3],
    ])
    Expect(generated.diagnostics).toEqual([])
    Expect(generated.files['Bindings.ts']).not.toContain('TR.Haptic')
    await withTaoFixture({
      ...checkedProjectFile,
      ...generated.files,
      'Main.tao': `use SelectionAsync, ImpactAsync, NotificationAsync, PerformAndroidHapticsAsync,
   ImpactFeedbackStyle, NotificationFeedbackType, AndroidHaptics from ./Bindings.tao

action Exercise() {
   do SelectionAsync()
   do ImpactAsync()
   do ImpactAsync(Style: Soft)
   do NotificationAsync()
   do NotificationAsync(Type: Warning)
   do PerformAndroidHapticsAsync(Type: Gesture_Start)
}
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      Expect(await FS.isFile(FS.resolvePath('Bindings.tao.ts', root))).toBe(true)
    })
    Expect((await NativeBindings.generate({ source: ExpoApiSource, packageName: 'expo-haptics', fromDirectory })).files)
      .toEqual(generated.files)
  })

  Test('uses the same import interface and emitter for React Native Vibration', async () => {
    const generated = await NativeBindings.generate({
      source: ReactNativeApiSource,
      packageName: 'react-native',
      exportName: 'Vibration',
      fromDirectory,
    })
    Expect(generated.catalog.operations.map(operation => operation.name).sort()).toEqual(['cancel', 'vibrate'])
    Expect(generated.diagnostics).toEqual([])
    await withTaoFixture({
      ...checkedProjectFile,
      ...generated.files,
      'Main.tao': `use Vibrate, Cancel from ./Bindings.tao
action Exercise() {
   do Vibrate()
   do Vibrate(Pattern: 200, Repeat: false)
   do Cancel()
}
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
    })
  })

  Test('reads only public declarations, follows reexports, and reports unsupported results and overloads', async () => {
    await withTaoFixture({
      'node_modules/expo-example/package.json': JSON.stringify({
        name: 'expo-example',
        version: '1.0.0',
        types: 'index.d.ts',
        main: 'index.js',
      }),
      'node_modules/expo-example/index.js': 'throw Error("Extraction must not execute the native package")',
      'node_modules/expo-example/index.d.ts':
        `export { Choice, choose, fetchValue, overloaded, unionArray } from './public';`,
      'node_modules/expo-example/public.d.ts': `
export declare enum Choice { First = 'first', Second = 'second' }
export declare function choose(value?: Choice): Promise<void>;
export declare function fetchValue(): Promise<number>;
export declare function overloaded(value: string): void;
export declare function overloaded(value: number): void;
export declare function unionArray(value: (number | string)[]): void;
export declare function privateToModule(): void;
`,
    }, async root => {
      const generated = await NativeBindings.generate({
        source: ExpoApiSource,
        packageName: 'expo-example',
        fromDirectory: root,
      })
      Expect(generated.catalog.operations.map(operation => operation.name)).toEqual(['choose'])
      Expect(generated.catalog.enums).toEqual([{
        name: 'Choice',
        members: [{ name: 'First', value: 'first' }, { name: 'Second', value: 'second' }],
      }])
      Expect(generated.diagnostics.map(diagnostic => diagnostic.symbol).sort()).toEqual([
        'fetchValue',
        'overloaded',
        'unionArray',
      ])
      Expect(generated.files['Bindings.ts']).toContain('native()["choose"]()')
    })
  })

  Test('accepts a new source adapter without adding a provider branch to the emitter', async () => {
    const source: NativeApiSource = {
      name: 'future-metadata',
      async read(request) {
        return {
          catalog: {
            source: 'future-metadata',
            packageName: request.packageName,
            packageVersion: '1',
            declaration: 'metadata.json',
            declarationHash: 'fixture',
            enums: [],
            operations: [{
              name: 'pulse',
              asynchronous: false,
              platforms: ['android'],
              parameters: [{ name: 'length', optional: false, type: { kind: 'primitive', name: 'number' } }],
            }],
          },
          diagnostics: [],
        }
      },
    }
    const generated = await NativeBindings.generate({ source, packageName: 'future-native-host', fromDirectory })
    Expect(generated.files['Bindings.tao']).toContain('public action Pulse(Length number) from ./Bindings.ts')
    Expect(generated.files['Bindings.ts']).toContain('native()["pulse"](argument0)')
    Expect(generated.diagnostics).toEqual([])
  })

  Test('ignores type-only reexports and rejects erased const enums', async () => {
    await withTaoFixture({
      'node_modules/expo-types/package.json': JSON.stringify({
        name: 'expo-types',
        version: '1.0.0',
        types: 'index.d.ts',
      }),
      'node_modules/expo-types/index.d.ts': `
export type { ghost, Hidden } from './hidden';
export * from './star';
export declare const enum Erased { First = 'first' }
export declare function run(value: Erased): void;
export declare function real(): void;
export declare function requiredAbsent(value: string | undefined): void;
`,
      'node_modules/expo-types/hidden.d.ts':
        `export declare function ghost(): void; export declare enum Hidden { First = 'first' }`,
      'node_modules/expo-types/star.d.ts': `export type * from './other';`,
      'node_modules/expo-types/other.d.ts': `export declare function starGhost(): void;`,
    }, async root => {
      const generated = await NativeBindings.generate({
        source: ExpoApiSource,
        packageName: 'expo-types',
        fromDirectory: root,
      })
      Expect(generated.catalog.operations.map(operation => operation.name)).toEqual(['real'])
      Expect(generated.catalog.enums).toEqual([])
      Expect(generated.diagnostics.map(diagnostic => diagnostic.symbol).sort()).toEqual([
        'Erased',
        'requiredAbsent',
        'run',
      ])
    })
  })

  Test('serializes concurrent generations into the same output directory', async () => {
    await withTaoFixture({
      'node_modules/expo-race/package.json': JSON.stringify({
        name: 'expo-race',
        version: '1.0.0',
        types: 'index.d.ts',
      }),
      'node_modules/expo-race/index.d.ts': 'export declare function pulse(): void;',
    }, async root => {
      const options = { source: 'expo', from: root, out: FS.resolvePath('Generated', root) }
      const results = await Promise.allSettled([
        generateNativeBindingFiles('expo-race', options),
        generateNativeBindingFiles('expo-race', options),
      ])
      Expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
      Expect(await FS.readText(FS.resolvePath('Bindings.ts', options.out))).toContain('native()["pulse"]()')
      Expect((await FS.listDir(options.out)).sort()).toEqual(['Bindings.tao', 'Bindings.ts', 'bindings.json'])
    })
  })

  Test('reruns the CLI with identical output and leaves unchanged files untouched', async () => {
    await withTaoFixture(checkedProjectFile, async root => {
      const out = FS.resolvePath('Generated', root)
      const args = ['bridge', 'expo-haptics', '--source', 'expo', '--from', fromDirectory, '--out', out]
      const generated = await runTaoCliForTest(args)
      Expect(generated.exitCode).toBe(0)
      Expect(generated.stdout).toContain('Generated native bindings')
      const path = FS.resolvePath('Bindings.tao', out)
      const original = await FS.readText(path)
      const originalMetadata = await FS.entryMetadata(path)
      Expect(original).toContain('PerformAndroidHapticsAsync')
      const repeated = await runTaoCliForTest(args)
      Expect(repeated.exitCode).toBe(0)
      Expect(repeated.stdout).toContain('Generated native bindings')
      Expect(await FS.readText(path)).toBe(original)
      Expect((await FS.entryMetadata(path)).modifiedMs).toBe(originalMetadata.modifiedMs)
    })
  })

  Test('waits for an active publisher before judging partially written output', async () => {
    await withTaoFixture({
      'node_modules/expo-race/package.json': JSON.stringify({
        name: 'expo-race',
        version: '1.0.0',
        types: 'index.d.ts',
      }),
      'node_modules/expo-race/index.d.ts': 'export declare function pulse(): void;',
    }, async root => {
      const out = FS.resolvePath('Generated', root)
      const generated = await NativeBindings.generate({
        source: ExpoApiSource,
        packageName: 'expo-race',
        fromDirectory: root,
      })
      const partial = Deferred()
      const release = Deferred()
      const reading = Deferred()
      const read = ExpoApiSource.read
      const restore = sourceReadSlot.install(request => {
        if (request.fromDirectory === root) {
          reading.resolve()
        }
        return read(request)
      })
      const publication = FS.withFileMutationLock(out, root, async () => {
        await FS.writeText(FS.resolvePath('Bindings.tao', out), generated.files['Bindings.tao']!)
        partial.resolve()
        await release.promise
        await FS.writeText(FS.resolvePath('Bindings.ts', out), generated.files['Bindings.ts']!)
        await FS.writeText(FS.resolvePath('bindings.json', out), generated.files['bindings.json']!)
      })
      let rerun: Promise<string[]> | undefined
      try {
        await Promise.race([partial.promise, publication])
        rerun = generateNativeBindingFiles('expo-race', { source: 'expo', from: root, out })
        // The old unlocked preflight rejects before extraction can begin.
        await Promise.race([reading.promise, rerun])
        release.resolve()
        await publication
        await rerun
        Expect(await FS.readText(FS.resolvePath('Bindings.ts', out))).toContain('return native()["pulse"]()')
        Expect((await FS.listDir(out)).sort()).toEqual(['Bindings.tao', 'Bindings.ts', 'bindings.json'])
      } finally {
        release.resolve()
        restore()
        await publication
        await rerun?.catch(() => undefined)
      }
    })
  })

  Test('regenerates edited bindings and removes stale output while keeping custom sibling files', async () => {
    await withTaoFixture({
      'node_modules/expo-replace/package.json': JSON.stringify({
        name: 'expo-replace',
        version: '1.0.0',
        types: 'index.d.ts',
      }),
      'node_modules/expo-replace/index.d.ts': 'export declare function oldPulse(): void;',
      'Native/Feedback.tao': 'use NewPulse from ./Generated/Bindings.tao\naction Feedback() { do NewPulse() }\n',
    }, async root => {
      const options = { source: 'expo', from: root, out: FS.resolvePath('Native/Generated', root) }
      const customPath = FS.resolvePath('Native/Feedback.tao', root)
      const custom = await FS.readText(customPath)
      await generateNativeBindingFiles('expo-replace', options)
      await FS.writeText(FS.resolvePath('Bindings.ts', options.out), 'handwritten edits must be discarded')
      await FS.writeText(FS.resolvePath('stale.ts', options.out), 'obsolete generated file')
      await FS.writeText(FS.resolvePath('old/stale.ts', options.out), 'obsolete nested generated file')
      await FS.writeJson(FS.resolvePath('node_modules/expo-replace/package.json', root), {
        name: 'expo-replace',
        version: '2.0.0',
        types: 'index.d.ts',
      })
      await FS.writeText(
        FS.resolvePath('node_modules/expo-replace/index.d.ts', root),
        'export declare function newPulse(strength?: number): Promise<void>;',
      )

      await generateNativeBindingFiles('expo-replace', options)

      Expect(await FS.readText(FS.resolvePath('Bindings.tao', options.out)))
        .toContain('public action NewPulse(Strength number? default none) from ./Bindings.ts')
      Expect(await FS.readText(FS.resolvePath('Bindings.tao', options.out))).not.toContain('OldPulse')
      Expect(await FS.readText(FS.resolvePath('Bindings.ts', options.out))).toContain('return native()["newPulse"]()')
      Expect(await FS.readText(FS.resolvePath('bindings.json', options.out))).toContain('"packageVersion": "2.0.0"')
      Expect(await FS.exists(FS.resolvePath('stale.ts', options.out))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('old/stale.ts', options.out))).toBe(false)
      Expect(await FS.readText(customPath)).toBe(custom)

      const workingBinding = await FS.readText(FS.resolvePath('Bindings.ts', options.out))
      await FS.writeText(
        FS.resolvePath('node_modules/expo-replace/index.d.ts', root),
        'export declare function unsupported(): { value: number };',
      )
      await Expect(generateNativeBindingFiles('expo-replace', options)).rejects.toThrow(
        'Cannot generate the complete binding',
      )
      Expect(await FS.readText(FS.resolvePath('Bindings.ts', options.out))).toBe(workingBinding)
      Expect(await FS.readText(customPath)).toBe(custom)
      Expect((await FS.listDir(FS.dirname(options.out))).sort()).toEqual(['Feedback.tao', 'Generated'])
    })
  })

  Test('refuses to replace an unrelated directory or follow a generated-directory symlink', async () => {
    await withTaoFixture({ 'Manual/keep.txt': 'keep this file' }, async root => {
      const manual = FS.resolvePath('Manual', root)
      const options = { source: 'expo', from: fromDirectory, out: manual }
      await Expect(generateNativeBindingFiles('expo-haptics', options)).rejects.toThrow(
        'not a generated binding directory',
      )
      Expect(await FS.readText(FS.resolvePath('keep.txt', manual))).toBe('keep this file')

      const generated = FS.resolvePath('Generated', root)
      await generateNativeBindingFiles('expo-haptics', { ...options, out: generated })
      const link = FS.resolvePath('Linked', root)
      await FS.symlink(generated, link)
      await Expect(generateNativeBindingFiles('expo-haptics', { ...options, out: link })).rejects.toThrow('symlink')
      Expect(await FS.isSymbolicLink(link)).toBe(true)
      Expect(await FS.readText(FS.resolvePath('Bindings.tao', generated))).toContain('PerformAndroidHapticsAsync')
    })
  })

  Test('rechecks ownership when an unrelated file appears during generation', async () => {
    await withTaoFixture({
      'node_modules/expo-race/package.json': JSON.stringify({
        name: 'expo-race',
        version: '1.0.0',
        types: 'index.d.ts',
      }),
      'node_modules/expo-race/index.d.ts': 'export declare function pulse(): void;',
    }, async root => {
      const out = FS.resolvePath('Generated', root)
      const read = ExpoApiSource.read
      const restore = sourceReadSlot.install(async request => {
        const result = await read(request)
        if (request.fromDirectory === root) {
          await FS.writeText(FS.resolvePath('Manual.tao', out), 'action Manual() { }')
        }
        return result
      })
      try {
        await Expect(generateNativeBindingFiles('expo-race', { source: 'expo', from: root, out }))
          .rejects.toThrow('not a generated binding directory')
        Expect(await FS.readText(FS.resolvePath('Manual.tao', out))).toBe('action Manual() { }')
        Expect(await FS.listDir(out)).toEqual(['Manual.tao'])
      } finally {
        restore()
      }
    })
  })
})

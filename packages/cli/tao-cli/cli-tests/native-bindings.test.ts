import { ExpoApiSource, type NativeApiSource, NativeBindings, ReactNativeApiSource } from '@compiler/native-bindings'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { generateNativeBindingFiles } from '../cli-src/native-bindings/native-binding-command'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, runTaoCliForTest, withTaoFixture } from './test-cli-files'

const fromDirectory = Repo.resolvePath('packages/apps/expo-host')

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

  Test('lets only one concurrent generator claim the output directory', async () => {
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
      Expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
      Expect(await FS.readText(FS.resolvePath('Bindings.ts', options.out))).toContain('native()["pulse"]()')
    })
  })

  Test('writes bindings through the CLI and refuses to overwrite an existing output directory', async () => {
    await withTaoFixture(checkedProjectFile, async root => {
      const out = FS.resolvePath('Generated', root)
      const args = ['bridge', 'expo-haptics', '--source', 'expo', '--from', fromDirectory, '--out', out]
      const generated = await runTaoCliForTest(args)
      Expect(generated.exitCode).toBe(0)
      Expect(generated.stdout).toContain('Generated native bindings')
      const path = FS.resolvePath('Bindings.tao', out)
      const original = await FS.readText(path)
      Expect(original).toContain('PerformAndroidHapticsAsync')
      const repeated = await runTaoCliForTest(args)
      Expect(repeated.exitCode).toBe(1)
      Expect(repeated.stderr).toContain('already exists')
      Expect(await FS.readText(path)).toBe(original)
    })
  })
})

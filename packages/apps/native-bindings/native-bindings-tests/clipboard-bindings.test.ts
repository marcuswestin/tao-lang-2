import { ExpoApiSource, generateNativeBindingFiles, NativeBindings } from '@native-bindings'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

const request = {
  source: ExpoApiSource,
  packageName: 'expo-clipboard',
  fromDirectory: Repo.resolvePath('packages/apps/expo-host'),
  exclude: ['ClipboardPasteButton', 'isPasteButtonAvailable'],
}

Describe('generated Clipboard contracts', () => {
  Test('extracts every text, image, URL and listener operation from installed declarations', async () => {
    const generated = await NativeBindings.generate(request)
    Expect(generated.diagnostics).toEqual([])
    Expect(generated.catalog.operations.map(operation => operation.name)).toEqual([
      'addClipboardListener',
      'getImageAsync',
      'getStringAsync',
      'getUrlAsync',
      'hasImageAsync',
      'hasStringAsync',
      'hasUrlAsync',
      'removeClipboardListener',
      'setImageAsync',
      'setStringAsync',
      'setUrlAsync',
    ])
    Expect(generated.catalog.excluded).toEqual(['ClipboardPasteButton', 'isPasteButtonAvailable'])
    for (
      const operation of [
        { name: 'getStringAsync', result: { kind: 'primitive', name: 'text' }, asynchronous: true },
        { name: 'setStringAsync', result: { kind: 'primitive', name: 'boolean' }, asynchronous: true },
      ]
    ) {
      Expect(generated.catalog.operations.find(candidate => candidate.name === operation.name)).toMatchObject(operation)
    }
    for (
      const record of [
        {
          name: 'GetImageOptions',
          fields: [
            { name: 'format', optional: false, type: { kind: 'enum', name: 'GetImageOptionsFormat' } },
            { name: 'jpegQuality', optional: true, type: { kind: 'primitive', name: 'number' } },
          ],
        },
        {
          name: 'ClipboardImage',
          fields: [
            { name: 'data', optional: false, type: { kind: 'primitive', name: 'text' } },
            { name: 'size', optional: false, type: { kind: 'record', name: 'ClipboardImageSize' } },
          ],
        },
        { name: 'EventSubscription', disposal: 'remove' },
      ]
    ) {
      Expect(generated.catalog.records?.find(candidate => candidate.name === record.name)).toMatchObject(record)
    }
    Expect(generated.files['Bindings.tao']).toContain('returns text from ./Bindings.ts')
    Expect(generated.files['Bindings.tao']).toContain('returns ClipboardImage? from ./Bindings.ts')
    Expect(generated.files['Bindings.tao']).toContain('Listener action(ClipboardEvent)')
    Expect(generated.files['Bindings.tao']).toContain('public type EventSubscription is {')
    Expect((await NativeBindings.generate(request)).files).toEqual(generated.files)
  })

  Test('keeps unsupported exports explicit and rejects exclusions that no longer exist', async () => {
    const complete = await NativeBindings.generate({ ...request, exclude: undefined })
    Expect(complete.diagnostics.map(diagnostic => diagnostic.symbol)).toEqual([
      'isPasteButtonAvailable',
      'ClipboardPasteButton',
    ])
    await Expect(NativeBindings.generate({ ...request, exclude: ['MisspelledExport'] }))
      .rejects.toThrow('MisspelledExport')
    await withTaoFiles('clipboard-bindings', {}, async (_paths, root) => {
      await Expect(generateNativeBindingFiles('expo-clipboard', {
        source: 'expo',
        from: request.fromDirectory,
        out: root,
      })).rejects.toThrow('Cannot generate the complete binding')
    }, { location: 'host', verbatim: true })
  })

  Test('rejects recursive, generic and unowned callback shapes without leaking partial types', async () => {
    await withTaoFiles('native-value-shapes', {
      'node_modules/expo-shapes/package.json': JSON.stringify({
        name: 'expo-shapes',
        version: '1',
        types: 'index.d.ts',
      }),
      'node_modules/expo-shapes/index.d.ts': `
        export type Recursive = { next: Recursive };
        export type EventSubscription = { remove(): void };
        export declare function recursive(): Recursive;
        export declare function generic(): Map<string, number>;
        export declare function unowned(listener: (value: string) => void): EventSubscription;
        export declare function callback(): () => void;
        export declare function optionalCallback(listener: (value?: string) => void): EventSubscription;
        export declare function callbackList(): Array<() => void>;
        export declare function callbackRecord(): { callback: (() => void) | null };
        export declare function undefinedResult(): Promise<string | undefined>;
        export declare function undefinedElement(): Array<string | undefined>;
        export declare function supported(): { count: number; label?: string };
      `,
    }, async (_paths, root) => {
      const generated = await NativeBindings.generate({
        source: ExpoApiSource,
        packageName: 'expo-shapes',
        fromDirectory: root,
      })
      Expect(generated.catalog.operations.map(operation => operation.name)).toEqual(['supported'])
      Expect(generated.catalog.records?.map(record => record.name)).toEqual(['SupportedResult'])
      Expect(generated.diagnostics.map(diagnostic => diagnostic.symbol).sort()).toEqual([
        'callback',
        'callbackList',
        'callbackRecord',
        'generic',
        'optionalCallback',
        'recursive',
        'undefinedElement',
        'undefinedResult',
        'unowned',
      ])
      Expect(generated.files['Bindings.tao']).not.toContain('EventSubscription')
    }, { location: 'host', verbatim: true })
  })

  Test('accepts only direct resources with the required adapter-declared disposal contract', async () => {
    await withTaoFiles('native-resource-shapes', {
      'node_modules/expo-shapes/package.json': JSON.stringify({
        name: 'expo-shapes',
        version: '1',
        types: 'index.d.ts',
      }),
      'node_modules/expo-modules-core/package.json': JSON.stringify({
        name: 'expo-modules-core',
        version: '1',
        types: 'index.d.ts',
      }),
      'node_modules/expo-modules-core/index.d.ts': 'export type EventSubscription = { remove(): void };',
      'node_modules/expo-shapes/index.d.ts': `
        import type { EventSubscription } from 'expo-modules-core';
        export declare function direct(listener: (text: string) => void): EventSubscription;
        export declare function list(): EventSubscription[];
        export declare function nullable(): EventSubscription | null;
        export declare function nested(): { subscription: EventSubscription };
      `,
    }, async (_paths, root) => {
      const request = { source: ExpoApiSource, packageName: 'expo-shapes', fromDirectory: root }
      const generated = await NativeBindings.generate(request)
      Expect(generated.catalog.operations.map(operation => operation.name)).toEqual(['direct'])
      Expect(generated.diagnostics.map(diagnostic => diagnostic.symbol).sort()).toEqual(['list', 'nested', 'nullable'])
      await FS.writeText(
        FS.resolvePath('node_modules/expo-modules-core/index.d.ts', root),
        'export type EventSubscription = { remove?(): void };',
      )
      const changed = await NativeBindings.generate(request)
      Expect(changed.catalog.operations).toEqual([])
      Expect(changed.diagnostics.find(diagnostic => diagnostic.symbol === 'direct')?.reason).toContain(
        'required remove()',
      )
    }, { location: 'host', verbatim: true })
  })
})

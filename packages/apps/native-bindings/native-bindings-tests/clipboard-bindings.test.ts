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
    Expect(generated.files['Bindings.tao']).toContain('public\ntype EventSubscription is {')
    Expect((await NativeBindings.generate(request)).files).toEqual(generated.files)
  })

  Test('keeps unsupported exports explicit and rejects exclusions that no longer exist', async () => {
    const complete = await NativeBindings.generate({ ...request, exclude: undefined })
    Expect(complete.diagnostics.map(diagnostic => diagnostic.symbol)).toEqual([
      'ClipboardPasteButton',
    ])
    Expect(complete.catalog.operations.find(operation => operation.name === 'isPasteButtonAvailableGet')).toMatchObject(
      { result: { kind: 'primitive', name: 'boolean' } },
    )
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

  Test(
    'retains supported absences and exposes unsupported reached methods without leaking rejected records',
    async () => {
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
        const fixtureRequest = {
          source: ExpoApiSource,
          packageName: 'expo-shapes',
          fromDirectory: root,
        }
        const reflected = await ExpoApiSource.read(fixtureRequest)
        Expect(reflected.catalog.operations.find(operation => operation.name === 'undefinedElement')?.result).toEqual({
          kind: 'list',
          element: { kind: 'nullable', value: { kind: 'primitive', name: 'text' }, absence: 'undefined' },
        })
        await Expect(NativeBindings.generate(fixtureRequest)).rejects.toThrow(
          "Native operation 'undefinedElement' ((): Array<string | undefined>) cannot represent type 'Array<string | undefined>' in Tao: nullable type 'string | undefined' occurs in list element.",
        )
        const generated = await NativeBindings.generate({ ...fixtureRequest, exclude: ['undefinedElement'] })
        Expect(generated.catalog.operations.find(operation => operation.name === 'supported')?.result).toEqual({
          kind: 'record',
          name: 'SupportedResult',
        })
        Expect(generated.catalog.operations.find(operation => operation.name === 'undefinedResult')?.result).toEqual({
          kind: 'nullable',
          value: { kind: 'primitive', name: 'text' },
          absence: 'undefined',
        })
        Expect(generated.files['Bindings.ts']).toContain('=== undefined')
        Expect(generated.catalog.operations.find(operation => operation.name === 'generic')?.result).toEqual({
          kind: 'reference',
          name: 'MapStringNumber',
        })
        Expect(generated.catalog.operations.some(operation => operation.name === 'MapStringNumberForEach')).toBe(false)
        Expect(generated.diagnostics.find(diagnostic => diagnostic.symbol === 'MapStringNumber.forEach')).toMatchObject(
          { reason: 'Callback operations must return a supported owned subscription.' },
        )
        Expect(
          generated.diagnostics.filter(diagnostic => /^(Map|IteratorObject)/.test(diagnostic.symbol)).map(diagnostic =>
            diagnostic.symbol
          ).sort(),
        ).toEqual([
          ...[
            'MapIteratorNumber',
            'MapIteratorString',
            'MapIteratorStringNumber',
            'IteratorObjectNumberUndefinedUnknown',
            'IteratorObjectStringUndefinedUnknown',
            'IteratorObjectStringNumberUndefinedUnknown',
          ].flatMap(owner =>
            [
              'every',
              'filter',
              'filter',
              'find',
              'find',
              'flatMap',
              'forEach',
              'map',
              'reduce',
              'reduce',
              'reduce',
              'some',
            ].map(member => `${owner}.${member}`)
          ),
          'MapStringNumber.forEach',
        ].sort())
        for (
          const owner of [
            'MapIteratorNumber',
            'MapIteratorString',
            'MapIteratorStringNumber',
            'IteratorObjectNumberUndefinedUnknown',
            'IteratorObjectStringUndefinedUnknown',
            'IteratorObjectStringNumberUndefinedUnknown',
          ]
        ) {
          const next = generated.catalog.operations.find(operation => operation.provenance?.symbol === `${owner}.next`)
          Expect(next?.parameters[1]).toMatchObject({ name: 'argument1', rest: true })
          Expect(next?.target).toEqual({ kind: 'method', receiver: { kind: 'reference', name: owner }, member: 'next' })
        }
        for (const owner of ['MapIteratorStringNumber', 'IteratorObjectStringNumberUndefinedUnknown']) {
          for (const member of ['return', 'throw', 'toArray']) {
            Expect(
              generated.catalog.operations.some(operation => operation.provenance?.symbol === `${owner}.${member}`),
            )
              .toBe(true)
          }
          const result = generated.catalog.operations.find(operation =>
            operation.provenance?.symbol === `${owner}.toArray`
          )?.result
          Expect(result?.kind).toBe('list')
          if (result?.kind !== 'list' || result.element.kind !== 'record') {
            throw Error('Expected tuple list result')
          }
          const tupleName = result.element.name
          Expect(generated.catalog.records?.find(record => record.name === tupleName)).toMatchObject({
            tuple: true,
            fields: [
              { name: 'item0', optional: false, type: { kind: 'primitive', name: 'text' } },
              { name: 'item1', optional: false, type: { kind: 'primitive', name: 'number' } },
            ],
          })
        }
        Expect(generated.catalog.records?.map(record => record.name)).toContain('SupportedResult')
        Expect(
          generated.catalog.records?.some(record => record.name === 'Recursive' || record.name === 'EventSubscription'),
        ).toBe(false)
        Expect(
          generated.diagnostics.map(diagnostic => diagnostic.symbol).filter(symbol =>
            !/^(Map|IteratorObject)/.test(symbol)
          )
            .sort(),
        ).toEqual([
          'callback',
          'callbackList',
          'callbackRecord',
          'optionalCallback',
          'recursive',
          'unowned',
        ])
        Expect(generated.files['Bindings.tao']).not.toContain('EventSubscription')
      }, { location: 'host', verbatim: true })
    },
  )

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

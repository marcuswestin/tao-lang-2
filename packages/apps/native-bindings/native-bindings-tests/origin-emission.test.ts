import { ExpoApiSource, generateNativeBindingFiles, NativeBindings } from '@native-bindings'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import type { NativeApiCatalog, NativeApiResolvedInput, NativeApiSource } from '../native-bindings-src/native-api'

const referenceOrigin = {
  packageName: 'native-fixture',
  declaration: 'refs.d.ts',
  line: 12,
  column: 3,
  symbol: 'Handle',
}
const operationOrigin = {
  packageName: 'native-fixture',
  declaration: 'operations.d.ts',
  line: 7,
  column: 5,
  symbol: 'ping',
}
const catalog: NativeApiCatalog = {
  source: 'origin-fixture',
  packageName: 'native-fixture',
  packageVersion: '1',
  declaration: 'index.d.ts',
  declarationHash: 'fixture',
  enums: [],
  references: [{ name: 'Handle', typescript: 'object', methods: [], provenance: referenceOrigin }],
  listeners: [{
    name: 'Listener',
    typescript: '() => void',
    parameters: [],
    returnContract: 'void',
    provenance: referenceOrigin,
  }],
  operations: [{
    name: 'ping',
    parameters: [],
    asynchronous: false,
    platforms: [],
    target: { kind: 'call', path: ['ping'] },
    provenance: operationOrigin,
  }, {
    name: 'start',
    parameters: [],
    asynchronous: true,
    platforms: [],
    target: { kind: 'call', path: ['start'] },
    provenance: operationOrigin,
    pending: { name: 'ResultPending', result: { kind: 'primitive', name: 'text' } },
  }],
}

function source(root: string, physical = true): NativeApiSource {
  const resolvedInputs: NativeApiResolvedInput[] = [referenceOrigin, operationOrigin].map(origin => ({
    packageName: origin.packageName,
    packageVersion: '1',
    declaration: origin.declaration,
    hash: 'fixture',
    packageRoot: FS.resolvePath('installed/node_modules/native-fixture', root),
    filePath: FS.resolvePath(`installed/node_modules/native-fixture/${origin.declaration}`, root),
  }))
  return {
    name: catalog.source,
    async read() {
      return { catalog, diagnostics: [], ...(physical ? { resolvedInputs } : {}) }
    },
  }
}

const withoutPhysicalOrigins = (text: string) => text.replace(/^\/\/ Native origin: .*\n/gm, '')

Describe('physical native origin emission', () => {
  Test('renders references and operations against independent Tao and TypeScript directories', async () => {
    await withTaoFiles('native-origins', {}, async (_paths, root) => {
      const generated = await NativeBindings.generate({
        source: source(root),
        packageName: catalog.packageName,
        fromDirectory: root,
        taoOriginDirectory: FS.resolvePath('api', root),
        typescriptOriginDirectory: FS.resolvePath('implementation/deep', root),
      })
      Expect(generated.files['Bindings.tao']).toContain(
        '// Native origin: ../installed/node_modules/native-fixture/refs.d.ts:12:3\npublic\ntype Handle',
      )
      Expect(generated.files['Bindings.ts']).toContain(
        '// Native origin: ../../installed/node_modules/native-fixture/refs.d.ts:12:3\ntype NativeHandle',
      )
      Expect(generated.files['Bindings.tao']).toContain(
        '// Native origin: ../installed/node_modules/native-fixture/operations.d.ts:7:5\npublic\naction Ping',
      )
      Expect(generated.files['Bindings.ts']).toContain(
        '// Native origin: ../../installed/node_modules/native-fixture/operations.d.ts:7:5\nexport function Ping',
      )
      Expect(generated.files['Bindings.tao']).toContain('// Source: native-fixture/operations.d.ts:7:5')
      Expect(generated.catalog).toEqual(catalog)
      Expect(generated.files['bindings.json']).not.toContain(root)
      const unlinked = await NativeBindings.generate({
        source: source(root),
        packageName: catalog.packageName,
        fromDirectory: root,
        originDeclaration: () => undefined,
      })
      for (const name of ['Bindings.tao', 'Bindings.ts', 'bindings.json']) {
        Expect(withoutPhysicalOrigins(generated.files[name]!)).toBe(unlinked.files[name])
      }
    })
  })

  Test('maps captured payloads and derived declarations to portable paths after relocation', async () => {
    await withTaoFiles('captured-native-origins', {}, async (_paths, root) => {
      async function generate(distribution: string) {
        const generated = await NativeBindings.generate({
          source: source(root),
          packageName: catalog.packageName,
          fromDirectory: root,
          taoOriginDirectory: FS.resolvePath('stdlib/@tao/device/capability', distribution),
          typescriptOriginDirectory: FS.resolvePath('stdlib/.tao-ts/native-bindings/capability', distribution),
          originDeclaration: provenance =>
            FS.resolvePath(
              `stdlib/.tao-ts/native-bindings/capability/inputs/node_modules/${provenance.packageName}/${provenance.declaration}`,
              distribution,
            ),
        })
        const tao = generated.files['Bindings.tao']!
        for (
          const declaration of [
            'public type Handle',
            'public action ReleaseHandle',
            'public type Listener',
            'public action CreateListener',
            'public action ReleaseListener',
          ]
        ) {
          Expect(tao).toContain(
            `// Native origin: ../../../.tao-ts/native-bindings/capability/inputs/node_modules/native-fixture/refs.d.ts:12:3\n${
              declaration.replace('public ', 'public\n')
            }`,
          )
        }
        for (
          const declaration of [
            'public type ResultPending',
            'public action ResultPendingStatus',
            'public action ResultPendingResult',
            'public action ReleaseResultPending',
            'public action ObserveResultPending',
          ]
        ) {
          Expect(tao).toContain(
            `// Native origin: ../../../.tao-ts/native-bindings/capability/inputs/node_modules/native-fixture/operations.d.ts:7:5\n${
              declaration.replace('public ', 'public\n')
            }`,
          )
        }
        Expect(generated.files['Bindings.ts']).toContain(
          '// Native origin: ./inputs/node_modules/native-fixture/operations.d.ts:7:5',
        )
        return generated.files
      }
      Expect(await generate(FS.resolvePath('original', root))).toEqual(
        await generate(FS.resolvePath('relocated', root)),
      )
    })
  })

  Test('leaves logical-only catalogs unlinked and rejects unsafe physical references', async () => {
    await withTaoFiles('native-origin-validation', {}, async (_paths, root) => {
      const request = { source: source(root, false), packageName: catalog.packageName, fromDirectory: root }
      const generated = await NativeBindings.generate(request)
      Expect(generated.files['Bindings.tao']).not.toContain('// Native origin:')
      Expect(generated.files['Bindings.tao']).toContain('// Source: native-fixture/refs.d.ts:12:3')
      for (const path of ['relative/index.d.ts', `${root}/bad\nindex.d.ts`]) {
        await Expect(NativeBindings.generate({ ...request, originDeclaration: () => path })).rejects.toThrow(
          'absolute declaration path without line breaks',
        )
      }
    })
  })

  Test('writes generic physical origins relative to both published output roots', async () => {
    await withTaoFiles('native-origin-writer', {
      'node_modules/expo-origin/package.json': JSON.stringify({
        name: 'expo-origin',
        version: '1',
        types: 'index.d.ts',
      }),
      'node_modules/expo-origin/index.d.ts': "export { ping } from './public';\n",
      'node_modules/expo-origin/public.d.ts': '\nexport declare function ping(): void;\n',
    }, async (_paths, root) => {
      const out = FS.resolvePath('api', root)
      const typescriptOut = FS.resolvePath('implementation/deep', root)
      await generateNativeBindingFiles('expo-origin', { source: ExpoApiSource.name, from: root, out, typescriptOut })
      Expect(await FS.readText(FS.resolvePath('Bindings.tao', out))).toContain(
        '// Native origin: ../node_modules/expo-origin/public.d.ts:2:1',
      )
      Expect(await FS.readText(FS.resolvePath('Bindings.ts', typescriptOut))).toContain(
        '// Native origin: ../../node_modules/expo-origin/public.d.ts:2:1',
      )
    }, { verbatim: true })
  })
})

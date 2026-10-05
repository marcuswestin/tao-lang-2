import { ExpoApiSource, NativeBindings } from '@native-bindings'
import { Assert, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('native declaration signature relocation', () => {
  Test('emits identical catalogs and provenance for reexported constructors in independent install roots', async () => {
    const packageName = 'native-signature'
    const packageFiles = {
      'package.json': JSON.stringify({ name: packageName, version: '1.0.0', types: 'index.d.ts' }),
      'index.d.ts':
        'import { Resource as BaseResource } from "./Resource";\nexport declare class Resource extends BaseResource {}\n',
      'Resource.d.ts':
        'export declare class Resource {\n  constructor(id: string, label?: "import(\\"/literal/sentinel\\")");\n  read(): string;\n}\n',
    }
    const files = Object.fromEntries(
      ['first', 'second'].flatMap(directory =>
        Object.entries(packageFiles).map((
          [path, contents],
        ) => [`${directory}/node_modules/${packageName}/${path}`, contents])
      ),
    )
    await withTaoFiles('native-signature-relocation', files, async (_paths, root) => {
      async function generate(directory: string) {
        const result = await NativeBindings.generate({
          source: ExpoApiSource,
          packageName,
          fromDirectory: FS.resolvePath(directory, root),
        })
        Expect(result.diagnostics).toEqual([])
        const constructor = result.catalog.operations.find(operation => operation.target?.kind === 'construct')
        Assert.defined(constructor, 'the relocated package constructor is generated')
        Expect(constructor.provenance).toMatchObject({
          packageName,
          declaration: 'Resource.d.ts',
          line: 2,
          column: 3,
          signature:
            '(id: string, label?: "import(\\"/literal/sentinel\\")"): import("native-signature/index").Resource',
        })
        Expect(JSON.stringify(result.catalog)).not.toContain(root)
        Expect(result.files['Bindings.tao']).toContain(
          '// Native origin: ./node_modules/native-signature/Resource.d.ts:2:3',
        )
        return result
      }
      const first = await generate('first')
      const second = await generate('second')
      Expect(JSON.stringify(first.catalog)).toBe(JSON.stringify(second.catalog))
      Expect(first.files).toEqual(second.files)
    }, { verbatim: true })
  })
})

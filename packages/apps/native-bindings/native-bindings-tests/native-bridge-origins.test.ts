import { FS, Platform } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { maintainedNativeSources } from '../native-bindings-src/maintained-native-sources'
import { readMaintainedNativeBridgeTypeOrigins } from '../native-bindings-src/read-native-bridge-types'

Describe('verified maintained native bridge type origins', () => {
  Test(
    'reads descriptor metadata without loading implementations and rejects stale or malformed metadata',
    async () => {
      await withTaoFiles('native-bridge-origins', {}, async (_paths, root) => {
        const outputPaths: string[] = []
        const names = ['Resource', 'ResourceListener']
        const populate = async (capability: string, bridgeTypes: unknown = names) => {
          const directory = FS.resolvePath(`.tao-ts/native-bindings/${capability}`, root)
          const metadata = JSON.stringify({ schemaVersion: 1, bridgeTypes })
          const files = {
            [FS.resolvePath(`@tao/device/${capability}/Bindings.tao`, root)]: 'public type Resource is item',
            [FS.resolvePath('Bindings.ts', directory)]:
              'import { Assert } from "@shared"; Assert(false, "Implementations must never load during type-origin inspection")',
            [FS.resolvePath('bindings.json', directory)]: metadata,
            [FS.resolvePath('maintained.json', directory)]: JSON.stringify({
              outputs: [{ path: 'typescript/bindings.json', hash: Platform.sha256Hex(metadata) }],
            }),
          }
          for (const [path, contents] of Object.entries(files)) {
            await FS.writeText(path, contents)
            if (!outputPaths.includes(path)) {
              outputPaths.push(path)
            }
          }
        }
        for (const source of maintainedNativeSources) {
          await populate(source.capability)
        }
        const inspection = {
          status: 'fresh' as const,
          diagnostics: [],
          inputPaths: [],
          outputPaths,
          identity: 'checked-by-caller',
        }
        const options = { stdlibRoot: root, inspection }
        const origins = await readMaintainedNativeBridgeTypeOrigins(options)
        Expect(origins).toHaveLength(maintainedNativeSources.length * names.length)
        for (const source of maintainedNativeSources) {
          for (const name of names) {
            Expect(origins).toContainEqual({
              sourcePath: FS.resolvePath(`@tao/device/${source.capability}/Bindings.tao`, root),
              name,
              implementationPath: FS.resolvePath(`.tao-ts/native-bindings/${source.capability}/Bindings.ts`, root),
              exportName: 'NativeTypes',
              memberName: name,
            })
          }
        }
        await Expect(
          readMaintainedNativeBridgeTypeOrigins({ ...options, inspection: { ...inspection, status: 'stale' } }),
        ).rejects.toThrow('bridge types are stale')
        await Expect(
          readMaintainedNativeBridgeTypeOrigins({ ...options, inspection: { ...inspection, outputPaths: [] } }),
        ).rejects.toThrow('not verified')
        const capability = maintainedNativeSources[0]!.capability
        const path = FS.resolvePath(`.tao-ts/native-bindings/${capability}/bindings.json`, root)
        await FS.writeText(path, JSON.stringify({ schemaVersion: 1, bridgeTypes: [] }))
        await Expect(readMaintainedNativeBridgeTypeOrigins(options)).rejects.toThrow('changed after inspection')
        for (const malformed of [['Resource', 'Resource'], ['bad-name'], [3]]) {
          await populate(capability, malformed)
          await Expect(readMaintainedNativeBridgeTypeOrigins(options)).rejects.toThrow(
            'Invalid native bridge type names',
          )
        }
      })
    },
  )
})

import { FS, Repo } from '@shared'
import { mkTestDir } from '@shared/test'

// Import unchanged authored sidecars outside the app's installed dependencies and generated
// configuration. The fixture maps the public package name to this checkout's real runtime.
export const syntax2Library = await mkTestDir('syntax2-runtime-sidecars')
await FS.writeJson(FS.resolvePath('tsconfig.json', syntax2Library), {
  compilerOptions: {
    paths: { '@tao/runtime': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts')] },
  },
})
for (const name of ['BookBackend.ts', 'BookStoreProvider.ts', 'BookIO.ts', 'GroupedRows.ts']) {
  await FS.writeText(
    FS.resolvePath(name, syntax2Library),
    await FS.readText(Repo.resolvePath(`Apps/Syntax2/library/${name}`)),
  )
}

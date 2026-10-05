import { inspectMaintainedNativeBindings } from '@native-bindings'
import { Assert, FS, Repo, TaoStdlib } from '@shared'

/** Copy the verified installation payload; every mutation stays inside the test's own roots. */
export async function copyMaintainedBindingPayload(stdlibRoot: string, sourceRoot?: string): Promise<void> {
  const installedRoot = TaoStdlib.declaredRoot() ?? Repo.resolvePath('packages/apps/stdlib')
  const inspection = await inspectMaintainedNativeBindings()
  Assert.input(inspection.status === 'fresh', inspection.diagnostics.map(item => item.message).join('\n'))
  for (const path of inspection.outputPaths) {
    await FS.writeText(FS.resolvePath(FS.relativePath(installedRoot, path), stdlibRoot), await FS.readText(path))
  }
  if (sourceRoot !== undefined) {
    for (const capability of ['photos', 'files']) {
      await FS.copyDirectory(
        FS.resolvePath(`.tao-ts/native-bindings/${capability}/inputs/node_modules`, stdlibRoot),
        FS.resolvePath('node_modules', sourceRoot),
      )
    }
  }
}

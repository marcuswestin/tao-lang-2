/** Isolated faults exercise real preview publication and recovery independently of the host UID. */
import { Assert, Errors, FS, HCI, Platform } from '@shared'
import { MockModule } from '@shared/test'

const [mode, runtimePackageRoot, appPath] = Platform.runtimeProcess.argv.slice(2)
Assert(mode === 'cleanup' || mode === 'stable-order' || mode === 'migration-order', 'A rollback scenario is named.')
Assert.defined(runtimePackageRoot, 'A runtime package root is supplied.')
Assert.defined(appPath, 'An app source path is supplied.')
const outputRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
const injectionPath = FS.resolvePath('App.injection-1.tsx', outputRoot)
const publicationPath = FS.resolvePath('TaoStudioPublication.ts', outputRoot)
const stalePath = FS.resolvePath('obsolete/stale.ts', outputRoot)
const originalFs = { ...FS }
let faultsEnabled = false
const faults: string[] = []
let cleanupInjection = ''
let cleanupPublication = ''

MockModule(new URL('../../../../shared/shared-src/FS.ts', import.meta.url).pathname, () => ({
  ...originalFs,
  async remove(path: string) {
    if (faultsEnabled && path === stalePath) {
      faults.push('cleanup')
      cleanupInjection = await originalFs.readText(injectionPath)
      cleanupPublication = await originalFs.readText(publicationPath)
      Errors.throwHostEnvironment('EACCES: injected preview cleanup failure')
    }
    await originalFs.remove(path)
  },
  async writeText(...args: Parameters<typeof FS.writeText>) {
    if (faultsEnabled && mode !== 'cleanup' && args[0] === `${injectionPath}.tao-rollback`) {
      faults.push('graph rollback')
      Errors.throwHostEnvironment('EACCES: injected graph rollback failure')
    }
    await originalFs.writeText(...args)
  },
}))

const { default: Runtime } = await import('@expo-host')
const preview = (revision: number) => ({
  project: '/workspace/preview-project',
  revision,
  sourceVersions: { 'Main.tao': `text-v${revision}` },
})
if (mode === 'migration-order') {
  await FS.writeText(FS.resolvePath('App.tsx', outputRoot), "export { default } from './current/TaoApp'\n")
  await FS.writeText(FS.resolvePath('current/TaoApp.tsx', outputRoot), 'export default null\n')
  await FS.writeText(injectionPath, 'export default null\n')
} else {
  await Runtime.generateApp(appPath, { preview: preview(2), runtimePackageRoot })
}
await FS.writeText(stalePath, 'stale\n')
const initialGraph = await graph()
if (mode !== 'migration-order') {
  await FS.writeText(
    appPath,
    'app Preview { id "preview" version "1.0.0" name "Preview" view Main }\nview Main() { render inject ```ts return <RN.Text>After</RN.Text> ``` }',
  )
}
const revision = mode === 'migration-order' ? 1 : 3
let failure = ''
faultsEnabled = true
try {
  await Runtime.generateApp(appPath, { preview: preview(revision), runtimePackageRoot })
} catch (error) {
  failure = Errors.messageOf(error)
} finally {
  faultsEnabled = false
}
const failedGraph = await graph()
const recovered = await Runtime.generateApp(appPath, { preview: preview(revision), runtimePackageRoot })
const recoveredGraph = await graph()
await Runtime.resetStudioPreviewSession({ runtimePackageRoot })
HCI.writeLine(JSON.stringify({
  initialGraph,
  failedGraph,
  recoveredGraph,
  failure,
  faults,
  cleanupInjection,
  cleanupPublication,
  recoveredRevision: recovered.previewRevision,
}))

async function graph(): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for await (const path of FS.walk(outputRoot)) {
    files[FS.relativePath(outputRoot, path)] = await FS.isFile(path)
      ? await FS.readText(path)
      : `-> ${FS.relativePath(outputRoot, await FS.realPath(path))}`
  }
  return files
}

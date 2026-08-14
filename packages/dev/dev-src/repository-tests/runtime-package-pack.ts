import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

type RuntimeManifest = Record<string, unknown> & {
  private?: boolean
  version?: string
}

const packCheckVersion = '0.0.0-pack-check'

/** checkRuntimePackagePack validates the private runtime payload with temporary release metadata. */
export async function checkRuntimePackagePack(): Promise<string> {
  const runtimeRoot = Repo.resolvePath('packages/runtime')
  const packRoot = await FS.mkTmpDir(FS.resolvePath('tao-runtime-pack-', FS.tmpdir()))

  try {
    const manifest = await FS.readJson<RuntimeManifest>(FS.resolvePath('package.json', runtimeRoot))
    await Promise.all([
      FS.copyDirectory(
        FS.resolvePath('TaoRuntime-src', runtimeRoot),
        FS.resolvePath('TaoRuntime-src', packRoot),
      ),
      FS.writeJson(FS.resolvePath('package.json', packRoot), {
        ...manifest,
        private: false,
        version: packCheckVersion,
      }),
    ])
    const result = await CLI.mustRun('bun', {
      args: ['pm', 'pack', '--dry-run', '--ignore-scripts'],
      cwd: packRoot,
    })
    return result.stdout
  } finally {
    await FS.remove(packRoot)
  }
}

async function run(): Promise<void> {
  try {
    HCI.write(await checkRuntimePackagePack())
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForLog(error))
    Platform.runtimeProcess.setExitCode(1)
  }
}

if (import.meta.main) {
  await run()
}

import Runtime, { RuntimeToolchainPaths, type ShipManifest } from '@expo-host'
import { Assert, CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

/** verifyReleaseBundle exports real release and preview bundles in an isolated host. */
async function verifyReleaseBundle(): Promise<void> {
  const runRoot = await Repo.mkScratchDir('tao-ship-bundle-proof-')
  let primaryFailure: unknown
  try {
    const hostRoot = FS.resolvePath('host', runRoot)
    const sourceRoot = FS.resolvePath('source', runRoot)
    const sourcePath = FS.resolvePath('BundleProof.tao', sourceRoot)
    await copyHost(hostRoot)
    await FS.writeText(
      sourcePath,
      `project {
         id "bundle-proof"
         name "Tao Bundle Proof"
         version "1.0.0"
         DefaultApp BundleProof
         remote none
         license MIT
       }
       app BundleProof { view Main }
       view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
    )
    await FS.symlink(
      FS.resolvePath('node_modules', RuntimeToolchainPaths.packageRoot),
      FS.resolvePath('node_modules', hostRoot),
    )

    await Runtime.generateApp(sourcePath, {
      appName: 'BundleProof',
      runtimePackageRoot: hostRoot,
      ship: proofManifest,
      validationMode: 'release',
    })
    const releaseRoot = FS.resolvePath('release', runRoot)
    await expoExport(hostRoot, releaseRoot)
    await Runtime.proveReleaseBundle(releaseRoot)

    await Runtime.generateApp(sourcePath, {
      appName: 'BundleProof',
      preview: {
        project: sourceRoot,
        revision: 1,
        sourceVersions: { 'BundleProof.tao': 'ship-bundle-proof' },
      },
      runtimePackageRoot: hostRoot,
    })
    const previewRoot = FS.resolvePath('preview', runRoot)
    await expoExport(hostRoot, previewRoot)
    await assertPreviewControlFails(previewRoot)
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    try {
      await FS.remove(runRoot)
    } catch (cleanupError) {
      const message = `Failed to remove release-bundle proof root ${runRoot}.`
      if (primaryFailure === undefined) {
        Errors.throwHostEnvironment(message, { cause: cleanupError })
      }
      HCI.logProcessError(
        'bundle-cleanup',
        `${message} The primary proof failure is preserved. ${Errors.formatForLog(cleanupError)}`,
      )
    }
  }
}

async function copyHost(hostRoot: string): Promise<void> {
  for (const file of ['app.json', 'app.config.js', 'app-config.cjs', 'index.ts', 'metro.config.cjs', 'package.json']) {
    await FS.copyFile(
      FS.resolvePath(file, RuntimeToolchainPaths.packageRoot),
      FS.resolvePath(file, hostRoot),
    )
  }
  await FS.copyDirectory(
    FS.resolvePath('assets', RuntimeToolchainPaths.packageRoot),
    FS.resolvePath('assets', hostRoot),
  )
  await FS.copyDirectory(
    FS.resolvePath('plugins', RuntimeToolchainPaths.packageRoot),
    FS.resolvePath('plugins', hostRoot),
  )
}

async function expoExport(hostRoot: string, outputRoot: string): Promise<void> {
  await CLI.mustRun(FS.resolvePath('node_modules/.bin/expo', RuntimeToolchainPaths.packageRoot), {
    args: ['export', '--platform', 'ios', '--output-dir', outputRoot, '--clear'],
    cwd: hostRoot,
    env: {
      ...Platform.runtimeProcess.env,
      TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: RuntimeToolchainPaths.packageRoot,
    },
    prefixedOutput: { processName: 'bundle' },
  })
}

async function assertPreviewControlFails(previewRoot: string): Promise<void> {
  try {
    await Runtime.proveReleaseBundle(previewRoot)
  } catch (error) {
    Assert(
      Errors.formatForUser(error).includes('release bundle excludes Tao Studio modules'),
      'the preview bundle fails only because it contains the Studio marker',
      { error },
    )
    return
  }
  Assert(false, 'the deliberate preview bundle contains the Studio marker')
}

const proofManifest: ShipManifest = {
  buildNumber: '1',
  bundleIdentifier: 'lang.tao.bundle-proof',
  git: { commit: 'bundle-proof', dirty: false },
  icon: 'default',
  ios: { usesNonExemptEncryption: false },
  name: 'Tao Bundle Proof',
  schemaVersion: 1,
  slug: 'tao-bundle-proof',
  version: '1.0.0',
}

await verifyReleaseBundle()

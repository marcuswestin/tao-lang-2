import { shipsNativeCode } from '@expo-host/dev-loop/prebuilt-host/HostManifest'
import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { PackageGraph } from '../verification-src/PackageGraph'

/**
 * The Companion is the shared prebuilt host every Tao app runs inside during device development.
 * A native module a compiled app can require but the Companion never installed does not fail
 * cleanly: it crashes at require time, inside a shell nobody can edit on the spot. So every
 * dependency of the generated host that ships native code must be installed in the Companion too,
 * at the exact version the host pins. "Ships native code" is detected from the resolved package
 * directory by `shipsNativeCode`, the same rule a prebuilt host's manifest is built with, rather than
 * a hard-coded list, so a future native dependency trips this the moment it is added to the host,
 * not whenever someone remembers to update an allowlist.
 */

const HOST_PACKAGE_PATH = 'packages/apps/expo-host/package.json'
const COMPANION_PACKAGE_PATH = 'packages/ides/studio-companion-app/package.json'

type Manifest = { dependencies?: Record<string, string>; name?: string }

async function readManifest(path: string, repositoryRoot: string): Promise<Manifest> {
  return FS.readJson<Manifest>(FS.resolvePath(path, repositoryRoot))
}

/**
 * resolvePackageDirectory finds where a host dependency actually lives: a `workspace:` specifier
 * resolves through the repository's own package directories, anything else resolves the way the
 * host itself would resolve it, through its own `node_modules`.
 */
async function resolvePackageDirectory(
  name: string,
  version: string,
  repositoryRoot: string,
): Promise<string | undefined> {
  if (version.startsWith('workspace:')) {
    return workspacePackageDirectory(name, repositoryRoot)
  }
  try {
    const hostDirectory = FS.resolvePath(FS.dirname(HOST_PACKAGE_PATH), repositoryRoot)
    return FS.dirname(Bun.resolveSync(`${name}/package.json`, hostDirectory))
  } catch {
    return undefined
  }
}

async function workspacePackageDirectory(name: string, repositoryRoot: string): Promise<string | undefined> {
  const packagesRoot = FS.resolvePath('packages', repositoryRoot)
  for (const directory of await PackageGraph.packageDirectories(packagesRoot)) {
    const manifestPath = FS.resolvePath(`${directory}/package.json`, packagesRoot)
    if (!await FS.isFile(manifestPath)) {
      continue
    }
    if ((await FS.readJson<Manifest>(manifestPath)).name === name) {
      return FS.resolvePath(directory, packagesRoot)
    }
  }
  return undefined
}

/**
 * companionNativeParityIssues reports, for every native-shipping dependency of the generated host,
 * a Companion manifest that is missing it or pins it at a different version. The Companion may
 * carry dependencies the host does not (it has `expo-dev-client`); the invariant runs one way only.
 */
async function companionNativeParityIssues(repositoryRoot = Repo.getRoot()): Promise<string[]> {
  const host = await readManifest(HOST_PACKAGE_PATH, repositoryRoot)
  const companion = await readManifest(COMPANION_PACKAGE_PATH, repositoryRoot)
  const issues: string[] = []
  for (const [name, version] of Object.entries(host.dependencies ?? {})) {
    const directory = await resolvePackageDirectory(name, version, repositoryRoot)
    if (directory === undefined || !await shipsNativeCode(directory)) {
      continue
    }
    const companionVersion = companion.dependencies?.[name]
    if (companionVersion === version) {
      continue
    }
    issues.push(
      companionVersion === undefined
        ? `${COMPANION_PACKAGE_PATH} is missing "${name}": "${version}", which ${HOST_PACKAGE_PATH} depends on and `
          + 'which ships native code. A Tao app that requires it would crash the Companion at require time instead '
          + `of failing cleanly. Add "${name}": "${version}" to ${COMPANION_PACKAGE_PATH}.`
        : `${COMPANION_PACKAGE_PATH} declares "${name}": "${companionVersion}", but ${HOST_PACKAGE_PATH} pins `
          + `"${name}": "${version}" and ${name} ships native code. Set "${name}": "${version}" in `
          + `${COMPANION_PACKAGE_PATH}.`,
    )
  }
  return issues
}

async function writePackage(root: string, path: string, manifest: Manifest): Promise<void> {
  await FS.writeJson(FS.resolvePath(path, root), manifest)
}

async function writeNativeMarker(root: string, packageDirectory: string): Promise<void> {
  await FS.writeText(FS.resolvePath(`${packageDirectory}/ios/Native.podspec`, root), '')
}

async function writePlatformDirectoriesWithoutNativeCode(root: string, packageDirectory: string): Promise<void> {
  await FS.writeText(FS.resolvePath(`${packageDirectory}/ios/jest-preset.js`, root), '')
  await FS.writeText(FS.resolvePath(`${packageDirectory}/android/jest-preset.js`, root), '')
}

Describe('companion native module parity', () => {
  Test('reports a native-shipping host dependency missing from the Companion', async () => {
    const root = await mkTestDir('tao-companion-native-parity-')
    try {
      await writePackage(root, HOST_PACKAGE_PATH, { dependencies: { 'some-native-module': '1.2.3' } })
      await writePackage(root, COMPANION_PACKAGE_PATH, { dependencies: {} })
      await writePackage(root, 'packages/apps/expo-host/node_modules/some-native-module/package.json', {
        name: 'some-native-module',
      })
      await writeNativeMarker(root, 'packages/apps/expo-host/node_modules/some-native-module')

      Expect(await companionNativeParityIssues(root)).toEqual([
        `${COMPANION_PACKAGE_PATH} is missing "some-native-module": "1.2.3", which ${HOST_PACKAGE_PATH} depends on `
        + 'and which ships native code. A Tao app that requires it would crash the Companion at require time '
        + `instead of failing cleanly. Add "some-native-module": "1.2.3" to ${COMPANION_PACKAGE_PATH}.`,
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports a native-shipping dependency the Companion pins at a different version', async () => {
    const root = await mkTestDir('tao-companion-native-parity-')
    try {
      await writePackage(root, HOST_PACKAGE_PATH, { dependencies: { 'some-native-module': '1.2.3' } })
      await writePackage(root, COMPANION_PACKAGE_PATH, { dependencies: { 'some-native-module': '1.2.2' } })
      await writePackage(root, 'packages/apps/expo-host/node_modules/some-native-module/package.json', {
        name: 'some-native-module',
      })
      await writeNativeMarker(root, 'packages/apps/expo-host/node_modules/some-native-module')

      Expect(await companionNativeParityIssues(root)).toEqual([
        `${COMPANION_PACKAGE_PATH} declares "some-native-module": "1.2.2", but ${HOST_PACKAGE_PATH} pins `
        + '"some-native-module": "1.2.3" and some-native-module ships native code. Set '
        + `"some-native-module": "1.2.3" in ${COMPANION_PACKAGE_PATH}.`,
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('accepts a native-shipping dependency the Companion pins at the same version', async () => {
    const root = await mkTestDir('tao-companion-native-parity-')
    try {
      await writePackage(root, HOST_PACKAGE_PATH, { dependencies: { 'some-native-module': '1.2.3' } })
      await writePackage(root, COMPANION_PACKAGE_PATH, { dependencies: { 'some-native-module': '1.2.3' } })
      await writePackage(root, 'packages/apps/expo-host/node_modules/some-native-module/package.json', {
        name: 'some-native-module',
      })
      await writeNativeMarker(root, 'packages/apps/expo-host/node_modules/some-native-module')

      Expect(await companionNativeParityIssues(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('leaves a mismatched dependency alone when it ships no native code', async () => {
    const root = await mkTestDir('tao-companion-native-parity-')
    try {
      await writePackage(root, HOST_PACKAGE_PATH, { dependencies: { 'js-only-module': '1.0.0' } })
      await writePackage(root, COMPANION_PACKAGE_PATH, { dependencies: {} })
      await writePackage(root, 'packages/apps/expo-host/node_modules/js-only-module/package.json', {
        name: 'js-only-module',
      })

      Expect(await companionNativeParityIssues(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('leaves a mismatched dependency alone when its ios/android directories hold no native build file', async () => {
    // Shaped like the installed jest-expo: an `ios/` and `android/` directory that each carry only
    // a jest-preset.js, the false positive a bare directory-presence check would report.
    const root = await mkTestDir('tao-companion-native-parity-')
    try {
      await writePackage(root, HOST_PACKAGE_PATH, { dependencies: { 'platform-preset-only': '1.0.0' } })
      await writePackage(root, COMPANION_PACKAGE_PATH, { dependencies: {} })
      await writePackage(root, 'packages/apps/expo-host/node_modules/platform-preset-only/package.json', {
        name: 'platform-preset-only',
      })
      await writePlatformDirectoriesWithoutNativeCode(root, 'packages/apps/expo-host/node_modules/platform-preset-only')

      Expect(await companionNativeParityIssues(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('resolves a workspace dependency through the repository rather than node_modules', async () => {
    const root = await mkTestDir('tao-companion-native-parity-')
    try {
      await writePackage(root, HOST_PACKAGE_PATH, { dependencies: { 'tao-test-native': 'workspace:*' } })
      await writePackage(root, COMPANION_PACKAGE_PATH, { dependencies: {} })
      await writePackage(root, 'packages/providers/test-native/package.json', { name: 'tao-test-native' })
      await writeNativeMarker(root, 'packages/providers/test-native')

      Expect(await companionNativeParityIssues(root)).toEqual([
        `${COMPANION_PACKAGE_PATH} is missing "tao-test-native": "workspace:*", which ${HOST_PACKAGE_PATH} depends `
        + 'on and which ships native code. A Tao app that requires it would crash the Companion at require time '
        + `instead of failing cleanly. Add "tao-test-native": "workspace:*" to ${COMPANION_PACKAGE_PATH}.`,
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('leaves a Companion-only dependency alone; the invariant runs one way', async () => {
    const root = await mkTestDir('tao-companion-native-parity-')
    try {
      await writePackage(root, HOST_PACKAGE_PATH, { dependencies: {} })
      await writePackage(root, COMPANION_PACKAGE_PATH, { dependencies: { 'expo-dev-client': '~57.0.19' } })

      Expect(await companionNativeParityIssues(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('holds for the installed workspace', async () => {
    Expect(await companionNativeParityIssues()).toEqual([])
  })
})

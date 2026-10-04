import type { DependencyEnvironment } from '@compiler'
import { BridgeMetadata } from '@compiler/bridge-metadata'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { managedDependencyModulesRoot } from '../project-tooling-src/ProjectHostModules'
import { validateManagedDependencyEnvironments } from '../project-tooling-src/ProjectManagedDependencies'

Describe('private dependency environments', () => {
  Test('requires the pinned managed alias and matching snapshot link', async () => {
    const requester = await mkTestDir('tao-tooling-private-dependency-', { location: 'host' })
    try {
      const dependencyRoot = FS.resolvePath('dependency', requester)
      const namespace = BridgeMetadata.dependencyNamespace(dependencyRoot)
      const environment: DependencyEnvironment = {
        projectRoot: dependencyRoot,
        namespace,
        npm: [{ alias: 'util', packageName: 'real-util', versionRange: '^2.0.0' }],
        publications: [],
      }
      const modulesRoot = managedDependencyModulesRoot(requester, namespace)
      const managedPackage = FS.resolvePath('util', modulesRoot)
      const snapshotModulesRoot = FS.resolvePath(`.tao-ts/.dependencies/${namespace}/node_modules`, requester)

      Expect((await validateManagedDependencyEnvironments(requester, [environment]))[0]?.message)
        .toContain('not installed')

      await FS.writeText(FS.resolvePath('package.json', managedPackage), '{"name":"real-util","version":"1.0.0"}\n')
      const wrongVersion = await validateManagedDependencyEnvironments(requester, [environment])
      Expect(wrongVersion.some(diagnostic => diagnostic.message.includes('requires ^2.0.0'))).toBe(true)
      Expect(wrongVersion.some(diagnostic => diagnostic.message.includes('not linked'))).toBe(true)

      await FS.writeText(FS.resolvePath('package.json', managedPackage), '{"name":"other","version":"2.1.0"}\n')
      await FS.symlink(modulesRoot, snapshotModulesRoot)
      Expect((await validateManagedDependencyEnvironments(requester, [environment]))[0]?.message)
        .toContain('but real-util was declared')
      await FS.writeText(FS.resolvePath('package.json', managedPackage), '{"name":"real-util","version":"2.1.0"}\n')
      Expect(await validateManagedDependencyEnvironments(requester, [environment])).toEqual([])
      await FS.writeText(
        FS.resolvePath('.tao/lock.jsonc', requester),
        JSON.stringify({
          schemaVersion: 1,
          installs: {
            environments: {
              [namespace]: {
                npm: {
                  util: {
                    name: 'real-util',
                    requested: '^2.0.0',
                    version: '2.2.0',
                  },
                },
              },
            },
          },
        }),
      )
      Expect(
        (await validateManagedDependencyEnvironments(requester, [environment])).some(diagnostic =>
          diagnostic.message.includes('lock pins 2.2.0')
        ),
      ).toBe(true)
      await FS.writeText(FS.resolvePath('package.json', managedPackage), '{"name":"real-util","version":"2.2.0"}\n')
      Expect(await validateManagedDependencyEnvironments(requester, [environment])).toEqual([])
    } finally {
      await FS.remove(requester)
    }
  })

  Test('checks requester aliases against declarations and the exact Tao lock pin', async () => {
    const requester = await mkTestDir('tao-tooling-direct-dependency-', { location: 'host' })
    try {
      const namespace = BridgeMetadata.dependencyNamespace(requester)
      const environment: DependencyEnvironment = {
        projectRoot: requester,
        namespace,
        npm: [{ alias: 'util', packageName: 'real-util', versionRange: '^2.0.0' }],
        publications: [],
      }
      const manifest = FS.resolvePath('node_modules/util/package.json', requester)
      const lockPath = FS.resolvePath('.tao/lock.jsonc', requester)
      Expect((await validateManagedDependencyEnvironments(requester, [environment]))[0]?.message)
        .toContain('not installed')

      await FS.writeText(manifest, '{"name":"other","version":"1.0.0"}\n')
      const wrongInstall = await validateManagedDependencyEnvironments(requester, [environment])
      Expect(wrongInstall.some(diagnostic => diagnostic.message.includes('but real-util was declared'))).toBe(true)
      Expect(wrongInstall.some(diagnostic => diagnostic.message.includes('requires ^2.0.0'))).toBe(true)

      await FS.writeText(manifest, '{"name":"real-util","version":"2.1.0"}\n')
      Expect(await validateManagedDependencyEnvironments(requester, [environment])).toEqual([])

      await FS.writeText(
        lockPath,
        JSON.stringify({
          schemaVersion: 1,
          installs: {
            environments: {
              [namespace]: { npm: { util: { name: 'real-util', requested: '^2.0.0', version: '2.2.0' } } },
            },
          },
        }),
      )
      Expect(
        (await validateManagedDependencyEnvironments(requester, [environment])).some(diagnostic =>
          diagnostic.message.includes('lock pins 2.2.0')
        ),
      ).toBe(true)
      await FS.writeText(manifest, '{"name":"real-util","version":"2.2.0"}\n')
      Expect(await validateManagedDependencyEnvironments(requester, [environment])).toEqual([])

      await FS.writeText(
        lockPath,
        JSON.stringify({
          schemaVersion: 1,
          installs: {
            environments: {
              [namespace]: { npm: { util: { name: 'other', requested: '^3.0.0', version: '2.2.0' } } },
            },
          },
        }),
      )
      const wrongPin = await validateManagedDependencyEnvironments(requester, [environment])
      Expect(wrongPin.some(diagnostic => diagnostic.message.includes('pinned as other'))).toBe(true)
      Expect(wrongPin.some(diagnostic => diagnostic.message.includes('pinned for ^3.0.0'))).toBe(true)
    } finally {
      await FS.remove(requester)
    }
  })

  Test('uses a separate module target and an unambiguous origin-root pin for build snapshots', async () => {
    const fixture = await mkTestDir('tao-tooling-build-modules-', { location: 'host' })
    try {
      const snapshotRoot = FS.resolvePath('snapshot', fixture)
      const moduleLinkRoot = FS.resolvePath('source', fixture)
      const namespace = BridgeMetadata.dependencyNamespace(snapshotRoot)
      const previousNamespace = BridgeMetadata.dependencyNamespace(moduleLinkRoot)
      const environment: DependencyEnvironment = {
        projectRoot: snapshotRoot,
        namespace,
        npm: [{ alias: 'util', packageName: 'real-util', versionRange: '^2.0.0' }],
        publications: [],
      }
      const manifest = FS.resolvePath('node_modules/util/package.json', moduleLinkRoot)
      const lockPath = FS.resolvePath('.tao/lock.jsonc', snapshotRoot)
      await FS.writeText(manifest, '{"name":"real-util","version":"2.1.0"}\n')
      await FS.writeText(
        lockPath,
        JSON.stringify({
          schemaVersion: 1,
          installs: {
            environments: {
              [previousNamespace]: {
                projectRoot: '.',
                npm: {
                  util: {
                    name: 'real-util',
                    requested: '^2.0.0',
                    version: '2.2.0',
                  },
                },
              },
            },
          },
        }),
      )
      const mismatch = await validateManagedDependencyEnvironments(snapshotRoot, [environment], {
        moduleLinkRoot,
        checkSnapshotLinks: false,
      })
      Expect(mismatch.some(diagnostic => diagnostic.message.includes('lock pins 2.2.0'))).toBe(true)

      await FS.writeText(manifest, '{"name":"real-util","version":"2.2.0"}\n')
      Expect(
        await validateManagedDependencyEnvironments(snapshotRoot, [environment], {
          moduleLinkRoot,
          checkSnapshotLinks: false,
        }),
      ).toEqual([])
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('matches a foreign origin pin by relative project root when its namespace changes', async () => {
    const fixture = await mkTestDir('tao-tooling-foreign-build-', { location: 'host' })
    try {
      const snapshotRoot = FS.resolvePath('snapshot', fixture)
      const moduleLinkRoot = FS.resolvePath('source', fixture)
      const foreignRoot = FS.resolvePath('Child', snapshotRoot)
      const namespace = BridgeMetadata.dependencyNamespace(foreignRoot)
      const previousNamespace = BridgeMetadata.dependencyNamespace(FS.resolvePath('Child', moduleLinkRoot))
      const environment: DependencyEnvironment = {
        projectRoot: foreignRoot,
        namespace,
        npm: [{ alias: 'util', packageName: 'real-util', versionRange: '^2.0.0' }],
        publications: [],
      }
      const manifest = FS.resolvePath('util/package.json', managedDependencyModulesRoot(moduleLinkRoot, namespace))
      await FS.writeText(manifest, '{"name":"real-util","version":"2.1.0"}\n')
      await FS.writeText(
        FS.resolvePath('.tao/lock.jsonc', snapshotRoot),
        JSON.stringify({
          schemaVersion: 1,
          installs: {
            environments: {
              [previousNamespace]: {
                projectRoot: 'Child',
                npm: { util: { name: 'real-util', requested: '^2.0.0', version: '2.2.0' } },
              },
            },
          },
        }),
      )
      const diagnostics = await validateManagedDependencyEnvironments(snapshotRoot, [environment], {
        moduleLinkRoot,
        checkSnapshotLinks: false,
      })
      Expect(diagnostics.some(diagnostic => diagnostic.message.includes('lock pins 2.2.0'))).toBe(true)
    } finally {
      await FS.remove(fixture)
    }
  })
})

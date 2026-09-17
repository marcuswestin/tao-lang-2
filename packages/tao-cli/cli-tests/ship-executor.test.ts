import { CLI, Errors, FS } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test } from '@shared/test'
import type { AppStoreConnectClient } from '../cli-src/app-store-connect-client'
import type { PreparedShip } from '../cli-src/ship-command'
import { configureBetaDistribution, executePreparedShip, ShipExecutorTesting } from '../cli-src/ship-executor'
import { inspectShipGit } from '../cli-src/ship-git'
import type { ShipLockEntry, TaoProjectLock } from '../cli-src/ship-lock'
import type { TaoUpdateClient } from '../cli-src/tao-update-client'

Describe('tao ship TestFlight distribution', () => {
  Test('makes the build available before assigning an external tester', async () => {
    const calls: string[] = []
    const apple = {
      addBuildToBetaGroup: async (groupId: string) => {
        calls.push(`build:${groupId}`)
      },
      enableAutomaticBetaNotifications: async () => {
        calls.push('auto-notify')
        return {
          attributes: { autoNotifyEnabled: true },
          id: 'build-detail-1',
          type: 'buildBetaDetails' as const,
        }
      },
      ensureBetaAppLocalization: async (_appId: string, input: { description?: string; feedbackEmail?: string }) => {
        calls.push('app-localization')
        Expect(input).toEqual({
          description:
            'WordFlower - InstantDB is currently in beta. Please explore its features and share feedback through TestFlight.',
          feedbackEmail: 'friend@example.com',
        })
        return {
          attributes: { ...input, locale: 'en-US' },
          id: 'app-localization-1',
          type: 'betaAppLocalizations' as const,
        }
      },
      ensureBetaGroup: async (_appId: string, name: string, isInternalGroup: boolean) => {
        calls.push(`group:${name}`)
        return {
          attributes: { isInternalGroup, name },
          id: isInternalGroup ? 'internal-1' : 'external-1',
          type: 'betaGroups' as const,
        }
      },
      ensureBetaTester: async (email: string, groupId: string) => {
        calls.push(`tester:${email}:${groupId}`)
        return { attributes: { email }, id: 'tester-1', type: 'betaTesters' as const }
      },
      setWhatToTest: async () => {
        calls.push('what-to-test')
        return {
          attributes: { locale: 'en-US', whatsNew: 'Try the editor.' },
          id: 'build-localization-1',
          type: 'betaBuildLocalizations' as const,
        }
      },
      submitBuildForBetaReview: async () => {
        calls.push('beta-review')
        return {
          attributes: { betaReviewState: 'WAITING_FOR_REVIEW' },
          id: 'review-1',
          type: 'betaAppReviewSubmissions' as const,
        }
      },
      users: async (email: string) => {
        calls.push(`users:${email}`)
        return []
      },
    }

    await configureBetaDistribution(apple, {
      appId: 'app-1',
      appName: 'WordFlower - InstantDB',
      build: { attributes: { processingState: 'VALID', version: '7' }, id: 'build-7', type: 'builds' },
      emails: ['friend@example.com'],
      notes: 'Try the editor.',
    })

    Expect(calls).toEqual([
      'group:Tao Internal',
      'group:Tao External',
      'users:friend@example.com',
      'what-to-test',
      'build:internal-1',
      'build:external-1',
      'auto-notify',
      'app-localization',
      'tester:friend@example.com:external-1',
      'beta-review',
    ])
  })

  Test('publishes only Expo-declared artifacts with the binary runtime identity', async () => {
    const exportRoot = await mkTestDir('tao-ship-executor-ota-')
    await FS.writeText(FS.resolvePath('bundle.hbc', exportRoot), 'launch')
    await FS.writeText(FS.resolvePath('assets/image-hash', exportRoot), 'image')
    await FS.writeText(FS.resolvePath('undeclared-secret.txt', exportRoot), 'must not upload')
    await FS.writeJson(FS.resolvePath('metadata.json', exportRoot), {
      bundler: 'metro',
      fileMetadata: {
        ios: {
          assets: [{ ext: 'png', path: 'assets/image-hash' }],
          bundle: 'bundle.hbc',
        },
      },
      version: 0,
    })
    const uploads: Array<{ contentType: string; fileExtension?: string; key: string }> = []
    const client = {
      uploadAsset: async (input: { contentType: string; fileExtension?: string; key: string }) => {
        uploads.push({
          contentType: input.contentType,
          fileExtension: input.fileExtension,
          key: input.key,
        })
        return {
          contentType: input.contentType,
          fileExtension: input.fileExtension,
          hash: `hash-${input.key}`,
          key: input.key,
          url: `https://updates.example/assets/${input.key}`,
        }
      },
    } as unknown as TaoUpdateClient
    const prepared = {
      buildNumber: '42',
      channel: 'stable',
      project: { id: 'notes' },
      version: '1.2.3',
    } as unknown as Parameters<typeof ShipExecutorTesting.publicationFromExport>[1]

    const publication = await ShipExecutorTesting.publicationFromExport(
      client,
      prepared,
      exportRoot,
      'native-runtime-1',
      'schema-1',
    )

    Expect(uploads).toEqual([
      { contentType: 'application/javascript', fileExtension: '.hbc', key: 'bundle' },
      { contentType: 'image/png', fileExtension: '.png', key: 'image-hash' },
    ])
    Expect(publication.runtimeVersion).toBe('native-runtime-1')
    Expect(publication.metadata).toEqual({ buildNumber: '42', platform: 'ios', version: '1.2.3' })
  })

  Test('keeps document containers distinct from CloudKit-only containers in the runtime manifest', () => {
    const prepared = {
      app: {
        icloud: {
          serviceBindings: [
            {
              containers: ['iCloud.custom.documents'],
              service: 'CloudDocuments',
              usesDefaultContainer: true,
            },
            {
              containers: ['iCloud.custom.records'],
              service: 'CloudKit',
              usesDefaultContainer: false,
            },
          ],
        },
        name: 'Notes',
      },
      buildNumber: '42',
      bundleIdentifier: 'dev.tao.notes',
      channel: 'stable',
      git: { dirty: false },
      project: { id: 'notes', primaryAppName: 'Notes' },
      version: '1.2.3',
    } as unknown as Parameters<typeof ShipExecutorTesting.runtimeManifest>[0]

    const manifest = ShipExecutorTesting.runtimeManifest(
      prepared,
      'source-commit',
      'native-runtime-1',
      'https://updates.example',
    )

    Expect(manifest.icloud).toEqual({
      containers: [
        'iCloud.custom.documents',
        'iCloud.custom.records',
        'iCloud.dev.tao.notes',
      ],
      documentContainers: ['iCloud.custom.documents', 'iCloud.dev.tao.notes'],
      services: ['CloudDocuments', 'CloudKit'],
    })
  })
})

Describe('tao ship filesystem-only execution', () => {
  for (const failure of [false, true]) {
    Test(`preserves Git HEAD, refs, and index when checkpoint writes ${failure ? 'fail' : 'succeed'}`, async () => {
      const root = await mkTestDir('tao-ship-execute-git-')
      try {
        await git(root, 'init', '-q')
        await git(root, 'config', 'user.email', 'test@example.com')
        await git(root, 'config', 'user.name', 'Tao Test')
        const sourcePath = FS.resolvePath('App.tao', root)
        const lockPath = FS.resolvePath('.tao-project/lock.jsonc', root)
        await FS.writeText(sourcePath, 'project { id "notes" name "Notes" version "1.2.2" DefaultApp Notes }\n')
        await git(root, 'add', '.')
        await git(root, 'commit', '-qm', 'Previous release')
        const previousCommit = await git(root, 'rev-parse', 'HEAD')
        await FS.writeText(sourcePath, `${await FS.readText(sourcePath)}app Notes { view Main }\nview Main() { }\n`)
        await git(root, 'add', '.')
        await git(root, 'commit', '-qm', 'New release notes')
        const currentCommit = await git(root, 'rev-parse', 'HEAD')
        await FS.writeText(FS.resolvePath('User.txt', root), 'already staged\n')
        await git(root, 'add', 'User.txt')
        const indexBefore = await FS.readFile(FS.resolvePath('.git/index', root))
        const refsBefore = await git(root, 'show-ref')
        const entry: ShipLockEntry = {
          accepted: {
            bundleIdentifier: 'dev.tao-lang.notes',
            issuerId: 'issuer',
            keyId: 'key',
            namespace: 'dev.tao-lang',
          },
          appStoreAppId: 'app-1',
          identity: 'notes/Notes',
          inputHash: 'input',
          lastBuild: {
            buildId: 'build-7',
            commit: currentCommit,
            number: '7',
            processed: false,
            releaseNotesFromCommit: previousCommit,
            version: '1.2.3',
          },
          provenance: { at: '2026-09-16T00:00:00.000Z', command: 'tao ship', version: 1 },
          status: 'accepted',
        }
        const lock: TaoProjectLock = { schemaVersion: 1, ship: { apps: { [entry.identity]: entry } } }
        const prepared = {
          actions: [],
          app: {
            displayName: 'Notes',
            hasLocalDatasourceEndpoint: false,
            isVariant: false,
            name: 'Notes',
            sourcePath,
            usesDevDatasource: false,
          },
          buildNumber: '7',
          bundleIdentifier: 'dev.tao-lang.notes',
          channel: 'notes',
          entry,
          git: await inspectShipGit(root, { excludePaths: [lockPath] }),
          inputHash: 'input',
          issues: [],
          lock,
          project: {
            apps: [],
            defaultApp: 'Notes',
            id: 'notes',
            name: 'Notes',
            primaryAppName: 'Notes',
            projectSourcePath: sourcePath,
            root,
            version: '1.2.2',
          },
          reuseBuild: true,
          version: '1.2.3',
          versionBumped: true,
        } satisfies PreparedShip
        let notes = ''
        const apple = testAppleClient({
          failDistribution: failure,
          onNotes: value => {
            notes = value
          },
        })
        const execution = executePreparedShip(
          prepared,
          { betaRecipients: [], ...fakeTerminal() },
          { appleClient: apple },
        )
        if (failure) {
          await Expect(execution).rejects.toThrow('forced distribution failure')
        } else {
          await execution
          Expect(notes).toContain('New release notes')
        }

        Expect(await git(root, 'rev-parse', 'HEAD')).toBe(currentCommit)
        Expect(await git(root, 'show-ref')).toBe(refsBefore)
        Expect(await FS.readFile(FS.resolvePath('.git/index', root))).toEqual(indexBefore)
        Expect(await FS.exists(lockPath)).toBe(true)
        Expect(await FS.readText(sourcePath)).toContain('version "1.2.3"')
      } finally {
        await FS.remove(root)
      }
    })
  }
})

async function git(root: string, ...args: string[]): Promise<string> {
  return (await CLI.mustRun('git', { args: ['-C', root, ...args] })).stdout.trim()
}

function testAppleClient(options: { failDistribution: boolean; onNotes: (notes: string) => void }) {
  return {
    addBuildToBetaGroup: async () => {},
    apps: async () => [{
      attributes: { bundleId: 'dev.tao-lang.notes', name: 'Notes', primaryLocale: 'en-US', sku: 'notes' },
      id: 'app-1',
      type: 'apps' as const,
    }],
    bundleIds: async () => [{
      attributes: { identifier: 'dev.tao-lang.notes', seedId: 'TEAM' },
      id: 'bundle-1',
      type: 'bundleIds' as const,
    }],
    enableAutomaticBetaNotifications: async () => ({
      attributes: { autoNotifyEnabled: true },
      id: 'details-1',
      type: 'buildBetaDetails' as const,
    }),
    ensureBetaGroup: async (_appId: string, name: string, internal: boolean) => {
      if (options.failDistribution) {
        Errors.throwHostEnvironment('forced distribution failure')
      }
      return {
        attributes: { isInternalGroup: internal, name },
        id: internal ? 'internal-1' : 'external-1',
        type: 'betaGroups' as const,
      }
    },
    setWhatToTest: async (_buildId: string, notes: string) => {
      options.onNotes(notes)
      return {
        attributes: { locale: 'en-US', whatsNew: notes },
        id: 'localization-1',
        type: 'betaBuildLocalizations' as const,
      }
    },
    users: async () => [],
  } as unknown as AppStoreConnectClient
}

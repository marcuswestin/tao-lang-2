import { FS } from '@shared'
import {
  Describe,
  Expect,
  fakeTerminal,
  initGitTestRepository,
  mkGitTestDir,
  Test,
  withTaoFiles,
} from '@shared/test'
import { runShipCommand } from '../cli-src/ship-command'
import { shipInputHash } from '../cli-src/ship-model'

const source = `app Notes { id "notes" version "1.2.3" name "Notes" view Main }
view Main() { render inject \`\`\`ts return null \`\`\` }
`

Describe('tao ship command', () => {
  Test('runs discovery, preflight, version policy, and action list without a key or network in dry-run', async () => {
    await withTaoFiles('tao-ship-command-', { '.tao/.gitkeep': '', 'App.tao': source }, async paths => {
      const terminal = fakeTerminal()
      const result = await runShipCommand(FS.dirname(paths['App.tao']!), {
        dryRun: true,
        ...terminal,
      }, { now: () => new Date('2026-09-02T14:05:00Z') })
      Expect(result).toBe('dry-run')
      const output = terminal.outputText()
      Expect(output).toContain('Ship Notes 1.2.3 (202609021405)')
      Expect(output).toContain('Create an Admin App Store Connect API team key')
      Expect(output).toContain('Prebuild the iOS project')
      Expect(await FS.exists(FS.resolvePath('.tao/lock.jsonc', FS.dirname(paths['App.tao']!)))).toBe(false)
    })
  })

  Test('requires an explicit app when the project contains more than one', async () => {
    await withTaoFiles('tao-ship-command-', {
      '.tao/.gitkeep': '',
      'App.tao': source.replace(
        'view Main() { render inject ```ts return null ``` }',
        'app Other { id "other" version "1.2.3" name "Other" view Main }\nview Main() { render inject ```ts return null ``` }',
      ),
    }, async paths => {
      await Expect(runShipCommand(paths['App.tao']!, { dryRun: true, interactive: false })).rejects.toThrow(
        'does not name an app',
      )
    })
  })

  Test('resumes an uploaded build after a post-upload beta failure', async () => {
    const inputHash = shipInputHash({
      appName: 'Notes',
      appId: 'notes',
      appVersion: '1.2.3',
      releaseDatasourceConfiguration: undefined,
    })
    const lock = {
      schemaVersion: 1,
      ship: {
        apps: {
          'notes/Notes': {
            accepted: {
              bundleIdentifier: 'com.devtao.notes',
              issuerId: 'issuer-id',
              keyId: 'KEY123',
              namespace: 'com.devtao',
            },
            appStoreAppId: 'app-42',
            identity: 'notes/Notes',
            inputHash,
            lastBuild: {
              commit: 'source-commit-before-tool-fix',
              number: '202609020901',
              processed: false,
              version: '1.2.3',
            },
            provenance: { at: '2026-09-02T09:01:00.000Z', command: 'tao ship', version: 1 },
            status: 'accepted',
          },
        },
      },
    }
    const root = await mkGitTestDir('tao-ship-command-')
    await initGitTestRepository(root, {
      commit: { files: { '.tao/lock.jsonc': JSON.stringify(lock), 'App.tao': source } },
    })
    const terminal = fakeTerminal()
    await runShipCommand(root, {
      betaRecipients: ['friend@example.com'],
      dryRun: true,
      ...terminal,
    }, { inspectPreflight: async () => [] })

    Expect(terminal.outputText()).toContain('Resume uploaded App Store Connect build 202609020901 without rebuilding')
    Expect(terminal.outputText()).not.toContain('Archive and sign')
  })

  Test('does not retry a terminally rejected Apple build', async () => {
    await expectFreshBuildForIneligibleCheckpoint({ processingState: 'INVALID' })
  })

  Test('does not reuse an uploaded checkpoint outside Git', async () => {
    await expectFreshBuildForIneligibleCheckpoint({})
  })

  Test('does not promote a dirty TestFlight artifact to the App Store', async () => {
    await expectFreshBuildForIneligibleCheckpoint({
      dirty: true,
      dirtyFingerprint: 'artifact-dirty-tree',
      distribution: 'testflight',
    })
  })

  Test('prompts for accepted identifiers interactively before crossing the gate', async () => {
    await withTaoFiles('tao-ship-command-', { '.tao/.gitkeep': '', 'App.tao': source }, async paths => {
      const terminal = fakeTerminal('KEY123\nissuer-id\n\n\n\n')
      let executed = false
      const result = await runShipCommand(FS.dirname(paths['App.tao']!), {
        ...terminal,
        interactive: true,
      }, {
        execute: async prepared => {
          executed = true
          Expect(prepared.entry.accepted).toEqual({
            bundleIdentifier: 'com.devtao.notes',
            datasourceConfiguration: undefined,
            issuerId: 'issuer-id',
            keyId: 'KEY123',
            namespace: 'com.devtao',
          })
        },
        inspectPreflight: async () => [],
        now: () => new Date('2026-09-02T14:05:00Z'),
      })

      Expect(result).toBe('shipped')
      Expect(executed).toBe(true)
      Expect(terminal.outputText()).toContain('Accept bundle identifier com.devtao.notes?')
    })
  })
})

async function expectFreshBuildForIneligibleCheckpoint(
  checkpoint: Partial<{
    dirty: boolean
    dirtyFingerprint: string
    distribution: 'testflight'
    processingState: 'INVALID'
  }>,
): Promise<void> {
  const inputHash = shipInputHash({
    appName: 'Notes',
    appId: 'notes',
    appVersion: '1.2.3',
    releaseDatasourceConfiguration: undefined,
  })
  const lock = {
    schemaVersion: 1,
    ship: {
      apps: {
        'notes/Notes': {
          accepted: {
            bundleIdentifier: 'com.devtao.notes',
            issuerId: 'issuer-id',
            keyId: 'KEY123',
            namespace: 'com.devtao',
          },
          appStoreAppId: 'app-42',
          identity: 'notes/Notes',
          inputHash,
          lastBuild: {
            commit: 'unversioned',
            number: '202609021405',
            processed: false,
            version: '1.2.3',
            ...checkpoint,
          },
          provenance: { at: '2026-09-02T09:01:00.000Z', command: 'tao ship', version: 1 },
          status: 'accepted',
        },
      },
    },
  }
  await withTaoFiles('tao-ship-command-', {
    '.tao/lock.jsonc': JSON.stringify(lock),
    'App.tao': source,
  }, async paths => {
    if (checkpoint.processingState !== undefined || checkpoint.dirty === true) {
      await initGitTestRepository(FS.dirname(paths['App.tao']!), {
        commit: { files: { '.tao/lock.jsonc': JSON.stringify(lock), 'App.tao': source } },
      })
    }
    const terminal = fakeTerminal()
    await runShipCommand(FS.dirname(paths['App.tao']!), {
      dryRun: true,
      ...terminal,
    }, {
      inspectPreflight: async () => [],
      now: () => new Date('2026-09-02T14:05:00Z'),
    })

    Expect(terminal.outputText()).toContain('Ship Notes 1.2.3 (202609021406)')
    Expect(terminal.outputText()).toContain('Archive and sign')
    Expect(terminal.outputText()).not.toContain('Resume uploaded')
  }, { location: 'host' })
}

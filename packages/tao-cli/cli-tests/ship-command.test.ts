import { FS } from '@shared'
import { Describe, Expect, fakeTerminal, Test, withTaoFiles } from '@shared/test'
import { runShipCommand } from '../cli-src/ship-command'
import { shipInputHash } from '../cli-src/ship-model'

const source = `project {
  id "notes"
  name "Notes"
  version "1.2.3"
  DefaultApp Notes
}
app Notes { view Main }
view Main() { }
`

Describe('tao ship command', () => {
  Test('runs discovery, preflight, version policy, and action list without a key or network in dry-run', async () => {
    await withTaoFiles('tao-ship-command-', { 'App.tao': source }, async paths => {
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
      Expect(await FS.exists(FS.resolvePath('.tao-project/lock.jsonc', FS.dirname(paths['App.tao']!)))).toBe(false)
    })
  })

  Test('requires an explicit app when neither --app nor DefaultApp selects one', async () => {
    await withTaoFiles('tao-ship-command-', {
      'App.tao': source.replace('  DefaultApp Notes\n', '').replace('app Notes', 'app Other'),
    }, async paths => {
      await Expect(runShipCommand(paths['App.tao']!, { dryRun: true, interactive: false })).rejects.toThrow(
        'has no DefaultApp',
      )
    })
  })

  Test('resumes an uploaded build after a post-upload beta failure', async () => {
    const inputHash = shipInputHash({
      appName: 'Notes',
      defaultApp: 'Notes',
      projectId: 'notes',
      releaseDatasourceConfiguration: undefined,
    })
    const lock = {
      schemaVersion: 1,
      ship: {
        apps: {
          'notes/Notes': {
            accepted: {
              bundleIdentifier: 'dev.tao-lang.notes',
              issuerId: 'issuer-id',
              keyId: 'KEY123',
              namespace: 'dev.tao-lang',
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
    await withTaoFiles('tao-ship-command-', {
      '.tao-project/lock.jsonc': JSON.stringify(lock),
      'App.tao': source,
    }, async paths => {
      const terminal = fakeTerminal()
      await runShipCommand(FS.dirname(paths['App.tao']!), {
        betaRecipients: ['friend@example.com'],
        dryRun: true,
        ...terminal,
      }, { inspectPreflight: async () => [] })

      Expect(terminal.outputText()).toContain('Resume uploaded App Store Connect build 202609020901 without rebuilding')
      Expect(terminal.outputText()).not.toContain('Archive and sign')
    })
  })

  Test('prompts for accepted identifiers interactively before crossing the gate', async () => {
    await withTaoFiles('tao-ship-command-', { 'App.tao': source }, async paths => {
      const terminal = fakeTerminal('KEY123\nissuer-id\n\n\n\n')
      let executed = false
      const result = await runShipCommand(FS.dirname(paths['App.tao']!), {
        ...terminal,
        interactive: true,
      }, {
        execute: async prepared => {
          executed = true
          Expect(prepared.entry.accepted).toEqual({
            bundleIdentifier: 'dev.tao-lang.notes',
            datasourceConfiguration: undefined,
            issuerId: 'issuer-id',
            keyId: 'KEY123',
            namespace: 'dev.tao-lang',
          })
        },
        inspectPreflight: async () => [],
        now: () => new Date('2026-09-02T14:05:00Z'),
      })

      Expect(result).toBe('shipped')
      Expect(executed).toBe(true)
      Expect(terminal.outputText()).toContain('Accept bundle identifier dev.tao-lang.notes?')
    })
  })
})

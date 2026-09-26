import { CLI, Errors, FS, Platform, ProcessTree } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test } from '@shared/test'
import { withDesktopAgentProofProfile } from '../expo-host-src/desktop-agent-proof-profile'

const proofId = '12345678-1234-1234-1234-123456789abc'
const appId = 'dev.tao.local.agentcommandsproof12345678123412341234123456789abc.12345678'

Describe('packaged agent proof profile cleanup', () => {
  Test('waits for the tracked process to exit, then removes only its successful profile', async () => {
    const webKitRoot = await mkTestDir('agent-proof-profiles-')
    const path = FS.resolvePath(appId, webKitRoot)
    const neighbor = FS.resolvePath('another-app/data', webKitRoot)
    await FS.writeText(neighbor, 'keep')
    const child = CLI.start(Platform.runtimeProcess.execPath, {
      args: ['-e', 'setInterval(() => {}, 1000)'],
      processPolicy: 'test',
      stdio: 'ignore',
    })
    const accepted = Deferred()
    let cleaned = false
    const cleanup = withDesktopAgentProofProfile({ appId, proofId, webKitRoot }, async profile => {
      profile.track([child.pid!])
      await FS.writeText(FS.resolvePath('WebsiteDataStore/LocalStorage/data', profile.path), 'proof')
      accepted.resolve()
    }).then(result => {
      cleaned = true
      return result
    })
    try {
      await accepted.promise
      await settle()
      Expect(ProcessTree.identities([child.pid!]).has(child.pid!)).toBe(true)
      Expect(cleaned).toBe(false)
      Expect(await FS.isDirectory(path)).toBe(true)
      child.kill('SIGTERM')
      await child.waitForClose()
      Expect(await cleanup).toBe(path)
      Expect(await FS.exists(path)).toBe(false)
      Expect(await FS.readText(neighbor)).toBe('keep')
    } finally {
      child.kill('SIGTERM')
      await child.waitForClose()
      child.dispose()
      await cleanup
    }
  })

  Test('retains the profile and original error when acceptance fails', async () => {
    const webKitRoot = await mkTestDir('agent-proof-failure-')
    const failure = Errors.asError('acceptance failed')
    const result = withDesktopAgentProofProfile({ appId, proofId, webKitRoot }, async profile => {
      profile.track([Platform.runtimeProcess.pid])
      await FS.writeText(FS.resolvePath('diagnostic-data', profile.path), 'keep failure')
      throw failure
    })
    await Expect(result).rejects.toBe(failure)
    Expect(await FS.readText(FS.resolvePath(`${appId}/diagnostic-data`, webKitRoot))).toBe('keep failure')
  })

  Test('refuses existing profiles and identities belonging to another run before invoking the proof', async () => {
    const webKitRoot = await mkTestDir('agent-proof-existing-')
    const existing = FS.resolvePath(`${appId}/data`, webKitRoot)
    await FS.writeText(existing, 'existing data')
    let invoked = false
    const work = async () => {
      invoked = true
    }
    await Expect(withDesktopAgentProofProfile({ appId, proofId, webKitRoot }, work))
      .rejects.toThrow('does not predate this run')
    for (
      const identity of [
        '../../another-app',
        'dev.tao.local.demo.12345678',
        appId.replace('123456789abc', '000000000000'),
      ]
    ) {
      await Expect(withDesktopAgentProofProfile({ appId: identity, proofId, webKitRoot }, work))
        .rejects.toThrow('identity matches this acceptance run')
    }
    Expect(invoked).toBe(false)
    Expect(await FS.readText(existing)).toBe('existing data')
  })

  Test('refuses a broken profile symlink before invoking the proof', async () => {
    const webKitRoot = await mkTestDir('agent-proof-symlink-')
    const path = FS.resolvePath(appId, webKitRoot)
    await FS.symlink(FS.resolvePath('missing', webKitRoot), path)
    let invoked = false
    await Expect(withDesktopAgentProofProfile({ appId, proofId, webKitRoot }, async () => {
      invoked = true
    })).rejects.toThrow('does not predate this run')
    Expect(invoked).toBe(false)
    Expect(await FS.isSymbolicLink(path)).toBe(true)
  })
})

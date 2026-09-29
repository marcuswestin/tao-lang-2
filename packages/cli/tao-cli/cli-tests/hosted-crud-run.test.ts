import { FS } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test } from '@shared/test'
import { hostedCrudRunCommand, runHostedCrud } from '../cli-src/hosted-crud-run'

async function expoProject(root: string): Promise<string> {
  const project = FS.resolvePath('Apps/Hosted CRUD', root)
  await FS.writeJson(FS.resolvePath('app.json', project), { expo: { slug: 'demo' } })
  await FS.writeText(FS.resolvePath('node_modules/.bin/expo', root), '#!/bin/sh\n')
  return project
}

function scriptedExpo(whoami: { exitCode: number; stdout: string }[]) {
  const calls: string[] = []
  const runner = async (_expo: string, args: readonly string[]) => {
    calls.push(args.join(' '))
    if (args[0] === 'whoami') {
      return { ...whoami.shift()!, stderr: '' }
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  return { calls, runner }
}

Describe('tao connect run', () => {
  Test('signs Expo CLI in before starting Metro for Expo Go', async () => {
    const root = await mkTestDir('tao-connect-run-login-')
    try {
      const project = await expoProject(root)
      const { calls, runner } = scriptedExpo([
        { exitCode: 1, stdout: 'Not logged in\n' },
        { exitCode: 0, stdout: '\u001b[32mdev-user\u001b[39m\n' },
      ])
      const terminal = fakeTerminal('yes\n')
      await runHostedCrud(project, { ...terminal, expoRunner: runner })
      Expect(calls).toEqual(['whoami', 'login', 'whoami', 'start --go'])
      Expect(terminal.outputText()).toContain('Expo CLI is signed in as dev-user.')
      Expect(terminal.outputText()).toContain('Install or open Expo Go: https://expo.dev/go')
      Expect(terminal.outputText()).toContain(
        'open the Home tab, tap the account icon at the top right, and sign in as dev-user.',
      )
      Expect(terminal.outputText()).toContain('scan the QR code with the iPhone camera')
    } finally {
      await FS.remove(root)
    }
  })

  Test('opens the iOS Simulator when Return skips the iPhone sign-in wait', async () => {
    const root = await mkTestDir('tao-connect-run-simulator-')
    try {
      const project = await expoProject(root)
      const { calls, runner } = scriptedExpo([{ exitCode: 0, stdout: 'dev-user\n' }])
      const terminal = fakeTerminal('maybe\n\n')
      await runHostedCrud(project, { ...terminal, expoRunner: runner })
      Expect(calls).toEqual(['whoami', 'start --go --ios'])
      Expect(terminal.outputText()).toContain('Type yes, or press Return.')
      Expect(terminal.outputText()).toContain('opening Expo Go in the iOS Simulator')
    } finally {
      await FS.remove(root)
    }
  })

  Test('prints ./tao inside a Tao development checkout and tao elsewhere', async () => {
    const root = await mkTestDir('tao-connect-run-command-')
    try {
      const project = await expoProject(root)
      Expect(await hostedCrudRunCommand('/no-tao-checkout/My App')).toBe("tao connect run '/no-tao-checkout/My App'")
      await FS.writeText(FS.resolvePath('tao', root), '#!/bin/sh\n')
      await FS.writeText(FS.resolvePath('packages/cli/tao-cli/cli-src/tao-cli.ts', root), '')
      Expect(await hostedCrudRunCommand(project)).toBe("./tao connect run 'Apps/Hosted CRUD'")
    } finally {
      await FS.remove(root)
    }
  })
})

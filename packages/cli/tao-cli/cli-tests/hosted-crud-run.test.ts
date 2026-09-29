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
      const terminal = fakeTerminal()
      await runHostedCrud(project, { output: terminal.output, expoRunner: runner })
      Expect(calls).toEqual(['whoami', 'login', 'whoami', 'start --go'])
      Expect(terminal.outputText()).toContain('Expo CLI is signed in as dev-user.')
      Expect(terminal.outputText()).toContain('In Expo Go on your iPhone, sign in as dev-user too')
    } finally {
      await FS.remove(root)
    }
  })

  Test('starts Metro directly when Expo CLI is already signed in', async () => {
    const root = await mkTestDir('tao-connect-run-signed-in-')
    try {
      const project = await expoProject(root)
      const { calls, runner } = scriptedExpo([{ exitCode: 0, stdout: 'dev-user\n' }])
      await runHostedCrud(project, { output: fakeTerminal().output, expoRunner: runner })
      Expect(calls).toEqual(['whoami', 'start --go'])
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

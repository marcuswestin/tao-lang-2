import { CLI, Platform } from '@shared'
import { Expect, Test } from '@shared/test'
import { runFirebaseAuthCommand } from '../dev-cli-src/firebase/FirebaseAuthCommand'

Test('Firebase auth confines operations to local account commands and preserves subprocess failure', async () => {
  const prior = Platform.runtimeProcess.env['FIREBASE_TOKEN']
  delete Platform.runtimeProcess.env['FIREBASE_TOKEN']
  const recorded: string[][] = []
  const run: typeof CLI.run = async (command, options) => {
    Expect(command).toBe('node')
    Expect(options?.stdio).toBe('inherit')
    const args = options?.args ?? []
    Expect(args[0]?.endsWith('/packages/cli/tao-cli/node_modules/firebase-tools/lib/bin/firebase.js')).toBe(true)
    recorded.push(args.slice(1))
    return { command, args: [...args], stdout: '', stderr: '', exitCode: 7, signal: null }
  }
  try {
    for (const action of ['list', 'login', 'logout']) {
      Expect(await runFirebaseAuthCommand(action, run)).toBe(7)
    }
    Expect(recorded).toEqual([['login:list'], ['login', '--reauth'], ['logout']])
    await Expect(runFirebaseAuthCommand('deploy', run)).rejects.toThrow('Choose list, login, or logout')
    await Expect(runFirebaseAuthCommand('constructor', run)).rejects.toThrow('Choose list, login, or logout')
    Expect(recorded.length).toBe(3)
    Platform.runtimeProcess.env['FIREBASE_TOKEN'] = 'private-token-canary'
    await Expect(runFirebaseAuthCommand('logout', run)).rejects.toThrow('Unset FIREBASE_TOKEN locally')
    Expect(recorded.length).toBe(3)
  } finally {
    if (prior === undefined) {
      delete Platform.runtimeProcess.env['FIREBASE_TOKEN']
    } else {
      Platform.runtimeProcess.env['FIREBASE_TOKEN'] = prior
    }
  }
})

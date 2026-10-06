import { CLI, Errors, HCI, Platform, Repo } from '@shared'

/** Local account operations use the same pinned official CLI as Tao's Firebase setup. */
export async function runFirebaseAuthCommand(action: string, run: typeof CLI.run = CLI.run): Promise<number> {
  const actions: Record<string, { args: string[]; progress: string }> = {
    list: { args: ['login:list'], progress: 'Listing locally signed-in Firebase CLI accounts…' },
    login: { args: ['login', '--reauth'], progress: 'Opening local Google sign-in for the Firebase CLI…' },
    logout: { args: ['logout'], progress: 'Signing out all locally signed-in Firebase CLI accounts…' },
  }
  if (!Object.hasOwn(actions, action)) {
    Errors.throwUserInput('Choose list, login, or logout: ./dev firebase-auth <action>.')
  }
  if (Object.hasOwn(Platform.runtimeProcess.env, 'FIREBASE_TOKEN')) {
    Errors.throwUserInput(
      'Unset FIREBASE_TOKEN locally before managing Firebase CLI sign-in. No account operation ran.',
    )
  }
  const operation = actions[action]!
  HCI.writeLine(operation.progress)
  if (action === 'login') {
    HCI.writeLine('Complete Google sign-in and consent in your browser; keep passwords local.')
  }
  const result = await run('node', {
    args: [Repo.resolvePath('packages/cli/tao-cli/node_modules/firebase-tools/lib/bin/firebase.js'), ...operation.args],
    cwd: Repo.getRoot(),
    stdio: 'inherit',
  })
  return result.exitCode ?? 1
}

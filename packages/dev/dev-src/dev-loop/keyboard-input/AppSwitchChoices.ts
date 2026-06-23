import { HCI } from '@shared'

type AppSwitchKeyAction =
  | { readonly kind: 'cancel' }
  | { readonly kind: 'choose'; readonly appPath: string }
  | { readonly kind: 'exit'; readonly exitCode: number }
  | { readonly kind: 'invalid' }

/** actionForKey maps one switch-app prompt key to its dev-loop action. */
function actionForKey(choices: readonly HCI.Choice<string>[], key: string): AppSwitchKeyAction {
  if (key === '\u0003') {
    return { kind: 'exit', exitCode: 130 }
  }
  if (key === 'q' || key === '\u001b') {
    return { kind: 'cancel' }
  }

  const index = Number(key) - 1
  const appPath = Number.isInteger(index) && index >= 0 ? choices[index]?.value : undefined
  return appPath ? { kind: 'choose', appPath } : { kind: 'invalid' }
}

/** AppSwitchChoices maps switch-app prompt keys to dev-loop actions. */
export const AppSwitchChoices = {
  actionForKey,
}

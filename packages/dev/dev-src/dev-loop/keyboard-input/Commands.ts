import { HCI } from '@shared'

type ControlKey = 'a' | 'c' | 'd' | 'e' | 'f' | 'i' | 'p' | 'q' | 'r' | 's' | 't' | 'w'

/** printControls writes the interactive dev-loop key list. */
function printControls(): void {
  HCI.writeLine(`
  ${formatControl('q', 'quit')}
  ${formatControl('d', 'reload dev process')}
  ${formatControl('r', 'recompile and reload Expo app')}
  ${formatControl('w', 'open web')}
  ${formatControl('i', 'open iOS simulator')}
  ${formatControl('a', 'open Android')}
  ${formatControl('s', 'switch app')}
  ${formatControl('c', 'clean, install deps, and reload')}
  ${formatControl('f', 'fix')}
  ${formatControl('t', 'test')}
  ${formatControl('p', 'prep')}
  ${formatControl('e', 'install IDE extension')}`)
}

function formatControl(key: ControlKey, label: string): string {
  return `${HCI.dim('›')} ${HCI.bold(HCI.white(`Press ${key}`))} ${HCI.dim('│')} ${label}`
}

const COMMAND_KEYS = ['\u0003', 'q', 'r', 'd', 'w', 'i', 'c', 'f', 't', 'p', 'e', 'a', 's'] as const

/** CommandKey names a single-key dev loop command. */
export type CommandKey = typeof COMMAND_KEYS[number]

function isCommandKey(key: string): key is CommandKey {
  return COMMAND_KEYS.includes(key as CommandKey)
}

/** Commands provides dev-loop command key helpers and display output. */
const Commands = {
  isCommandKey,
  printControls,
}

export default Commands

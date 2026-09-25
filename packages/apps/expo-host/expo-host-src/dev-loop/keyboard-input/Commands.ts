import { DevLoopOutput } from '../DevLoopOutput'

/** printControls writes the interactive dev-loop key list. */
function printControls(): void {
  DevLoopOutput.printDevLoopControls()
}

const COMMAND_KEYS = ['\u0003', 'q', 'r', 'd', 'p', 'x', 'w', 'i', 'c', 'f', 't', 'v', 'e', 'a', 's'] as const

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

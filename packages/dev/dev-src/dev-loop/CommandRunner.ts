import { Errors, HCI } from '@shared'
import Commands from './Commands'

let commandRunning = false

/** isCommandRunning returns whether an exclusive dev-loop command is active. */
function isCommandRunning(): boolean {
  return commandRunning
}

/** beginCommand starts an exclusive dev-loop command when none is active. */
function beginCommand(): boolean {
  if (commandRunning) {
    return false
  }
  commandRunning = true
  return true
}

/** endCommand finishes the active exclusive dev-loop command. */
function endCommand(): void {
  commandRunning = false
}

/** runNonInteractiveCommand runs one command while other dev-loop commands are ignored. */
async function runNonInteractiveCommand(
  label: string,
  fn: () => Promise<boolean | void>,
): Promise<void> {
  if (!beginCommand()) {
    HCI.logProcessInfo('dev', `Command already running; ignored ${label}.`)
    return
  }
  HCI.writeLine(`\n${HCI.formatProcessPrefix('dev')} ${label}`)
  try {
    const didRun = await fn()
    HCI.logProcessInfo('dev', `${label} ${didRun === false ? 'skipped' : 'done'}`)
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForLog(error))
  } finally {
    endCommand()
    Commands.printControls()
  }
}

/** CommandRunner coordinates exclusive dev-loop command execution. */
const CommandRunner = {
  beginCommand,
  endCommand,
  isCommandRunning,
  runNonInteractiveCommand,
}

export default CommandRunner

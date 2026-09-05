import { Errors } from '@shared'
import { DevLoopTUI } from './DevLoopTUI'
import Commands from './keyboard-input/Commands'

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

/** assertCommandRunning requires an exclusive dev-loop command to own the current operation. */
function assertCommandRunning(operation: string): void {
  if (!commandRunning) {
    Errors.throwUnexpected(`${operation} requires an active dev-loop command.`)
  }
}

/** runNonInteractiveCommand runs one command while other dev-loop commands are ignored. */
async function runNonInteractiveCommand(
  label: string,
  fn: () => Promise<boolean | void>,
): Promise<void> {
  if (!beginCommand()) {
    DevLoopTUI.logDevLoop('dev', `Command already running; ignored ${label}.`)
    return
  }
  DevLoopTUI.logDevLoop('dev', label)
  try {
    const didRun = await fn()
    DevLoopTUI.logDevLoop('dev', `${label} ${didRun === false ? 'skipped' : 'done'}`)
  } catch (error) {
    DevLoopTUI.logDevLoop('dev', Errors.formatForLog(error), 'error')
  } finally {
    endCommand()
    Commands.printControls()
  }
}

/** CommandRunner coordinates exclusive dev-loop command execution. */
const CommandRunner = {
  assertCommandRunning,
  beginCommand,
  endCommand,
  isCommandRunning,
  runNonInteractiveCommand,
}

export default CommandRunner

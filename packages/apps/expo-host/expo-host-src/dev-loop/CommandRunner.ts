import { Errors } from '@shared'
import { DevLoopOutput } from './DevLoopOutput'
import Commands from './keyboard-input/Commands'

let activeCommand: string | undefined

/** isCommandRunning returns whether an exclusive dev-loop command is active. */
function isCommandRunning(): boolean {
  return activeCommand !== undefined
}

/** beginCommand starts an exclusive dev-loop command when none is active. */
function beginCommand(label: string): boolean {
  if (activeCommand !== undefined) {
    return false
  }
  activeCommand = label
  return true
}

/** endCommand finishes the active exclusive dev-loop command. */
function endCommand(): void {
  activeCommand = undefined
}

/** assertCommandRunning requires an exclusive dev-loop command to own the current operation. */
function assertCommandRunning(operation: string): void {
  if (activeCommand === undefined) {
    Errors.throwUnexpected(`${operation} requires an active dev-loop command.`)
  }
}

/** runNonInteractiveCommand runs one command while other dev-loop commands are ignored. */
async function runNonInteractiveCommand(
  label: string,
  fn: () => Promise<boolean | void>,
): Promise<void> {
  if (!beginCommand(label)) {
    reportBusy(label)
    return
  }
  DevLoopOutput.logDevLoop('dev', label)
  try {
    const didRun = await fn()
    DevLoopOutput.logDevLoop('dev', `${label} ${didRun === false ? 'skipped' : 'done'}`)
  } catch (error) {
    DevLoopOutput.logDevLoop('dev', Errors.formatForLog(error), 'error')
  } finally {
    endCommand()
    Commands.printControls()
  }
}

/** Name the operation holding the lock so a person knows what they are waiting for. */
function reportBusy(ignored: string): void {
  DevLoopOutput.logDevLoop('dev', `Command already running: ${activeCommand}; ignored ${ignored}.`)
}

/** CommandRunner coordinates exclusive dev-loop command execution. */
const CommandRunner = {
  assertCommandRunning,
  beginCommand,
  endCommand,
  isCommandRunning,
  reportBusy,
  runNonInteractiveCommand,
}

export default CommandRunner

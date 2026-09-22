import { Errors, Platform } from '@shared'
import { runTestCommand } from '../../../cli/tao-cli/cli-src/test-command'

const projectRoot = Platform.runtimeProcess.argv[2]
if (projectRoot === undefined) {
  Errors.throwUserInput('The packaged Tao Studio test runner requires a project path.')
}
const observationFlag = '--journey-observations'
const observationIndex = Platform.runtimeProcess.argv.indexOf(observationFlag)
const journeyObservationsPath = observationIndex < 0
  ? undefined
  : Platform.runtimeProcess.argv[observationIndex + 1]
await runTestCommand(projectRoot, { journeyObservationsPath })

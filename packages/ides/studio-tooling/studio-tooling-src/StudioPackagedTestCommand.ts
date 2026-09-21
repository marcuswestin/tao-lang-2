import { Errors, Platform } from '@shared'
import { runTestCommand } from '../../../cli/tao-cli/cli-src/test-command'

const projectRoot = Platform.runtimeProcess.argv[2]
if (projectRoot === undefined) {
  Errors.throwUserInput('The packaged Tao Studio test runner requires a project path.')
}
await runTestCommand(projectRoot)

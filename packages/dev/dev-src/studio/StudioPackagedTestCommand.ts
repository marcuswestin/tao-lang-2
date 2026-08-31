import { Platform } from '@shared'
import { runTestCommand } from '../../../tao-cli/cli-src/test-command'

const projectRoot = Platform.runtimeProcess.argv[2]
if (projectRoot === undefined) {
  throw new Error('The packaged Tao Studio test runner requires a project path.')
}
await runTestCommand(projectRoot)

import { Errors, Platform } from '@shared'
import { installTaoSkills } from '../skills-src/tao-skills'

const projectRoot = Platform.runtimeProcess.argv[2]
if (projectRoot === undefined) {
  Errors.throwUserInput('A project directory is required.')
}
await installTaoSkills(projectRoot)

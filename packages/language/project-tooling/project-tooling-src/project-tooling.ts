export { managedDependencyModulesRoot } from './ProjectHostModules'
export {
  DEPENDENCY_NOT_INSTALLED,
  installRemedy,
  uninstalledLockedDependencies,
  validateManagedDependencyEnvironments,
} from './ProjectManagedDependencies'
export type {
  ProjectToolingOptions,
  ProjectToolingResult,
  ProjectToolingService,
  ProjectToolingSourceMapping,
  ProjectToolingWatch,
} from './ProjectTooling'
export { ProjectTooling } from './ProjectToolingService'
export {
  ensureProjectTypeScriptConfig,
  findProjectRoot,
  ProjectConfigValidationMessages,
  type ProjectTypeScriptConfigResult,
} from './ProjectTypeScriptConfig'
export {
  collectProjectTypeScriptResources,
  type ProjectTypeScriptResource,
  type ProjectTypeScriptResourceResult,
} from './ProjectTypeScriptResources'

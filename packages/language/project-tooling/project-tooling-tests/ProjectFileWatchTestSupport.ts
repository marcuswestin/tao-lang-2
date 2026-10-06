import { watch } from 'chokidar'
import { startProjectFileWatch } from '../project-tooling-src/ProjectFileWatch'
import type {
  ProjectToolingOptions,
  ProjectToolingResult,
  ProjectToolingWatch,
} from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'

/** Polling drives real disk events in this test runner; production retains chokidar's native default. */
function watchProjectWithPolling(
  root: string,
  options: ProjectToolingOptions,
  refresh: (options?: { force?: boolean }) => Promise<ProjectToolingResult> = () =>
    ProjectTooling.refresh(root, options),
): Promise<ProjectToolingWatch> {
  return startProjectFileWatch(
    root,
    options,
    refresh,
    (paths, watcherOptions) => watch(paths, { ...watcherOptions, usePolling: true, interval: 100 }),
  )
}

export { watchProjectWithPolling }

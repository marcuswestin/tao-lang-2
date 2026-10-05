import { FS, HCI } from '@shared'
import { watch } from 'chokidar'
import { createProjectRefreshLane } from './ProjectRefreshLane'
import type { ProjectToolingOptions, ProjectToolingResult, ProjectToolingWatch } from './ProjectTooling'
import {
  explicitProjectConfigWatchPaths,
  explicitProjectOwnershipWatchPaths,
  explicitProjectSidecarWatchPaths,
  ignoredProjectWatchPath,
  isProjectWatchInput,
} from './ProjectWatchPaths'

const DEBOUNCE_MS = 250

type Refresh = (options?: { force?: boolean }) => Promise<ProjectToolingResult>

/** Watch saved source and resolution inputs, then run every requested refresh in one lane. */
export async function startProjectFileWatch(
  root: string,
  options: ProjectToolingOptions,
  refresh: Refresh,
  watchFiles: typeof watch = watch,
): Promise<ProjectToolingWatch> {
  const projectRoot = FS.resolvePath(root)
  const dependencyRoots = new Set<string>()
  const configInputPaths = new Set<string>()
  const externalSidecarInputPaths = new Set<string>()
  const sidecarOwnershipInputPaths = new Set<string>()
  const dependencyWatchers = new Map<string, ReturnType<typeof watch>>()
  const externalConfigWatchers = new Map<string, ReturnType<typeof watch>>()
  const externalSidecarWatchers = new Map<string, ReturnType<typeof watch>>()
  const sidecarOwnershipWatchers = new Map<string, ReturnType<typeof watch>>()
  const onError = options.onError ?? (error => HCI.logProcessError('project-tooling-watch', String(error)))
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const watcher = watchFiles(projectRoot, {
    ignoreInitial: true,
    ignored: (path: string) =>
      ignoredProjectWatchPath(
        path,
        projectRoot,
        dependencyRoots,
        configInputPaths,
        externalSidecarInputPaths,
        sidecarOwnershipInputPaths,
      ),
  })

  const attachWatcher = async (path: string): Promise<ReturnType<typeof watch>> => {
    const addedWatcher = watchFiles(path, {
      ignoreInitial: true,
      ignored: (candidate: string) =>
        ignoredProjectWatchPath(
          candidate,
          projectRoot,
          dependencyRoots,
          configInputPaths,
          externalSidecarInputPaths,
          sidecarOwnershipInputPaths,
        ),
    })
    addedWatcher.on('all', onWatchEvent)
    addedWatcher.on('error', onError)
    try {
      await new Promise<void>((resolve, reject) => {
        addedWatcher.once('ready', resolve)
        addedWatcher.once('error', reject)
      })
      return addedWatcher
    } catch (error) {
      await addedWatcher.close()
      throw error
    }
  }

  const updateDependencyRoots = async (result: ProjectToolingResult): Promise<boolean> => {
    const next = new Set(result.dependencyRoots.map(path => FS.resolvePath(path)))
    for (const path of dependencyRoots) {
      if (!next.has(path)) {
        dependencyRoots.delete(path)
        const dependencyWatcher = dependencyWatchers.get(path)
        dependencyWatchers.delete(path)
        await dependencyWatcher?.close()
      }
    }
    let attached = false
    for (const path of next) {
      if (!dependencyRoots.has(path) && path !== projectRoot) {
        dependencyRoots.add(path)
        try {
          dependencyWatchers.set(path, await attachWatcher(path))
        } catch (error) {
          dependencyRoots.delete(path)
          throw error
        }
        attached = true
      }
    }
    return attached
  }

  const updateConfigInputs = async (result: ProjectToolingResult): Promise<boolean> => {
    const nextInputs = new Set(result.configInputPaths.map(path => FS.resolvePath(path)))
    const nextExplicit = new Set(explicitProjectConfigWatchPaths(nextInputs, projectRoot, dependencyRoots))
    for (const [path, configWatcher] of externalConfigWatchers) {
      if (!nextExplicit.has(path)) {
        externalConfigWatchers.delete(path)
        await configWatcher.close()
      }
    }
    configInputPaths.clear()
    for (const path of nextInputs) {
      configInputPaths.add(path)
    }
    let attached = false
    for (const path of nextExplicit) {
      if (!externalConfigWatchers.has(path)) {
        externalConfigWatchers.set(path, await attachWatcher(path))
        attached = true
      }
    }
    return attached
  }

  const updateExternalSidecarInputs = async (result: ProjectToolingResult): Promise<boolean> => {
    const nextInputs = new Set(result.externalSidecarInputPaths.map(path => FS.resolvePath(path)))
    const nextExplicit = new Set(explicitProjectSidecarWatchPaths(nextInputs, projectRoot, dependencyRoots))
    for (const [path, sidecarWatcher] of externalSidecarWatchers) {
      if (!nextExplicit.has(path)) {
        externalSidecarWatchers.delete(path)
        await sidecarWatcher.close()
      }
    }
    externalSidecarInputPaths.clear()
    for (const path of nextInputs) {
      externalSidecarInputPaths.add(path)
    }
    let attached = false
    for (const path of nextExplicit) {
      if (!externalSidecarWatchers.has(path)) {
        externalSidecarWatchers.set(path, await attachWatcher(path))
        attached = true
      }
    }
    return attached
  }

  const updateSidecarOwnershipInputs = async (result: ProjectToolingResult): Promise<boolean> => {
    const nextInputs = new Set(result.sidecarOwnershipInputPaths.map(path => FS.resolvePath(path)))
    const nextExplicit = new Set(explicitProjectOwnershipWatchPaths(nextInputs, projectRoot))
    for (const [path, ownershipWatcher] of sidecarOwnershipWatchers) {
      if (!nextExplicit.has(path)) {
        sidecarOwnershipWatchers.delete(path)
        await ownershipWatcher.close()
      }
    }
    sidecarOwnershipInputPaths.clear()
    for (const path of nextInputs) {
      sidecarOwnershipInputPaths.add(path)
    }
    let attached = false
    for (const path of nextExplicit) {
      if (!sidecarOwnershipWatchers.has(path)) {
        sidecarOwnershipWatchers.set(path, await attachWatcher(path))
        attached = true
      }
    }
    return attached
  }

  const lane = createProjectRefreshLane(async requestOptions => {
    let result = await refresh(requestOptions)
    let dependencyAttached = await updateDependencyRoots(result)
    let configAttached = await updateConfigInputs(result)
    let sidecarAttached = await updateExternalSidecarInputs(result)
    let ownershipAttached = await updateSidecarOwnershipInputs(result)
    // Changes made before a new watcher is ready appear as suppressed initial
    // events, so read again after attaching new resolution inputs.
    let attached = dependencyAttached || configAttached || sidecarAttached || ownershipAttached
    while (attached) {
      result = await refresh({ force: true })
      dependencyAttached = await updateDependencyRoots(result)
      configAttached = await updateConfigInputs(result)
      sidecarAttached = await updateExternalSidecarInputs(result)
      ownershipAttached = await updateSidecarOwnershipInputs(result)
      attached = dependencyAttached || configAttached || sidecarAttached || ownershipAttached
    }
    return result
  }, options.onResult)

  const schedule = (): void => {
    if (disposed) {
      return
    }
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = undefined
      void lane.requestRefresh().catch(onError)
    }, DEBOUNCE_MS)
  }
  function onWatchEvent(event: string, path: string): void {
    if (
      isProjectWatchInput(
        event,
        path,
        projectRoot,
        dependencyRoots,
        configInputPaths,
        externalSidecarInputPaths,
        sidecarOwnershipInputPaths,
      )
    ) {
      schedule()
    }
  }
  const requestRefresh: Refresh = requestOptions => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    return lane.requestRefresh(requestOptions)
  }
  watcher.on('all', onWatchEvent)
  watcher.on('error', onError)
  try {
    await new Promise<void>((resolve, reject) => {
      watcher.once('ready', resolve)
      watcher.once('error', reject)
    })
    await lane.requestRefresh()
  } catch (error) {
    disposed = true
    await watcher.close()
    await Promise.all([...dependencyWatchers.values()].map(dependencyWatcher => dependencyWatcher.close()))
    await Promise.all([...externalConfigWatchers.values()].map(configWatcher => configWatcher.close()))
    await Promise.all([...externalSidecarWatchers.values()].map(sidecarWatcher => sidecarWatcher.close()))
    await Promise.all([...sidecarOwnershipWatchers.values()].map(ownershipWatcher => ownershipWatcher.close()))
    throw error
  }

  return {
    get lastResult() {
      return lane.lastResult!
    },
    requestRefresh,
    async dispose() {
      disposed = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      await lane.dispose()
      await watcher.close()
      await Promise.all([...dependencyWatchers.values()].map(dependencyWatcher => dependencyWatcher.close()))
      await Promise.all([...externalConfigWatchers.values()].map(configWatcher => configWatcher.close()))
      await Promise.all([...externalSidecarWatchers.values()].map(sidecarWatcher => sidecarWatcher.close()))
      await Promise.all([...sidecarOwnershipWatchers.values()].map(ownershipWatcher => ownershipWatcher.close()))
    },
  }
}

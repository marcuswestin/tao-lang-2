import { FS, HCI } from '@shared'
import { watch } from 'chokidar'
import { type ProjectNativeBindingInventory, projectNativeBindingInventory } from './ProjectNativeBindingInventory'
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
const NATIVE_INVENTORY_MS = 1_000

type Refresh = (options?: { force?: boolean }) => Promise<ProjectToolingResult>

/** Watch saved source and resolution inputs, then run every requested refresh in one lane. */
export async function startProjectFileWatch(
  root: string,
  options: ProjectToolingOptions,
  refresh: Refresh,
  watchFiles: typeof watch = watch,
  readNativeInventory: typeof projectNativeBindingInventory = projectNativeBindingInventory,
): Promise<ProjectToolingWatch> {
  const projectRoot = FS.resolvePath(root)
  const dependencyRoots = new Set<string>()
  const configInputPaths = new Set<string>()
  const externalSidecarInputPaths = new Set<string>()
  const sidecarOwnershipInputPaths = new Set<string>()
  const nativeBindingPaths = new Set<string>()
  const nativeBindingAncestors = new Set<string>()
  const nativeBindingWatchers = new Map<string, ReturnType<typeof watch>>()
  const dependencyWatchers = new Map<string, ReturnType<typeof watch>>()
  const externalConfigWatchers = new Map<string, ReturnType<typeof watch>>()
  const externalSidecarWatchers = new Map<string, ReturnType<typeof watch>>()
  const sidecarOwnershipWatchers = new Map<string, ReturnType<typeof watch>>()
  const onError = options.onError ?? (error => HCI.logProcessError('project-tooling-watch', String(error)))
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let nativeTimer: ReturnType<typeof setTimeout> | undefined
  let nativeScan: Promise<void> | undefined
  let nativePlan: ProjectNativeBindingInventory | undefined
  let nativeInventory: string | undefined

  const stopNativeScan = async (): Promise<void> => {
    if (nativeTimer !== undefined) {
      clearTimeout(nativeTimer)
      nativeTimer = undefined
    }
    await nativeScan
    if (nativeTimer !== undefined) {
      clearTimeout(nativeTimer)
      nativeTimer = undefined
    }
  }
  const scheduleNativeScan = (): void => {
    if (disposed || nativePlan === undefined || nativeTimer !== undefined) {
      return
    }
    nativeTimer = setTimeout(() => {
      nativeTimer = undefined
      const plan = nativePlan!
      nativeScan = (async () => {
        const inventory = await readNativeInventory(plan)
        if (!disposed && nativePlan === plan && nativeInventory !== inventory) {
          nativeInventory = inventory
          onInputChange({ event: 'native-inventory' })
          schedule()
        }
      })().catch(onError).finally(() => {
        nativeScan = undefined
        scheduleNativeScan()
      })
    }, NATIVE_INVENTORY_MS)
  }

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
        nativeBindingPaths,
        nativeBindingAncestors,
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
          nativeBindingPaths,
          nativeBindingAncestors,
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

  const updateNativeBindings = async (result: ProjectToolingResult): Promise<boolean> => {
    const exact = [
      ...new Set([...result.nativeBindingInputPaths, ...result.nativeBindingOutputPaths]
        .map(path => FS.resolvePath(path))),
    ].sort()
    const key = JSON.stringify(exact)
    if (nativeBindingWatchers.has(key)) {
      await stopNativeScan()
      const inventory = await readNativeInventory(nativePlan!)
      if (inventory !== nativeInventory) {
        nativeInventory = inventory
        onInputChange({ event: 'native-inventory' })
        schedule()
      }
      scheduleNativeScan()
      return false
    }
    await stopNativeScan()
    nativePlan = undefined
    for (const [previous, nativeWatcher] of nativeBindingWatchers) {
      nativeBindingWatchers.delete(previous)
      await nativeWatcher.close()
    }
    nativeBindingPaths.clear()
    nativeBindingAncestors.clear()
    for (const path of exact) {
      nativeBindingPaths.add(path)
      for (let ancestor = FS.dirname(path);; ancestor = FS.dirname(ancestor)) {
        nativeBindingAncestors.add(ancestor)
        if (FS.dirname(ancestor) === ancestor) {
          break
        }
      }
    }
    if (exact.length === 0) {
      return false
    }
    const declarationRoots = result.nativeBindingInputPaths
      .filter(path => /\/node_modules\/(?:@[^/]+\/)?[^/]+$/.test(path)).map(path => FS.resolvePath(path))
    const outputRoots = result.nativeBindingOutputPaths.filter(path => FS.basename(path) === 'maintained.json')
      .map(path => FS.dirname(FS.resolvePath(path)))
    const inputDirectories = await Promise.all(
      result.nativeBindingInputPaths.map(async path => await FS.isDirectory(path) ? FS.resolvePath(path) : undefined),
    )
    // The maintained reader requires this entry at the generator root. Only its
    // verified source directory gets recursive TypeScript membership discovery.
    const generatorRoots = result.nativeBindingInputPaths.filter(path => FS.basename(path) === 'generate.ts')
      .map(path => FS.dirname(FS.resolvePath(path)))
    const shallowRoots = [
      ...new Set([
        ...(options.nativeBindings?.sourceRoots ?? []).map(path => FS.resolvePath(path)),
        ...inputDirectories.filter((path): path is string => path !== undefined),
        ...result.nativeBindingInputPaths.filter(path => /\.[cm]?tsx?$/.test(path)).map(path =>
          FS.dirname(FS.resolvePath(path))
        ),
      ]),
    ].filter(path =>
      ![...declarationRoots, ...outputRoots, ...generatorRoots].some(root => FS.pathIsWithin(path, root))
    )
    const plan = { declarationRoots, outputRoots, shallowRoots, generatorRoots }
    const baseline = await readNativeInventory(plan)
    // Exact polling avoids registering the unrelated JavaScript payloads inside
    // pinned SDK packages. Membership scans separately discover newly added inputs.
    const nativeWatcher = watchFiles(exact, {
      ignoreInitial: true,
      usePolling: true,
      interval: NATIVE_INVENTORY_MS,
      depth: 0,
      ignored: (candidate: string) => {
        const absolute = FS.resolvePath(candidate)
        return FS.isFileMutationAuxiliaryPath(absolute)
          || !nativeBindingPaths.has(absolute) && !nativeBindingAncestors.has(absolute)
      },
    })
    nativeBindingWatchers.set(key, nativeWatcher)
    nativeWatcher.on('all', (_event, candidate) => {
      if (nativeBindingPaths.has(FS.resolvePath(candidate)) && !FS.isFileMutationAuxiliaryPath(candidate)) {
        onInputChange({ path: FS.resolvePath(candidate), event: _event })
        schedule()
      }
    })
    nativeWatcher.on('error', onError)
    await new Promise<void>((resolve, reject) => {
      nativeWatcher.once('ready', resolve)
      nativeWatcher.once('error', reject)
    })
    nativePlan = plan
    nativeInventory = await readNativeInventory(plan)
    if (baseline !== nativeInventory) {
      onInputChange({ event: 'native-inventory' })
      schedule()
    }
    scheduleNativeScan()
    return true
  }

  const lane = createProjectRefreshLane(async requestOptions => {
    let result = await refresh(requestOptions)
    let dependencyAttached = await updateDependencyRoots(result)
    let configAttached = await updateConfigInputs(result)
    let sidecarAttached = await updateExternalSidecarInputs(result)
    let ownershipAttached = await updateSidecarOwnershipInputs(result)
    let nativeAttached = await updateNativeBindings(result)
    // Changes made before a new watcher is ready appear as suppressed initial
    // events, so read again after attaching new resolution inputs.
    let attached = dependencyAttached || configAttached || sidecarAttached || ownershipAttached || nativeAttached
    while (attached) {
      result = await refresh({ force: true })
      dependencyAttached = await updateDependencyRoots(result)
      configAttached = await updateConfigInputs(result)
      sidecarAttached = await updateExternalSidecarInputs(result)
      ownershipAttached = await updateSidecarOwnershipInputs(result)
      nativeAttached = await updateNativeBindings(result)
      attached = dependencyAttached || configAttached || sidecarAttached || ownershipAttached || nativeAttached
    }
    return result
  }, options.onResult)

  const onInputChange = (change: { path?: string; event: string }): void => {
    if (!disposed) {
      options.onInputChange?.(change)
    }
  }
  const schedule = (): void => {
    if (disposed || options.automaticRefresh === false) {
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
        nativeBindingPaths,
        nativeBindingAncestors,
      )
    ) {
      onInputChange({ path: FS.resolvePath(path), event })
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
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    await stopNativeScan()
    await watcher.close()
    await Promise.all([...dependencyWatchers.values()].map(dependencyWatcher => dependencyWatcher.close()))
    await Promise.all([...externalConfigWatchers.values()].map(configWatcher => configWatcher.close()))
    await Promise.all([...externalSidecarWatchers.values()].map(sidecarWatcher => sidecarWatcher.close()))
    await Promise.all([...sidecarOwnershipWatchers.values()].map(ownershipWatcher => ownershipWatcher.close()))
    await Promise.all([...nativeBindingWatchers.values()].map(nativeWatcher => nativeWatcher.close()))
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
      await stopNativeScan()
      await lane.dispose()
      await watcher.close()
      await Promise.all([...dependencyWatchers.values()].map(dependencyWatcher => dependencyWatcher.close()))
      await Promise.all([...externalConfigWatchers.values()].map(configWatcher => configWatcher.close()))
      await Promise.all([...externalSidecarWatchers.values()].map(sidecarWatcher => sidecarWatcher.close()))
      await Promise.all([...sidecarOwnershipWatchers.values()].map(ownershipWatcher => ownershipWatcher.close()))
      await Promise.all([...nativeBindingWatchers.values()].map(nativeWatcher => nativeWatcher.close()))
    },
  }
}

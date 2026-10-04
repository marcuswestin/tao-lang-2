import { CLI, FS, HCI, Platform, ProjectLocal, Repo } from '@shared'
import { type CanaryTargetOptions, resolveCanaryTarget } from './StudioCanary'
import type { StudioDevCleanupResult } from './StudioDev'
import { StudioNativeIdentity } from './StudioNativeIdentity'

/** Native tests share a consent identity, but every invocation owns its builds and state. */
async function create(artifactBase: string, id = Platform.randomUUID()): Promise<{ id: string; root: string }> {
  const root = FS.resolvePath(`invocations/${id}`, artifactBase)
  await FS.mkdir(root)
  await FS.writeJson(FS.resolvePath('invocation.json', root), {
    ownerPid: Platform.runtimeProcess.pid,
    root: await FS.realPath(root),
    version: 1,
  })
  return { id, root }
}

/** Missing ownership or a live PID is insufficient evidence to remove a sibling invocation. */
async function isInactive(root: string, runner: typeof CLI.run = CLI.run): Promise<boolean> {
  try {
    const owner = await FS.readJson<{ ownerPid?: number; root?: string; version?: number }>(
      FS.resolvePath('invocation.json', root),
    )
    const owned = owner.version === 1 && owner.root === await FS.realPath(root)
      && typeof owner.ownerPid === 'number' && Number.isInteger(owner.ownerPid) && owner.ownerPid > 1
      && !Platform.processIsAlive(owner.ownerPid)
    if (!owned) {
      return false
    }
    // A dead command can leave a native child behind. Lack of process inspection is not shutdown proof.
    const processes = await runner('/usr/sbin/lsof', { args: ['-nP', '-d', 'cwd', '-Fpn'] })
    if (processes.error !== undefined || processes.exitCode !== 0) {
      return false
    }
    return !processes.stdout.split(/\r?\n/).some(line =>
      line.startsWith('n') && FS.pathIsWithin(line.slice(1).replace(/ \(deleted\)$/, ''), owner.root!)
    )
  } catch {
    return false
  }
}

async function nativeOptions(root: string) {
  return {
    artifactRoot: FS.resolvePath('electrobun', root),
    hutchHome: Repo.resolvePath('.artifacts/tests/studio-native/hutch-home'),
    identity: await StudioNativeIdentity.forTest(),
  }
}

async function devOptions(root: string) {
  const native = await nativeOptions(root)
  return {
    devDataRoot: FS.resolvePath('dev-data', root),
    launchRecordsRoot: FS.resolvePath('launch-records', root),
    nativeArtifactRoot: native.artifactRoot,
    nativeHutchHome: native.hutchHome,
    nativeIdentity: native.identity,
    userStateRoot: FS.resolvePath('user-state', root),
  }
}

/** Discovery ignores repository scratch, so only the source projection lives in host temporary storage. */
async function project(options: CanaryTargetOptions, artifactRoot: string, repositoryRoot = Repo.getRoot()) {
  const target = resolveCanaryTarget(options, repositoryRoot)
  if (options.projectRoot !== undefined) {
    return { ...target, cleanup: async (_proof?: StudioDevCleanupResult, _survivingPids?: readonly number[]) => {} }
  }
  // This is the same host-directory pattern as mkTestDir(..., { location: 'host' }), without
  // importing a test runner into the command entry point or installing process-exit deletion.
  const projectRoot = await FS.realPath(await FS.mkTmpDir('tao-studio-native-project-'))
  const notePath = FS.resolvePath('external-directories.json', artifactRoot)
  try {
    await FS.writeJson(notePath, {
      cleanupCondition: 'Remove only after this invocation has stopped its Studio resources.',
      owner: artifactRoot,
      path: projectRoot,
      purpose: 'Disposable keyboard navigation source project for native Studio tests.',
      state: 'owned',
    })
    await FS.writeText(
      FS.resolvePath('KeyboardNavigation.tao', projectRoot),
      await FS.readText(FS.resolvePath('KeyboardNavigation.tao', target.projectRoot)),
    )
  } catch (error) {
    await FS.remove(projectRoot)
    throw error
  }
  return {
    appName: target.appName,
    projectRoot,
    async cleanup(proof?: StudioDevCleanupResult, survivingPids: readonly number[] = []) {
      if (proof?.resourcesStopped !== true || survivingPids.length > 0) {
        const reason = survivingPids.length > 0
          ? `Owned processes survived shutdown: ${survivingPids.join(', ')}.`
          : 'Studio did not confirm successful cleanup of its native and project processes.'
        await FS.writeJson(notePath, {
          cleanupCondition: 'Remove only after proving this invocation has stopped its native and project processes.',
          owner: artifactRoot,
          path: projectRoot,
          purpose: 'Disposable keyboard navigation source project for native Studio tests.',
          reason,
          state: 'retained',
        })
        HCI.logProcessWarn('studio-native', `Retained source project: ${projectRoot}. ${reason}`)
        return
      }
      const ownerPath = ProjectLocal.localResolve('sessions/owner.json', projectRoot)
      if (await FS.exists(ownerPath)) {
        const owner = await FS.readJson<{ pid?: number }>(ownerPath)
        if (typeof owner.pid !== 'number' || Platform.processIsAlive(owner.pid)) {
          HCI.logProcessWarn('studio-native', `Retained source project with unresolved live ownership: ${projectRoot}`)
          return
        }
      }
      await FS.remove(projectRoot)
      await FS.writeJson(notePath, {
        cleanupCondition: 'Removed after this invocation stopped its Studio resources.',
        owner: artifactRoot,
        path: projectRoot,
        purpose: 'Disposable keyboard navigation source project for native Studio tests.',
        state: 'removed',
      })
    },
  }
}

export const StudioNativeTestRun = { create, devOptions, isInactive, nativeOptions, project } as const

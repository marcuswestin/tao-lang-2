import { CLI, Errors, FS, Platform } from '@shared'

const metadataFileName = 'tao-studio-hutch-home.json'
const metadataVersion = 1

type HutchHomeMetadata = {
  sourceHome: string
  version: number
}

type CopyHome = (sourceHome: string, targetHome: string) => Promise<void>

type PrepareStudioHutchHomeOptions = {
  copyHome?: CopyHome
  sourceHome?: string
  targetHome: string
}

/**
 * Creates a worktree-local Hutch store. Releases, toolchains, and package archives begin as
 * copy-on-write clones on macOS, while mutable project registration is always local to this
 * worktree. Hutch therefore never consults another worktree's interrupted reader markers.
 */
async function prepare(options: PrepareStudioHutchHomeOptions): Promise<string> {
  const sourceHome = FS.resolvePath(options.sourceHome ?? defaultSourceHome())
  const targetHome = FS.resolvePath(options.targetHome)
  if (sourceHome === targetHome) {
    throw new Errors.HostEnvironmentError(
      `Tao Studio's isolated Hutch home must differ from the source Hutch home: ${sourceHome}.`,
    )
  }
  if (!await FS.isDirectory(sourceHome)) {
    throw new Errors.HostEnvironmentError(`The Hutch home to isolate does not exist: ${sourceHome}.`)
  }

  const metadata = await readMetadata(targetHome)
  if (metadata?.version === metadataVersion && metadata.sourceHome === sourceHome) {
    await resetMutableProjectState(targetHome)
    return targetHome
  }

  await sweepInterruptedPreparations(targetHome)
  const temporaryHome = `${targetHome}.preparing-${Bun.randomUUIDv7()}`
  try {
    await FS.remove(temporaryHome)
    await FS.mkdir(FS.dirname(temporaryHome))
    await (options.copyHome ?? cloneHome)(sourceHome, temporaryHome)
    await resetMutableProjectState(temporaryHome)
    await FS.writeJson(FS.resolvePath('state/store.json', temporaryHome), {
      canonicalRoot: targetHome,
      kind: 'hutch-store',
      schemaVersion: 1,
    })
    await FS.writeJson(
      FS.resolvePath(metadataFileName, temporaryHome),
      {
        sourceHome,
        version: metadataVersion,
      } satisfies HutchHomeMetadata,
    )
    await FS.remove(targetHome)
    await FS.move(temporaryHome, targetHome)
    return targetHome
  } catch (error) {
    await FS.remove(temporaryHome).catch(() => {})
    throw new Errors.HostEnvironmentError(
      `Could not prepare Tao Studio's isolated Hutch home at ${targetHome}.`,
      { cause: error, details: { sourceHome, targetHome } },
    )
  }
}

/**
 * A hard interrupt (SIGKILL, a lost machine) leaves a half-cloned `<target>.preparing-<id>` behind
 * that the catch above never reached. The next preparation removes those siblings, which only this
 * function names, before it clones again.
 */
async function sweepInterruptedPreparations(targetHome: string): Promise<void> {
  const parent = FS.dirname(targetHome)
  const prefix = `${FS.basename(targetHome)}.preparing-`
  const names = await FS.listDir(parent).catch((): string[] => [])
  await Promise.all(
    names.filter(name => name.startsWith(prefix)).map(async name => await FS.remove(FS.resolvePath(name, parent))),
  )
}

/**
 * Removes only locks beneath a generated project after its complete process tree was proven
 * stopped. Foreign projects and the source Hutch store are never inspected or changed here.
 */
async function clearStoppedProjectLocks(projectRoot: string): Promise<void> {
  const lockRoot = FS.resolvePath('.hutch/locks', projectRoot)
  await FS.remove(FS.resolvePath('electrobun-build.lock', lockRoot))
  await FS.remove(FS.resolvePath('electrobun-readers', lockRoot))
}

async function readMetadata(targetHome: string): Promise<HutchHomeMetadata | undefined> {
  try {
    const value = await FS.readJson<unknown>(FS.resolvePath(metadataFileName, targetHome))
    if (
      typeof value === 'object' && value !== null
      && typeof (value as Record<string, unknown>)['sourceHome'] === 'string'
      && typeof (value as Record<string, unknown>)['version'] === 'number'
    ) {
      return value as HutchHomeMetadata
    }
  } catch {
    // A missing or interrupted cache is rebuilt below from the installed Hutch home.
  }
  return undefined
}

async function resetMutableProjectState(hutchHome: string): Promise<void> {
  const projectRegistry = FS.resolvePath('state/projects', hutchHome)
  const projectLocks = FS.resolvePath('state/locks/projects', hutchHome)
  const temporaryState = FS.resolvePath('state/tmp', hutchHome)
  await FS.remove(projectRegistry)
  await FS.remove(projectLocks)
  await FS.remove(temporaryState)
  await FS.mkdir(projectRegistry)
  await FS.mkdir(projectLocks)
  await FS.mkdir(temporaryState)
}

async function cloneHome(sourceHome: string, targetHome: string): Promise<void> {
  const result = await CLI.run('/bin/cp', { args: ['-cR', `${sourceHome}/.`, targetHome] })
  if (result.error !== undefined || result.exitCode !== 0) {
    throw new Errors.CommandExecutionError(result)
  }
}

function defaultSourceHome(): string {
  const configured = Platform.runtimeProcess.env['HUTCH_HOME']?.trim()
  return configured === undefined || configured === ''
    ? FS.resolvePath('.hutch', FS.homeDir())
    : FS.resolvePath(configured)
}

export const StudioHutchHome = {
  clearStoppedProjectLocks,
  prepare,
  testing: { resetMutableProjectState },
} as const

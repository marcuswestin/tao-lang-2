import { CLI, FS, HCI, Json, Platform, Repo, Text } from '@shared'

/*
 * A tracked Tao project whose lock pins npm packages compiles only after `tao install` has linked
 * them into its own node_modules, which Git does not carry. Setup provisions each such project so a
 * fresh checkout compiles the maintained apps the suites exercise. A project whose installed packages
 * already match every pin is left alone, so a repeated setup costs one manifest read per package.
 */

type Pin = { alias: string; version: string; modulesRoot: string }

/** projectsNeedingInstall lists tracked Tao projects, relative to the repository, whose pins are not installed. */
export async function projectsNeedingInstall(repositoryRoot: string): Promise<string[]> {
  const listed = await CLI.mustRun('git', {
    args: ['ls-files', '-z', '--', '.tao/lock.jsonc', '*/.tao/lock.jsonc'],
    cwd: repositoryRoot,
  })
  const projects: string[] = []
  for (const lockPath of listed.stdout.split('\0').filter(path => path !== '')) {
    const project = FS.dirname(FS.dirname(lockPath))
    const pins = await lockedPins(FS.resolvePath(project, repositoryRoot))
    for (const pin of pins) {
      const manifest = FS.resolvePath(`${pin.alias}/package.json`, pin.modulesRoot)
      if (!await FS.isFile(manifest) || (await FS.readJson<{ version?: string }>(manifest)).version !== pin.version) {
        projects.push(project)
        break
      }
    }
  }
  return projects
}

/** Mirrors `ManagedInstallEnvironment.modulesRoot`: the project's own tree, or its origin's private one. */
async function lockedPins(projectRoot: string): Promise<Pin[]> {
  const parsed: unknown = JSON.parse(Text.stripJsonc(await FS.readText(FS.resolvePath('.tao/lock.jsonc', projectRoot))))
  const installs = Json.isRecord(parsed) ? parsed['installs'] : undefined
  const environments = Json.isRecord(installs) ? installs['environments'] : undefined
  if (!Json.isRecord(environments)) {
    return []
  }
  const pins: Pin[] = []
  for (const environment of Object.values(environments)) {
    if (!Json.isRecord(environment) || !Json.isRecord(environment['npm'])) {
      continue
    }
    const origin = FS.resolvePath(String(environment['projectRoot'] ?? '.'), projectRoot)
    const modulesRoot = origin === projectRoot
      ? FS.resolvePath('node_modules', projectRoot)
      : FS.resolvePath(`.tao/install/origins/${Platform.sha256Hex(origin)}/node_modules`, projectRoot)
    for (const [alias, pin] of Object.entries(environment['npm'])) {
      if (Json.isRecord(pin) && typeof pin['version'] === 'string') {
        pins.push({ alias, version: pin['version'], modulesRoot })
      }
    }
  }
  return pins
}

if (import.meta.main) {
  const repositoryRoot = Repo.getRoot()
  HCI.writeLine('Checking Tao project dependencies...')
  for (const project of await projectsNeedingInstall(repositoryRoot)) {
    HCI.writeLine(`Installing Tao project dependencies for ${project}...`)
    await CLI.mustRun('./tao', {
      args: ['install', project],
      cwd: repositoryRoot,
      // The agent sandbox may write ~/.cache but not npm's default ~/.npm.
      env: {
        npm_config_cache: Platform.runtimeProcess.env['npm_config_cache'] ?? FS.resolvePath('.cache/npm', FS.homeDir()),
      },
      stdio: 'stream',
    })
  }
}

import { uninstalledLockedDependencies } from '@project-tooling'
import { CLI, FS, HCI, Platform, Repo } from '@shared'

/*
 * A tracked Tao project whose lock pins npm packages compiles only after `tao install` has linked
 * them into its own node_modules, which Git does not carry. Setup provisions each such project so a
 * fresh checkout compiles the maintained apps the suites exercise. A project whose installed packages
 * already match every pin is left alone, so a repeated setup costs one manifest read per package.
 */

/** projectsNeedingInstall lists tracked Tao projects, relative to the repository, whose pins are not installed. */
export async function projectsNeedingInstall(repositoryRoot: string): Promise<string[]> {
  const listed = await CLI.mustRun('git', {
    args: ['ls-files', '-z', '--', '.tao/lock.jsonc', '*/.tao/lock.jsonc'],
    cwd: repositoryRoot,
  })
  const projects: string[] = []
  for (const lockPath of listed.stdout.split('\0').filter(path => path !== '')) {
    const project = FS.dirname(FS.dirname(lockPath))
    if ((await uninstalledLockedDependencies(FS.resolvePath(project, repositoryRoot))).length > 0) {
      projects.push(project)
    }
  }
  return projects
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

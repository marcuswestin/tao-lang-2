import { CLI, FS, Json, Repo, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

/** Tracked Tao projects whose lock pins npm packages, which `tao install` builds a tree for. */
async function projectsPinningNpm(): Promise<string[]> {
  const listed = await CLI.mustRun('git', {
    args: ['ls-files', '-z', '--', '.tao/store/lock.jsonc', '*/.tao/store/lock.jsonc'],
    cwd: Repo.getRoot(),
  })
  const projects: string[] = []
  for (const lockPath of listed.stdout.split('\0').filter(path => path !== '')) {
    const lock: unknown = JSON.parse(Text.stripJsonc(await FS.readText(Repo.resolvePath(lockPath))))
    const installs = Json.isRecord(lock) ? lock['installs'] : undefined
    const environments = Json.isRecord(installs) ? installs['environments'] : undefined
    const pinsNpm = Json.isRecord(environments)
      && Object.values(environments).some(environment =>
        Json.isRecord(environment) && Json.isRecord(environment['npm'])
        && Object.keys(environment['npm']).length > 0
      )
    if (pinsNpm) {
      projects.push(FS.dirname(FS.dirname(FS.dirname(lockPath))))
    }
  }
  return projects.toSorted()
}

Describe('Verify workflow caches', () => {
  Test('caches the installed npm tree of every tracked Tao project that pins npm packages', async () => {
    const workflow: unknown = Bun.YAML.parse(await FS.readText(Repo.resolvePath('.github/workflows/verify.yml')))
    const env = Json.isRecord(workflow) ? workflow['env'] : undefined
    const listed = Json.isRecord(env) && typeof env['TAO_INSTALL_PATHS'] === 'string'
      ? env['TAO_INSTALL_PATHS'].split('\n').filter(line => line !== '').toSorted()
      : []
    const projects = await projectsPinningNpm()
    Expect(projects.length).toBeGreaterThan(0)
    Expect(listed).toEqual(
      projects.flatMap(project => [`${project}/.tao/cache/install`, `${project}/node_modules`]).toSorted(),
    )
  })
})

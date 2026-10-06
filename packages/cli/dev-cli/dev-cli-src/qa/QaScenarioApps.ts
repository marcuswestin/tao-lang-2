import { Packages } from '@ast-utils'
import Compiler from '@compiler'
import { Workspace } from '@compiler/workspace'
import { AST, Parser } from '@parser'
import { CLI, Errors, FS, TaoFiles } from '@shared'

export type QaScenarioApp = {
  id: string
  project: string
  entry: string
  app: string
  cells: { source: string; group: string; label: string }[]
}

type QaScenarioDiscovery = {
  apps: QaScenarioApp[]
  failures: { source: string; error: string }[]
}

const excludedDirectories = new Set([
  ...TaoFiles.discoveryExcludeDirectoryNames,
  '.git',
  '.tao',
  '.artifacts',
  '.expo',
  '.hutch',
  '.gradle',
  '.cache',
  '.claude',
  '.codex',
  '.cursor',
  '.agents',
  '.ssh',
  '.aws',
  '.devenv',
  '.direnv',
  '.next',
  '.turbo',
  'vendor',
  'dist',
  'build',
  'coverage',
])

type Source = {
  path: string
  absolutePath: string
  /** An unlinked syntax scan cannot infer an alias's value family; resolve candidates in Workspace. */
  appCandidates: boolean
  scenarios: boolean
}

/** QaScenarioApps discovers project apps and Studio-visible scenario cells from authored Tao sources. */
export class QaScenarioApps {
  constructor(private readonly root: string) {}

  async discover(paths?: readonly string[]): Promise<QaScenarioDiscovery> {
    const discovery: QaScenarioDiscovery = { apps: [], failures: [] }
    const pathList = paths === undefined ? await this.gitPaths() : [...paths]
    const realRoot = await FS.realPath(this.root)
    const sources: Source[] = []
    for (const path of [...new Set(pathList)].sort()) {
      if (!this.isAuthoredAppSource(path)) {
        continue
      }
      const absolutePath = FS.resolvePath(path, this.root)
      try {
        if (await FS.isSymbolicLink(absolutePath)) {
          continue
        }
        if (!await FS.isFile(absolutePath)) {
          discovery.failures.push({ source: path, error: 'Authored Tao source is missing.' })
          continue
        }
        const realPath = await FS.realPath(absolutePath)
        if (!FS.pathIsWithin(realPath, realRoot)) {
          discovery.failures.push({ source: path, error: 'Authored Tao source resolves outside the repository.' })
          continue
        }
        const parsed = Parser.parseSyntax(await FS.readText(absolutePath))
        if (parsed.errors > 0) {
          discovery.failures.push({
            source: path,
            error: parsed.diagnostics.map(diagnostic => diagnostic.message).join(' ')
              || 'Tao syntax could not be parsed.',
          })
        }
        sources.push({
          path,
          absolutePath,
          appCandidates: parsed.ast.statements.some(statement =>
            AST.isAppDeclaration(statement) || AST.isAliasDeclaration(statement)
          ),
          scenarios: parsed.ast.statements.some(AST.isScenarioGroupDeclaration),
        })
      } catch (error) {
        discovery.failures.push({ source: path, error: Errors.formatForUser(error) })
      }
    }

    const scenarioSources = sources.filter(source => source.scenarios)
    const projectRoots = new Map<string, Source[]>()
    const rootsBySource = new Map<string, string | undefined>()
    const projectRootSweep = Packages.createProjectRootSweep()
    for (const source of sources) {
      rootsBySource.set(
        source.absolutePath,
        await Packages.containingProjectRoot(FS.dirname(source.absolutePath), projectRootSweep),
      )
    }
    for (const source of scenarioSources) {
      const projectRoot = rootsBySource.get(source.absolutePath)
      if (projectRoot === undefined) {
        discovery.failures.push({
          source: source.path,
          error: 'Scenario source has no containing Tao project marker.',
        })
        continue
      }
      const members = projectRoots.get(projectRoot) ?? []
      members.push(source)
      projectRoots.set(projectRoot, members)
    }

    for (
      const [projectRoot, scenarioMembers] of [...projectRoots.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ) {
      const projectSources = sources.filter(source => {
        return rootsBySource.get(source.absolutePath) === projectRoot
      })
      const appSources = projectSources.filter(source => source.appCandidates)
      if (appSources.length === 0) {
        for (const source of scenarioMembers) {
          discovery.failures.push({ source: source.path, error: 'Scenario project contains no app declarations.' })
        }
        continue
      }
      try {
        const workspace = await Workspace.open(projectRoot)
        // Studio's project publication also reaches unimported scenario sources, including sketches.
        const entryPaths = [
          ...new Set(
            [...appSources, ...scenarioMembers].map(source => source.absolutePath),
          ),
        ].sort()
        const parseResults = await workspace.parseFiles(entryPaths)
        const resultsByEntry = new Map(parseResults.map(result => [result.entry.path, result]))
        const scenarioResults = scenarioMembers.map(source => resultsByEntry.get(source.absolutePath)!)
        const scenarioErrors = scenarioResults.flatMap(result =>
          result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => ({
            source: FS.relativePath(this.root, result.entry.path),
            error: diagnostic.message,
          }))
        )
        if (scenarioErrors.length > 0) {
          discovery.failures.push(...scenarioErrors)
          continue
        }
        const failuresBefore = discovery.failures.length
        let projectAppCount = 0
        for (const source of appSources) {
          const parsed = resultsByEntry.get(source.absolutePath)
          if (parsed === undefined) {
            discovery.failures.push({ source: source.path, error: 'Workspace did not return the app entry parse.' })
            continue
          }
          const errors = parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
          if (errors.length > 0) {
            discovery.failures.push({
              source: source.path,
              error: errors.map(diagnostic => diagnostic.message).join(' '),
            })
            continue
          }
          const project = FS.relativePath(this.root, projectRoot)
          const apps = AST.appValueDeclarationsInFile(parsed.entry.ast)
          projectAppCount += apps.length
          for (const app of apps) {
            try {
              const previewFiles = [...new Map(
                [...parsed.files, ...scenarioResults.flatMap(result => result.files)]
                  .map(file => [file.path, file]),
              ).values()]
              const manifest = Compiler.compileStudioPreviewManifest(previewFiles, app.name, projectRoot)
              const cells = manifest.scenarios
                .filter(scenario => scenario.subject.kind === 'view' || scenario.subject.appName === app.name)
                .map(scenario => ({
                  source: FS.relativePath(projectRoot, scenario.source.path),
                  group: scenario.group,
                  label: scenario.name,
                }))
              if (cells.length > 0) {
                discovery.apps.push({
                  id: `visual:${project}/${app.name}`,
                  project,
                  entry: FS.relativePath(projectRoot, source.absolutePath),
                  app: app.name,
                  cells,
                })
              }
            } catch (error) {
              discovery.failures.push({ source: source.path, error: Errors.formatForUser(error) })
            }
          }
        }
        if (projectAppCount === 0 && discovery.failures.length === failuresBefore) {
          for (const source of scenarioMembers) {
            discovery.failures.push({ source: source.path, error: 'Scenario project contains no app declarations.' })
          }
        }
      } catch (error) {
        discovery.failures.push({
          source: FS.relativePath(this.root, projectRoot),
          error: Errors.formatForUser(error),
        })
      }
    }

    discovery.apps.sort((left, right) => left.id.localeCompare(right.id))
    discovery.apps = discovery.apps.map(app => ({
      ...app,
      cells: app.cells.sort((left, right) =>
        left.source.localeCompare(right.source) || left.group.localeCompare(right.group)
        || left.label.localeCompare(right.label)
      ),
    }))
    discovery.failures.sort((left, right) =>
      left.source.localeCompare(right.source) || left.error.localeCompare(right.error)
    )
    return discovery
  }

  private async gitPaths(): Promise<string[]> {
    const git = await CLI.mustRun('git', {
      args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      cwd: this.root,
    })
    return git.stdout.split('\0').filter(Boolean)
  }

  private isAuthoredAppSource(path: string): boolean {
    if (!path.startsWith('Apps/') || !path.endsWith('.tao') || path.endsWith('.test.tao')) {
      return false
    }
    const segments = path.split('/')
    return !segments.some(segment =>
      excludedDirectories.has(segment)
      || segment.startsWith('_gen_')
      || segment.toLowerCase() === 'tao future'
      || ['archive', 'archives'].includes(segment.toLowerCase())
      || segment === '..'
      || /^\.env(?:\.|$)/u.test(segment)
      || /^(?:secrets?|credentials?)(?:\..*)?$/iu.test(segment)
    ) && !/(?:^|\/)(?:secrets?|credentials?)(?:\.[^/]*)?$/iu.test(path)
      && !/\.(?:pem|key|p12|pfx|keystore)$/iu.test(path)
  }
}

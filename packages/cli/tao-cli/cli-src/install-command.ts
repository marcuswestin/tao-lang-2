import { Packages } from '@ast-utils'
import { OutputText } from '@cli-kit/OutputText'
import { CompilerDependencies, type DependencyEnvironment, type DependencySelection } from '@compiler'
import { discoverProjectTaoFiles, Workspace } from '@compiler/workspace'
import { type ProjectGraph, type ProjectRequirement } from '@parser'
import { CLI, Diagnostics, Errors, FS, HCI, ProjectIdentity, Time } from '@shared'
import { ManagedInstallEnvironment } from './managed-install-environment'
import { findTaoProjectSource } from './project-root'
import { installEnvironmentsByProjectRoot, type InstallsLock, readProjectLock, writeProjectLock } from './ship-lock'

export type InstallOptions = HCI.OutputOptions & {
  appName?: string
  publicationName?: string
  defaultPublication?: boolean
}

type NpmRequirement = { alias: string; name: string; requested: string }
/** A requirement with the version to install, and whether an earlier install recorded its alias. */
type NpmInstallItem = NpmRequirement & { owned: boolean; version: string }
type NpmPin = InstallsLock['environments'][string]['npm'][string]
type InstallDependencies = {
  installNpm?: (directory: string, consumerRoot: string, args: readonly string[]) => Promise<void>
  nowMs?: () => number
}
type InstallProgress = {
  npmInvocations: number
  run<T>(phase: string, announcement: string, work: () => Promise<T>): Promise<T>
  say(message: string): void
}

/** Install selected npm requirements in namespaces owned by each physical Tao project. */
export async function runTaoInstall(
  targetPath = '.',
  options: InstallOptions = {},
  dependencies: InstallDependencies = {},
): Promise<void> {
  if ([options.appName, options.publicationName, options.defaultPublication].filter(Boolean).length > 1) {
    Errors.throwUserInput('Select one --app, --publication, or --default-publication for a scoped install.')
  }
  const say = (message: string) => HCI.writeLine(message, options)
  const now = dependencies.nowMs ?? Time.nowMs
  const started = now()
  const progress: InstallProgress = {
    npmInvocations: 0,
    say,
    async run<T>(phase: string, announcement: string, work: () => Promise<T>): Promise<T> {
      say(`${announcement}...`)
      const phaseStarted = now()
      try {
        const result = await work()
        say(`Finished ${phase} (${OutputText.formatElapsed(Math.round(now() - phaseStarted))}).`)
        return result
      } catch (error) {
        say(`Failed ${phase} after ${OutputText.formatElapsed(Math.round(now() - phaseStarted))}.`)
        throw error
      }
    },
  }
  try {
    const { root } = await progress.run(
      'project location',
      `Locating Tao project at ${FS.displayPath(targetPath)}`,
      () => findTaoProjectSource(targetPath),
    )
    await progress.run(
      'project preparation',
      `Preparing project ${FS.displayPath(root)}`,
      () => ProjectIdentity.ensure(root),
    )
    const sourcePaths = await progress.run('source discovery', 'Discovering Tao source files', async () => {
      const discovered = await discoverProjectTaoFiles(root)
      const owners = await Promise.all(discovered.map(path => Packages.containingProjectRoot(FS.dirname(path))))
      const sourcePaths = discovered.filter((_, index) => owners[index] === root)
      if (sourcePaths.length === 0) {
        Errors.throwUserInput(`No Tao source was found in ${root}.`)
      }
      return sourcePaths
    })
    const workspace = await progress.run('workspace open', 'Opening Tao workspace', () => Workspace.open(root))
    const validation = await progress.run(
      'source validation',
      `Validating ${sourcePaths.length} Tao source files`,
      async () => {
        const result = await workspace.validateFiles(sourcePaths)
        if (Diagnostics.hasError(result.diagnostics)) {
          Errors.throwUserInput(Diagnostics.errors(result.diagnostics).map(item => item.message).join('\n'))
        }
        return result
      },
    )
    const { graph, selection, environments } = await progress.run(
      'dependency resolution',
      'Resolving app and package dependencies',
      async () => {
        const context = await Packages.createContext(root)
        const graph = Packages.createResolver(context).projectGraph({
          fromFilePath: sourcePaths[0]!,
          workspaceFiles: validation.files.map(file => file.ast),
        })
        const selection = selectGraphSelection(graph, options)
        return { graph, selection, environments: CompilerDependencies.collect(graph, selection) }
      },
    )
    const previous = await progress.run('dependency lock read', 'Reading dependency lock', () => readProjectLock(root))
    const installs: InstallsLock = {
      lockfileVersion: 2,
      environments: installEnvironmentsByProjectRoot(previous.installs?.environments ?? {}),
      local: { ...previous.installs?.local },
    }
    for (const environment of environments) {
      await progress.run(
        `dependency preparation for ${FS.displayPath(environment.projectRoot)}`,
        `Preparing dependencies for ${FS.displayPath(environment.projectRoot)}`,
        () => ProjectIdentity.ensure(environment.projectRoot),
      )
      await installEnvironment(root, environment, installs, dependencies, progress)
    }
    await progress.run('local dependency recording', 'Recording local Tao dependencies', async () => {
      const visited = new Set<string>()
      for (const requirement of selectedRequirements(graph, selection)) {
        recordLocalRequirements(root, requirement, installs.local, visited)
      }
    })
    await progress.run(
      'dependency lock write',
      'Saving dependency lock',
      () => writeProjectLock(root, { ...previous, installs }),
    )
    HCI.writeSuccess(
      `Installed dependencies for ${FS.displayPath(root)} in ${OutputText.formatElapsed(Math.round(now() - started))} `
        + `(${progress.npmInvocations} npm ${progress.npmInvocations === 1 ? 'invocation' : 'invocations'}).\n`,
      options,
    )
  } catch (error) {
    say(
      `Install failed after ${OutputText.formatElapsed(Math.round(now() - started))} `
        + `(${progress.npmInvocations} npm ${progress.npmInvocations === 1 ? 'invocation' : 'invocations'}).`,
    )
    throw error
  }
}

function selectGraphSelection(graph: ProjectGraph, options: InstallOptions): DependencySelection {
  if (options.appName !== undefined) {
    const app = graph.appRequirements.find(entry => entry.app.name === options.appName)?.app
    if (app === undefined) {
      Errors.throwUserInput(`No app named '${options.appName}' was found in this project.`)
    }
    return { kind: 'app', app }
  }
  if (options.publicationName !== undefined || options.defaultPublication === true) {
    const publication = graph.publications.find(item =>
      options.defaultPublication === true ? item.name === undefined : item.name === options.publicationName
    )
    if (publication === undefined) {
      Errors.throwUserInput('No matching publication was found for the requested install scope.')
    }
    return { kind: 'publication', publication }
  }
  return { kind: 'project' }
}

function selectedRequirements(graph: ProjectGraph, selection: DependencySelection): readonly ProjectRequirement[] {
  if (selection.kind === 'app') {
    return graph.appRequirements.find(entry => entry.app === selection.app)?.requirements ?? []
  }
  if (selection.kind === 'publication') {
    return selection.publication.requirements
  }
  return graph.requirements
}

function recordLocalRequirements(
  consumerRoot: string,
  requirement: ProjectRequirement,
  local: InstallsLock['local'],
  visited: Set<string>,
): void {
  if (requirement.declaration.ts) {
    return
  }
  const selected = requirement.selectedPublication
  if (selected === undefined || requirement.targetProjectRoot === undefined || selected.version === undefined) {
    Errors.throwUserInput('A local Tao dependency has no selected publication. Check its locator and version.')
  }
  const sourceRoot = FS.resolvePath(requirement.sourceRoot)
  const targetRoot = FS.resolvePath(requirement.targetProjectRoot)
  const sourceRelative = FS.relativePath(consumerRoot, sourceRoot) || '.'
  const key = `${sourceRelative}->${FS.relativePath(consumerRoot, targetRoot)}#${selected.name ?? ''}`
  local[key] = {
    sourceRoot: sourceRelative,
    root: FS.relativePath(consumerRoot, targetRoot),
    ...(selected.name === undefined ? {} : { publication: selected.name }),
    version: selected.version,
    bindings: {
      ...local[key]?.bindings,
      ...Object.fromEntries(requirement.bindings.map(binding => [
        binding.localName,
        FS.relativePath(targetRoot, binding.origin.modulePath),
      ])),
    },
  }
  if (visited.has(key)) {
    return
  }
  visited.add(key)
  for (const child of selected.requirements) {
    recordLocalRequirements(consumerRoot, child, local, visited)
  }
}

async function installEnvironment(
  consumerRoot: string,
  environment: DependencyEnvironment,
  installs: InstallsLock,
  dependencies: InstallDependencies,
  progress: InstallProgress,
): Promise<void> {
  const namespace = environment.namespace
  const projectRoot = FS.relativePath(consumerRoot, environment.projectRoot) || '.'
  const previous = installs.environments[projectRoot]
  const entry: InstallsLock['environments'][string] = {
    projectRoot,
    npm: { ...previous?.npm },
    publications: environment.publications.map(item => ({ ...item })),
  }
  const modulesRoot = ManagedInstallEnvironment.modulesRoot(consumerRoot, environment.projectRoot, namespace)
  const selected = environment.npm.map((requirement): NpmInstallItem => {
    const item = { alias: requirement.alias, name: requirement.packageName, requested: requirement.versionRange }
    const prior = entry.npm[item.alias]
    const version = prior?.name === item.name && prior.requested === item.requested
      ? prior.version
      : item.requested
    return { ...item, owned: prior !== undefined, version }
  })
  if (selected.length > 0) {
    Object.assign(
      entry.npm,
      await installNpmEnvironment(consumerRoot, modulesRoot, namespace, selected, entry.npm, dependencies, progress),
    )
  }
  installs.environments[projectRoot] = entry
  if (FS.resolvePath(environment.projectRoot) !== FS.resolvePath(consumerRoot) && environment.npm.length > 0) {
    const link = ManagedInstallEnvironment.generatedModulesLink(consumerRoot, namespace)
    await progress.run(
      `dependency link for ${FS.displayPath(environment.projectRoot)}`,
      `Linking dependencies for ${FS.displayPath(environment.projectRoot)}`,
      () => ensureManagedLink(modulesRoot, link, `generated dependency namespace '${namespace}'`),
    )
  }
}

/**
 * Installs every selected alias of one origin with a single npm invocation into the origin's shared
 * prefix, then links each alias into the origin's modules root. One tree per origin lets npm resolve
 * the aliases together, so a peer they share, such as `expo`, is installed once rather than per alias.
 */
async function installNpmEnvironment(
  consumerRoot: string,
  modulesRoot: string,
  namespace: string,
  selected: readonly NpmInstallItem[],
  recorded: Readonly<Record<string, NpmPin>>,
  dependencies: InstallDependencies,
  progress: InstallProgress,
): Promise<Record<string, NpmPin>> {
  const directory = ManagedInstallEnvironment.environmentRoot(consumerRoot, namespace)
  const installed = (alias: string) => FS.resolvePath(`node_modules/${alias}`, directory)
  const linkPath = (alias: string) => FS.resolvePath(alias, modulesRoot)
  const managedTargets = (alias: string) => [
    installed(alias),
    ManagedInstallEnvironment.legacyPackageRoot(consumerRoot, namespace, alias) + `/node_modules/${alias}`,
  ]
  const label = selected.map(item =>
    `${item.name}@${item.version}${item.alias === item.name ? '' : ` as ${item.alias}`}`
  )
    .join(', ')
  const noun = selected.length === 1 ? 'package' : 'packages'
  // An alias an earlier, differently scoped install linked stays in the shared manifest, because
  // npm prunes from the tree whatever its manifest no longer lists.
  const retained: NpmInstallItem[] = []
  await progress.run(
    `npm ${noun} preparation for ${label}`,
    `Preparing npm ${noun} ${label}`,
    async () => {
      for (const item of selected) {
        if (item.owned) {
          if (!await isManagedLink(linkPath(item.alias), managedTargets(item.alias), true)) {
            Errors.throwUserInput(
              `Cannot update npm alias '${item.alias}': ${linkPath(item.alias)} is no longer Tao-managed.`,
            )
          }
        } else if (await FS.exists(linkPath(item.alias)) || await FS.isSymbolicLink(linkPath(item.alias))) {
          Errors.throwUserInput(`Cannot install npm alias '${item.alias}': ${linkPath(item.alias)} is not Tao-managed.`)
        }
      }
      for (const [alias, pin] of Object.entries(recorded)) {
        if (
          !selected.some(item => item.alias === alias)
          && await isManagedLink(linkPath(alias), managedTargets(alias), false)
        ) {
          retained.push({ alias, name: pin.name, owned: true, requested: pin.requested, version: pin.version })
        }
      }
      const manifestPath = FS.resolvePath('package.json', directory)
      const wanted = [...selected, ...retained].toSorted((a, b) => a.alias.localeCompare(b.alias))
      const manifest = `${
        JSON.stringify(
          {
            private: true,
            dependencies: Object.fromEntries(wanted.map(item => [item.alias, `npm:${item.name}@${item.version}`])),
          },
          null,
          2,
        )
      }\n`
      if (!await FS.exists(manifestPath) || await FS.readText(manifestPath) !== manifest) {
        await FS.writeText(manifestPath, manifest)
      }
    },
  )
  const args = ['install', '--prefix', directory, '--no-audit', '--no-fund']
  await progress.run(
    `npm ${noun} ${label}`,
    `Checking/installing npm ${noun} ${label}`,
    async () => {
      progress.npmInvocations++
      if (dependencies.installNpm === undefined) {
        await CLI.mustRun('npm', { args, cwd: consumerRoot, stdio: 'stream' })
      } else {
        await dependencies.installNpm(directory, consumerRoot, args)
      }
    },
  )
  const pins: Record<string, NpmPin> = {}
  for (const item of [...selected, ...retained]) {
    const version = await progress.run(
      `npm alias link ${item.alias}`,
      `Linking npm alias ${item.alias}`,
      async () => {
        const manifest = await FS.readJson<{ version: string }>(FS.resolvePath('package.json', installed(item.alias)))
        if (!await isManagedLink(linkPath(item.alias), [installed(item.alias)], false)) {
          await FS.replaceSymlink(installed(item.alias), linkPath(item.alias))
        }
        return manifest.version
      },
    )
    if (selected.includes(item)) {
      pins[item.alias] = { name: item.name, requested: item.requested, version }
    }
  }
  // Every alias this origin recorded now links into the shared prefix, so the per-alias trees an
  // earlier layout installed are unreferenced.
  await FS.remove(ManagedInstallEnvironment.legacyNamespaceRoot(consumerRoot, namespace))
  return pins
}

/**
 * isManagedLink reports whether `linkPath` is a symlink to one of `targets`; an absent link counts
 * as managed only when `absentIsManaged` says so.
 */
async function isManagedLink(linkPath: string, targets: readonly string[], absentIsManaged: boolean): Promise<boolean> {
  if (!await FS.exists(linkPath) && !await FS.isSymbolicLink(linkPath)) {
    return absentIsManaged
  }
  const existing = await FS.entryMetadata(linkPath)
  return existing.kind === 'symlink' && targets.includes(FS.resolvePath(existing.linkTarget!, FS.dirname(linkPath)))
}

async function ensureManagedLink(target: string, link: string, label: string): Promise<void> {
  if (await FS.exists(link) || await FS.isSymbolicLink(link)) {
    const existing = await FS.entryMetadata(link)
    if (existing.kind !== 'symlink' || FS.resolvePath(existing.linkTarget!, FS.dirname(link)) !== target) {
      Errors.throwUserInput(`Cannot update ${label}: ${link} is not Tao-managed.`)
    }
  }
  if (!await FS.isSymbolicLink(link)) {
    await FS.replaceSymlink(target, link)
  }
}

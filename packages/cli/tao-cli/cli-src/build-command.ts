import { Packages } from '@ast-utils'
import { CompilerDependencies, type DependencyEnvironment } from '@compiler'
import { BridgeMetadata } from '@compiler/bridge-metadata'
import { discoverProjectTaoFiles, Workspace } from '@compiler/workspace'
import Runtime, { HostDependencies, RuntimeToolchainPaths } from '@expo-host'
import { ProjectTooling } from '@project-tooling'
import {
  Assert,
  CLI,
  Diagnostics,
  Errors,
  FS,
  HCI,
  Platform,
  ProjectIdentity,
  ProjectLocal,
  readFirebaseConnections,
  ReleaseCapabilities,
  Repo,
} from '@shared'
import { AgentClientBuild } from './agent-client-build'
import { TaoAppModules } from './app-modules'
import { buildDesktopApp } from './desktop-build'
import { chooseTaoApp } from './dev-app-selection'
import { ManagedInstallEnvironment } from './managed-install-environment'
import { exportVisionOSProject } from './visionos-project'
import { exportWatchOSProject } from './watchos-project'

export type BuildTarget = 'web' | 'desktop' | 'ios' | 'android' | 'visionos' | 'watchos'
export type BuildRecord = {
  appName: string
  createdAt: string
  id: string
  mode: 'artifact' | 'compile-only'
  projectRoot: string
  results: Partial<Record<BuildTarget, { artifact: string; status: 'succeeded' } | { error: string; status: 'failed' }>>
  schemaVersion: 1
  releaseProfile: string
  sourceDigest?: string
  targets: BuildTarget[]
  toolchainVersion: string
  agentExecutable?: string
}

type BuildOptions = {
  appName?: string
  compileOnly?: boolean
  targets: readonly BuildTarget[]
  agents?: boolean
  output?: string
}
const targets = ['web', 'desktop', 'ios', 'android', 'visionos', 'watchos'] as const
const runtimeFiles = [
  'index.ts',
  'expo-host-src/ManagedLoopIdentityMarker.ts',
  'app.json',
  'app.config.js',
  'app-config.cjs',
  'metro.config.cjs',
  'package.json',
] as const
const excludedSourceDirectories = new Set(['.git', '.tao', '.tao-ts', '.artifacts', '.expo', 'node_modules'])

/** Build each requested target from the same immutable source snapshot, retaining every result. */
export async function runTaoBuild(path: string, options: BuildOptions): Promise<number> {
  if (options.agents) {
    ReleaseCapabilities.require('app-commands')
  }
  const selectedTargets = await chooseTargets(
    options.agents && options.targets.length === 0 ? ['desktop'] : options.targets,
  )
  for (const target of selectedTargets) {
    ReleaseCapabilities.require(ReleaseCapabilities.targetCapability(target))
  }
  if (options.agents && (options.compileOnly || selectedTargets.some(target => target !== 'desktop'))) {
    Errors.throwUserInput('--agents requires a packaged desktop build.')
  }
  const app = await chooseTaoApp(path, options.appName, 'Build')
  await TaoAppModules.ensureProject(app.projectRoot)
  const refreshed = await ProjectTooling.refresh(app.projectRoot, { runtimeRoot: TaoAppModules.runtimeRoot() })
  if (refreshed.status !== 'fresh') {
    Errors.throwUserInput(refreshed.diagnostics.map(diagnostic => diagnostic.message).join('\n'))
  }
  const buildsRoot = options.output
    ? FS.resolvePath(options.output)
    : ProjectLocal.localResolve('builds', app.projectRoot)
  if (
    FS.pathIsWithin(buildsRoot, app.projectRoot)
    && !['.tao', '.artifacts'].includes(FS.relativePath(app.projectRoot, buildsRoot).split('/')[0]!)
  ) {
    Errors.throwUserInput('Build output inside the source project must be under .tao or .artifacts.')
  }
  const id = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${Platform.randomUUID().slice(0, 8)}`
  const artifactRoot = FS.resolvePath(id, buildsRoot)
  const dependencyEnvironments = await selectedDependencyEnvironments(app.projectRoot, app.appName)
  const roots = [...new Set(dependencyEnvironments.map(environment => FS.resolvePath(environment.projectRoot)))]
  await Promise.all(roots.map(root => ProjectIdentity.ensure(root)))
  const externalSidecars = [...new Set(refreshed.externalSidecarInputPaths.map(path => FS.resolvePath(path)))]
    .toSorted()
  const commonRoot = commonProjectAncestor([...roots, ...externalSidecars.map(path => FS.dirname(path))])
  const record: BuildRecord = {
    appName: app.appName,
    createdAt: new Date().toISOString(),
    id,
    mode: options.compileOnly === true ? 'compile-only' : 'artifact',
    projectRoot: app.projectRoot,
    results: {},
    schemaVersion: 1,
    releaseProfile: ReleaseCapabilities.fingerprint(),
    targets: [...selectedTargets],
    toolchainVersion:
      (await FS.readJson<{ version: string }>(FS.resolvePath('package.json', RuntimeToolchainPaths.packageRoot)))
        .version,
  }
  if (!options.output) {
    await ProjectLocal.prepare(app.projectRoot)
  }
  const progress = new BuildProgress(selectedTargets, id)
  // External host sidecars must remain outside any containing Tao project after snapshotting.
  // Ordinary snapshots still use Git-aware, explicitly requested worktree scratch projects.
  const workRoot = await FS.realPath(
    externalSidecars.length > 0
      ? await FS.mkTmpDir('tao-build-')
      : await Repo.mkScratchDirOrHost('tao-build-'),
  )
  try {
    const snapshotBase = FS.resolvePath('source', workRoot)
    const snapshotRootFor = (root: string) => FS.resolvePath(FS.relativePath(commonRoot, root), snapshotBase)
    const snapshotRoot = snapshotRootFor(app.projectRoot)
    const snapshotApp = FS.resolvePath(FS.relativePath(app.projectRoot, app.appPath), snapshotRoot)
    progress.start()
    const sourceDigests = await Promise.all(
      roots.toSorted().map(async root =>
        `${FS.relativePath(commonRoot, root)}:${await snapshotProject(root, snapshotRootFor(root))}`
      ),
    )
    const externalDigests = await snapshotExternalSidecars(externalSidecars, commonRoot, snapshotBase)
    for (const root of roots) {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', snapshotRootFor(root)), '')
    }
    const installedDigests = await snapshotInstalledEnvironments(
      app.projectRoot,
      snapshotRoot,
      dependencyEnvironments,
      snapshotRootFor,
    )
    record.sourceDigest = Platform.sha256Hex([...sourceDigests, ...externalDigests, ...installedDigests].join('\n'))
    await TaoAppModules.ensureProject(snapshotRoot)
    const snapshotRefresh = await ProjectTooling.refresh(snapshotRoot, { runtimeRoot: TaoAppModules.runtimeRoot() })
    if (snapshotRefresh.status !== 'fresh') {
      Errors.throwUserInput(snapshotRefresh.diagnostics.map(diagnostic => diagnostic.message).join('\n'))
    }
    await FS.mkdir(artifactRoot)
    const retainedModulesRoot = FS.resolvePath('dependencies', artifactRoot)
    if (options.compileOnly) {
      await retainCompiledEnvironments(
        app.projectRoot,
        snapshotRoot,
        dependencyEnvironments,
        snapshotRootFor,
        retainedModulesRoot,
      )
    }
    await FS.writeJson(FS.resolvePath('build.json', artifactRoot), record)
    progress.snapshotComplete()
    record.results = await executeBuildTargets(selectedTargets, async target => {
      if (target === 'watchos') {
        const compiled = await Workspace.compile(snapshotApp, { appName: app.appName, target: 'watchos' })
        const outputRoot = FS.resolvePath(options.compileOnly ? 'compiled/watchos' : 'watchos', artifactRoot)
        if (options.compileOnly) {
          for (const file of compiled.files) {
            await FS.writeText(FS.resolvePath(file.relativePath, outputRoot), file.code)
          }
          return outputRoot
        }
        Assert.defined(compiled.entryArtifact, 'watch compilation provides an entry artifact')
        return await exportWatchOSProject({
          appName: app.appName,
          displayName: compiled.displayName,
          outputRoot,
          files: compiled.files,
          entryArtifact: compiled.entryArtifact,
        })
      }
      if (options.compileOnly === true) {
        const compileRoot = FS.resolvePath(`compiled/${target}`, artifactRoot)
        const generated = await Runtime.generateApp(snapshotApp, {
          appName: app.appName,
          runtimePackageRoot: compileRoot,
          moduleLinkRoot: retainedModulesRoot,
        })
        return FS.dirname(generated.outputPath)
      }
      if (target === 'ios' || target === 'android') {
        Errors.throwUserInput(`Local ${target} builds are not yet implemented.`)
      }
      const site = FS.resolvePath(
        'site',
        target === 'web' ? FS.resolvePath('web', artifactRoot) : FS.resolvePath(target, workRoot),
      )
      await exportWeb(snapshotApp, app.appName, workRoot, site, target)
      if (target === 'web') {
        return await finishWebArtifact(site)
      }
      if (target === 'visionos') {
        return await exportVisionOSProject({
          appName: app.appName,
          outputRoot: FS.resolvePath('visionos', artifactRoot),
          siteRoot: site,
          testSource: await visionosNativeTestSource(app.appName),
        })
      }
      const desktop = await buildDesktopApp({
        appName: app.appName,
        outputRoot: FS.resolvePath('desktop', artifactRoot),
        siteRoot: site,
        agents: options.agents ? { buildId: id } : undefined,
      })
      if (options.agents) {
        record.agentExecutable = await AgentClientBuild.build(desktop, buildsRoot, workRoot)
      }
      return desktop
    }, (target, status) => progress.set(target, status))
    for (const target of selectedTargets) {
      if (record.results[target]?.status === 'failed') {
        const partial = options.compileOnly === true ? `compiled/${target}` : target
        await FS.remove(FS.resolvePath(partial, artifactRoot))
      }
    }
    if (options.compileOnly && selectedTargets.every(target => record.results[target]?.status === 'failed')) {
      await FS.remove(retainedModulesRoot)
    }
    await FS.writeJson(FS.resolvePath('build.json', artifactRoot), record)
  } finally {
    progress.stop()
    await FS.remove(workRoot)
  }
  for (const target of selectedTargets) {
    const result = record.results[target]
    if (result?.status === 'failed') {
      HCI.writeErrorLine(`${target}: ${result.error}`)
    }
    if (result?.status === 'succeeded') {
      HCI.writeSuccess(`${target}: built ${FS.displayPath(result.artifact)}\n`)
    }
  }
  HCI.writeLine(`Build record: ${FS.displayPath(FS.resolvePath('build.json', artifactRoot))}`)
  if (record.agentExecutable) {
    HCI.writeLine(`Agent CLI: ${FS.displayPath(record.agentExecutable)}`)
  }
  return selectedTargets.some(target => record.results[target]?.status !== 'succeeded') ? 1 : 0
}

/** Execute independent targets concurrently, preserving success and error for every target. */
export async function executeBuildTargets(
  requested: readonly BuildTarget[],
  build: (target: BuildTarget) => Promise<string>,
  status: (target: BuildTarget, state: 'building' | 'failed' | 'succeeded') => void,
): Promise<BuildRecord['results']> {
  const results: BuildRecord['results'] = {}
  await Promise.all(requested.map(async target => {
    status(target, 'building')
    try {
      results[target] = { artifact: await build(target), status: 'succeeded' }
      status(target, 'succeeded')
    } catch (error) {
      results[target] = { error: Errors.formatForUser(error), status: 'failed' }
      status(target, 'failed')
    }
  }))
  return results
}

class BuildProgress {
  private readonly states = new Map<BuildTarget, 'pending' | 'building' | 'failed' | 'succeeded'>()
  private snapshot = false
  private active = false

  constructor(targets: readonly BuildTarget[], private readonly id: string) {
    for (const target of targets) {
      this.states.set(target, 'pending')
    }
  }

  start(): void {
    this.active = true
    if (HCI.isInteractive()) {
      HCI.write('\u001b[?1049h')
    }
    if (HCI.isInteractive()) {
      this.render()
    } else {
      HCI.writeLine(`Snapshotting source for build ${this.id}`)
    }
  }

  snapshotComplete(): void {
    this.snapshot = true
    if (HCI.isInteractive()) {
      this.render()
    }
  }

  set(target: BuildTarget, status: 'building' | 'failed' | 'succeeded'): void {
    this.states.set(target, status)
    if (HCI.isInteractive()) {
      this.render()
    } else {
      HCI.writeLine(`${target}: ${status}`)
    }
  }

  stop(): void {
    if (!this.active) {
      return
    }
    if (HCI.isInteractive()) {
      HCI.write('\u001b[?1049l')
    }
    this.active = false
  }

  private render(): void {
    if (!this.active) {
      return
    }
    const lines = [
      `Tao build ${this.id}`,
      `Source snapshot: ${this.snapshot ? 'ready' : 'copying'}`,
      '',
      ...[...this.states].map(([target, status]) => `${target.padEnd(9)} ${status}`),
      '',
      'Successful artifacts are retained even if another target fails.',
    ]
    HCI.write(`\u001b[H\u001b[2J${lines.join('\n')}\n`)
  }
}

async function chooseTargets(requested: readonly BuildTarget[]): Promise<BuildTarget[]> {
  if (requested.length > 0) {
    return targets.filter(target => requested.includes(target))
  }
  if (ReleaseCapabilities.current().phase !== 'development') {
    return ['web']
  }
  if (!HCI.isInteractive()) {
    Errors.throwUserInput(
      'Choose build targets with --web, --desktop, --ios, --android, --visionos, and/or --watchos in a non-interactive terminal.',
    )
  }
  HCI.writeLine(
    'Build targets: 1. web  2. desktop  3. iOS (not yet implemented)  4. Android (not yet implemented)  5. visionOS (Xcode project)  6. watchOS (SwiftUI Xcode project)',
  )
  const answer = await HCI.askText({
    message: 'Select target numbers (comma-separated)',
    validate: value =>
      parseTargetSelection(value) === undefined ? `Choose one or more numbers from 1 to ${targets.length}.` : undefined,
  })
  return parseTargetSelection(answer)!
}

function parseTargetSelection(value: string): BuildTarget[] | undefined {
  const parts = value.split(',').map(part => part.trim())
  if (parts.some(part => !/^\d+$/.test(part) || Number(part) < 1 || Number(part) > targets.length)) {
    return undefined
  }
  return targets.filter((_, index) => parts.includes(String(index + 1)))
}

/** Select the same physical dependency closure compilation will use for this app. */
async function selectedDependencyEnvironments(
  projectRoot: string,
  appName: string,
): Promise<readonly DependencyEnvironment[]> {
  const discovered = await discoverProjectTaoFiles(projectRoot)
  const owners = await Promise.all(discovered.map(path => Packages.containingProjectRoot(FS.dirname(path))))
  const sourcePaths = discovered.filter((_, index) => owners[index] === projectRoot)
  if (sourcePaths.length === 0) {
    Errors.throwUserInput(`No Tao source was found in ${projectRoot}.`)
  }
  const workspace = await Workspace.open(projectRoot)
  const validation = await workspace.validateFiles(sourcePaths)
  if (Diagnostics.hasError(validation.diagnostics)) {
    Errors.throwUserInput(Diagnostics.errors(validation.diagnostics).map(diagnostic => diagnostic.message).join('\n'))
  }
  const context = await Packages.createContext(projectRoot)
  const graph = Packages.createResolver(context).projectGraph({
    fromFilePath: sourcePaths[0]!,
    workspaceFiles: validation.files.map(file => file.ast),
  })
  const app = graph.appRequirements.find(entry => entry.app.name === appName)?.app
  if (app === undefined) {
    Errors.throwUserInput(`No app named '${appName}' was found in ${projectRoot}.`)
  }
  return CompilerDependencies.collect(graph, { kind: 'app', app })
}

/** Preserve every relative Tao locator by placing selected roots below their common ancestor. */
function commonProjectAncestor(roots: readonly string[]): string {
  let common = FS.resolvePath(roots[0]!)
  while (roots.some(root => !FS.pathIsWithin(root, common))) {
    const parent = FS.dirname(common)
    Assert.input(parent !== common, 'Selected Tao projects have no common filesystem ancestor.')
    common = parent
  }
  return common
}

/** Preserve relative imports while copying only the reached files outside selected project trees. */
async function snapshotExternalSidecars(
  paths: readonly string[],
  commonRoot: string,
  snapshotBase: string,
): Promise<string[]> {
  const copied: { path: string; digest: string }[] = []
  for (const path of paths) {
    if (await FS.isSymbolicLink(path)) {
      Errors.throwUserInput(`Build source contains a symlink; copy it into the project first: ${FS.displayPath(path)}`)
    }
    if (!await FS.isFile(path)) {
      continue
    }
    const content = await FS.readFile(path)
    const digest = Platform.sha256Hex(content)
    const relativePath = FS.relativePath(commonRoot, path)
    await FS.writeFile(FS.resolvePath(relativePath, snapshotBase), content)
    copied.push({ path, digest })
  }
  for (const path of paths) {
    const original = copied.find(entry => entry.path === path)
    if (await FS.isSymbolicLink(path) || await FS.isFile(path) !== (original !== undefined)) {
      Errors.throwUserInput('External sidecar files changed while creating the build snapshot; retry the build.')
    }
    if (original !== undefined && Platform.sha256Hex(await FS.readFile(path)) !== original.digest) {
      Errors.throwUserInput('External sidecar files changed while creating the build snapshot; retry the build.')
    }
  }
  return copied.map(({ path, digest }) => `${FS.relativePath(commonRoot, path)}:${digest}`)
}

/** Copy only selected, Tao-managed npm packages into the snapshot's recomputed namespaces. */
async function snapshotInstalledEnvironments(
  originalRoot: string,
  snapshotRoot: string,
  environments: readonly DependencyEnvironment[],
  snapshotRootFor: (root: string) => string,
): Promise<string[]> {
  const digests: string[] = []
  for (const environment of environments) {
    if (environment.npm.length === 0) {
      continue
    }
    const origin = FS.resolvePath(environment.projectRoot)
    const snapshotOrigin = snapshotRootFor(origin)
    const snapshotNamespace = BridgeMetadata.dependencyNamespace(snapshotOrigin)
    const originalModules = ManagedInstallEnvironment.modulesRoot(originalRoot, origin, environment.namespace)
    const snapshotModules = ManagedInstallEnvironment.modulesRoot(snapshotRoot, snapshotOrigin, snapshotNamespace)
    for (const requirement of environment.npm) {
      const sourcePackageRoot = ManagedInstallEnvironment.packageRoot(
        originalRoot,
        environment.namespace,
        requirement.alias,
      )
      const sourcePackage = FS.resolvePath(`node_modules/${requirement.alias}`, sourcePackageRoot)
      const sourceAlias = FS.resolvePath(requirement.alias, originalModules)
      const resolvedAlias = await FS.realPath(sourceAlias).catch(() => undefined)
      if (
        !await FS.isDirectory(sourcePackage)
        || resolvedAlias !== await FS.realPath(sourcePackage).catch(() => undefined)
      ) {
        Errors.throwUserInput(`Build dependency '${requirement.alias}' is not Tao-managed; run tao install first.`)
      }
      const snapshotPackageRoot = ManagedInstallEnvironment.packageRoot(
        snapshotRoot,
        snapshotNamespace,
        requirement.alias,
      )
      const sourceModules = FS.resolvePath('node_modules', sourcePackageRoot)
      const snapshotModulesForAlias = FS.resolvePath('node_modules', snapshotPackageRoot)
      const before = await installTreeIdentity(sourceModules)
      await FS.copyDirectory(sourceModules, snapshotModulesForAlias)
      if (
        await installTreeIdentity(sourceModules) !== before
        || await installTreeIdentity(snapshotModulesForAlias) !== before
      ) {
        Errors.throwUserInput(
          `Build dependency '${requirement.alias}' changed while creating the snapshot; retry the build.`,
        )
      }
      digests.push(`${FS.relativePath(originalRoot, origin)}:${requirement.alias}:${before}`)
      await FS.replaceSymlink(
        FS.resolvePath(`node_modules/${requirement.alias}`, snapshotPackageRoot),
        FS.resolvePath(requirement.alias, snapshotModules),
      )
    }
    if (origin !== originalRoot) {
      await FS.replaceSymlink(
        snapshotModules,
        ManagedInstallEnvironment.generatedModulesLink(snapshotRoot, snapshotNamespace),
      )
    }
  }
  return digests
}

/** Compile-only output outlives the scratch source; retain its managed packages beside the artifact. */
async function retainCompiledEnvironments(
  originalRoot: string,
  snapshotRoot: string,
  environments: readonly DependencyEnvironment[],
  snapshotRootFor: (root: string) => string,
  retainedRoot: string,
): Promise<void> {
  for (const environment of environments) {
    const snapshotOrigin = snapshotRootFor(FS.resolvePath(environment.projectRoot))
    const namespace = BridgeMetadata.dependencyNamespace(snapshotOrigin)
    const retainedModules = ManagedInstallEnvironment.modulesRoot(
      retainedRoot,
      FS.resolvePath(environment.projectRoot) === FS.resolvePath(originalRoot) ? retainedRoot : snapshotOrigin,
      namespace,
    )
    for (const requirement of environment.npm) {
      const snapshotPackageRoot = ManagedInstallEnvironment.packageRoot(snapshotRoot, namespace, requirement.alias)
      const sourceModules = FS.resolvePath('node_modules', snapshotPackageRoot)
      const retainedPackageRoot = ManagedInstallEnvironment.packageRoot(retainedRoot, namespace, requirement.alias)
      const retainedPackageModules = FS.resolvePath('node_modules', retainedPackageRoot)
      const before = await installTreeIdentity(sourceModules)
      await FS.copyDirectory(sourceModules, retainedPackageModules)
      if (await installTreeIdentity(retainedPackageModules) !== before) {
        Errors.throwUserInput(`Build dependency '${requirement.alias}' changed while retaining compiled output.`)
      }
      await FS.replaceSymlink(
        FS.resolvePath(`node_modules/${requirement.alias}`, retainedPackageRoot),
        FS.resolvePath(requirement.alias, retainedModules),
      )
    }
  }
}

async function installTreeIdentity(root: string): Promise<string> {
  const entries: string[] = []
  for await (const path of FS.walk(root, { includeHidden: true })) {
    const relative = FS.relativePath(root, path)
    if (await FS.isSymbolicLink(path)) {
      const target = await FS.realPath(path).catch(() => undefined)
      if (target === undefined || !FS.pathIsWithin(target, root)) {
        Errors.throwUserInput(`Installed npm dependency contains a link outside its environment: ${path}`)
      }
      entries.push(`${relative}:link:${(await FS.entryMetadata(path)).linkTarget}`)
    } else {
      entries.push(`${relative}:file:${Platform.sha256Hex(await FS.readFile(path))}`)
    }
  }
  return Platform.sha256Hex(entries.toSorted().join('\n'))
}

async function snapshotProject(projectRoot: string, snapshotRoot: string): Promise<string> {
  const realRoot = await FS.realPath(projectRoot)
  const firebase = await firebaseConnectionSnapshot(projectRoot)
  const sources: string[] = []
  for await (
    const source of FS.walk(projectRoot, {
      includeHidden: true,
      excludeDirectory: name => excludedSourceDirectories.has(name),
    })
  ) {
    sources.push(source)
  }
  const digests: string[] = []
  for (const source of sources.sort()) {
    if (await FS.isSymbolicLink(source)) {
      Errors.throwUserInput(
        `Build source contains a symlink; copy it into the project first: ${FS.displayPath(source)}`,
      )
    }
    const realSource = await FS.realPath(source)
    if (!FS.pathIsWithin(realSource, realRoot)) {
      Errors.throwUserInput(`Build source escapes the project: ${source}`)
    }
    const content = await FS.readFile(source)
    digests.push(`${FS.relativePath(projectRoot, source)}:${Platform.sha256Hex(content)}`)
    await FS.writeFile(FS.resolvePath(FS.relativePath(projectRoot, source), snapshotRoot), content)
  }
  const lockPath = FS.resolvePath('.tao/store/lock.jsonc', projectRoot)
  const identityPath = FS.resolvePath('.tao/store/project.json', projectRoot)
  const identity = await FS.readFile(identityPath)
  digests.push(`.tao/store/project.json:${Platform.sha256Hex(identity)}`)
  await FS.writeFile(FS.resolvePath('.tao/store/project.json', snapshotRoot), identity)
  const lock = await FS.isFile(lockPath) ? await FS.readFile(lockPath) : undefined
  if (lock !== undefined) {
    digests.push(`.tao/store/lock.jsonc:${Platform.sha256Hex(lock)}`)
    await FS.writeFile(FS.resolvePath('.tao/store/lock.jsonc', snapshotRoot), lock)
  }
  if (firebase !== undefined) {
    digests.push(`.tao/local/connections.json:${Platform.sha256Hex(firebase)}`)
    await FS.writeText(FS.resolvePath('.tao/local/connections.json', snapshotRoot), firebase)
  }
  const after: string[] = []
  for await (
    const source of FS.walk(projectRoot, {
      includeHidden: true,
      excludeDirectory: name => excludedSourceDirectories.has(name),
    })
  ) {
    after.push(source)
  }
  if (after.sort().join('\n') !== sources.join('\n')) {
    Errors.throwUserInput('Project files changed while creating the build snapshot; retry the build.')
  }
  for (const [index, source] of sources.entries()) {
    const current = `${FS.relativePath(projectRoot, source)}:${Platform.sha256Hex(await FS.readFile(source))}`
    if (current !== digests[index]) {
      Errors.throwUserInput('Project files changed while creating the build snapshot; retry the build.')
    }
  }
  if (lock !== undefined && Platform.sha256Hex(await FS.readFile(lockPath)) !== Platform.sha256Hex(lock)) {
    Errors.throwUserInput('Project lock changed while creating the build snapshot; retry the build.')
  }
  if (Platform.sha256Hex(await FS.readFile(identityPath)) !== Platform.sha256Hex(identity)) {
    Errors.throwUserInput('Project identity changed while creating the build snapshot; retry the build.')
  }
  if (await firebaseConnectionSnapshot(projectRoot) !== firebase) {
    Errors.throwUserInput('Firebase settings changed while creating the build snapshot; retry the build.')
  }
  return Platform.sha256Hex(digests.join('\n'))
}

async function firebaseConnectionSnapshot(projectRoot: string): Promise<string | undefined> {
  const firebase = await readFirebaseConnections(projectRoot)
  return firebase === undefined ? undefined : JSON.stringify({
    firebase: Object.fromEntries(Object.entries(firebase).toSorted(([left], [right]) => left.localeCompare(right))),
  })
}

async function exportWeb(
  appPath: string,
  appName: string,
  workRoot: string,
  siteRoot: string,
  target: BuildTarget,
): Promise<void> {
  const toolchainRoot = RuntimeToolchainPaths.packageRoot
  const runtimeRoot = FS.resolvePath(`runtime-${target}`, workRoot)
  for (const file of runtimeFiles) {
    const source = FS.resolvePath(file, toolchainRoot)
    if (!await FS.isFile(source)) {
      Errors.throwHostEnvironment(`Tao's Expo host is missing ${source}.`)
    }
    await FS.copyFile(source, FS.resolvePath(file, runtimeRoot))
  }
  await FS.copyDirectory(FS.resolvePath('plugins', toolchainRoot), FS.resolvePath('plugins', runtimeRoot))
  // An installed Tao resolves its host's packages on first use; inside a checkout this does nothing.
  await HostDependencies.ensure()
  const modules = RuntimeToolchainPaths.dependencyRoot()
  if (!await FS.isDirectory(modules)) {
    Errors.throwHostEnvironment(`Tao's Expo host dependencies are not installed at ${modules}.`)
  }
  await FS.symlink(modules, FS.resolvePath('node_modules', runtimeRoot))
  await Runtime.generateApp(appPath, { appName, runtimePackageRoot: runtimeRoot })
  const expo = RuntimeToolchainPaths.expoCommand(runtimeRoot, ['export', '--platform', 'web', '--output-dir', siteRoot])
  const result = await CLI.run(expo.command, {
    args: expo.args,
    cwd: runtimeRoot,
    env: {
      ...Platform.runtimeProcess.env,
      ...expo.env,
      CI: '1',
      EXPO_NO_DOTENV: '1',
      TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: toolchainRoot,
    },
    processPolicy: 'test',
    timeoutMs: 180_000,
    idleOutputMs: 45_000,
  })
  if (result.error || result.exitCode !== 0) {
    Errors.throwHostEnvironment(
      `Expo web export failed: ${
        result.stderr.trim() || result.stdout.trim() || result.error?.message || 'unknown error'
      }`,
    )
  }
  if (!await FS.isFile(FS.resolvePath('index.html', siteRoot))) {
    Errors.throwHostEnvironment('Expo web export produced no index.html.')
  }
}

async function finishWebArtifact(siteRoot: string): Promise<string> {
  const parent = FS.dirname(siteRoot)
  // The launcher depends only on Bun, not on the Tao CLI or development checkout.
  await FS.writeText(
    FS.resolvePath('run', parent),
    [
      '#!/bin/sh',
      'set -eu',
      'cd "$(dirname "$0")"',
      'exec bun serve.ts',
      '',
    ].join('\n'),
  )
  await FS.writeText(
    FS.resolvePath('serve.ts', parent),
    [
      'import { realpath } from "node:fs/promises"',
      'import { isAbsolute, relative, resolve, sep } from "node:path"',
      'import { fileURLToPath } from "node:url"',
      '',
      'const site = fileURLToPath(new URL("./site/", import.meta.url))',
      'const realSite = await realpath(site)',
      'const port = Number(Bun.env.PORT ?? 8080)',
      'const server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {',
      '  const url = new URL(request.url)',
      '  let path = decodePath(url.pathname)',
      '  if (path === undefined || path.includes("\\0")) return new Response("Bad path", { status: 400 })',
      '  if (path.endsWith("/")) path += "index.html"',
      '  const candidate = resolve(site, "." + path)',
      '  if (!isWithin(candidate, site)) return new Response("Bad path", { status: 400 })',
      '  let filePath: string',
      '  try { filePath = await realpath(candidate) } catch { return new Response("Not found", { status: 404 }) }',
      '  if (!isWithin(filePath, realSite)) return new Response("Bad path", { status: 400 })',
      '  const file = Bun.file(filePath)',
      '  if (await file.exists()) return new Response(file)',
      '  return new Response("Not found", { status: 404 })',
      '} })',
      'globalThis.console["log"](`Serving http://localhost:${server.port}`)',
      '',
      'function decodePath(path: string): string | undefined {',
      '  for (let attempt = 0; attempt < 32; attempt++) {',
      '    try {',
      '      const decoded = decodeURIComponent(path)',
      '      if (decoded === path) return decoded',
      '      path = decoded',
      '    } catch { return undefined }',
      '  }',
      '  return undefined',
      '}',
      '',
      'function isWithin(path: string, root: string): boolean {',
      '  const pathFromRoot = relative(root, path)',
      '  return pathFromRoot === "" || (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(".." + sep))',
      '}',
      '',
    ].join('\n'),
  )
  await FS.chmod(FS.resolvePath('run', parent), 0o755)
  return parent
}

/** visionosNativeTestSource loads XCTest sources owned by the testing package for known sample apps. */
async function visionosNativeTestSource(appName: string): Promise<string | undefined> {
  if (appName !== 'VisionHello') {
    return undefined
  }
  const path = Repo.resolvePath('packages/testing/e2e-testing/native/visionos/VisionHelloTests.swift')
  return await FS.isFile(path) ? await FS.readText(path) : undefined
}

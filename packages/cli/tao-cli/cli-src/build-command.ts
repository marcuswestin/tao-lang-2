import Runtime, { HostDependencies, RuntimeToolchainPaths } from '@expo-host'
import { CLI, Errors, FS, HCI, Platform } from '@shared'
import { buildDesktopApp } from './desktop-build'
import { discoverTaoDevProjects, type TaoDevApp } from './dev-app-discovery'
import { selectTaoDevApp } from './dev-app-selection'

export type BuildTarget = 'web' | 'desktop' | 'ios' | 'android'
export type BuildRecord = {
  appName: string
  createdAt: string
  id: string
  mode: 'artifact' | 'compile-only'
  projectRoot: string
  results: Partial<Record<BuildTarget, { artifact: string; status: 'succeeded' } | { error: string; status: 'failed' }>>
  schemaVersion: 1
  sourceDigest?: string
  targets: BuildTarget[]
  toolchainVersion: string
}

type BuildOptions = { appName?: string; compileOnly?: boolean; targets: readonly BuildTarget[]; agents?: boolean }
const targets = ['web', 'desktop', 'ios', 'android'] as const
const runtimeFiles = [
  'index.ts',
  'app.json',
  'app.config.js',
  'app-config.cjs',
  'metro.config.cjs',
  'package.json',
] as const
const excludedSourceDirectories = new Set(['.git', '.tao', '.expo', 'node_modules'])

/** Build each requested target from the same immutable source snapshot, retaining every result. */
export async function runTaoBuild(path: string, options: BuildOptions): Promise<number> {
  const selectedTargets = await chooseTargets(
    options.agents && options.targets.length === 0 ? ['desktop'] : options.targets,
  )
  if (options.agents && (options.compileOnly || selectedTargets.some(target => target !== 'desktop'))) {
    Errors.throwUserInput('--agents requires a packaged desktop build.')
  }
  const app = await chooseApp(path, options.appName)
  const buildsRoot = FS.resolvePath('.tao/builds', app.projectRoot)
  const id = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${Platform.randomUUID().slice(0, 8)}`
  const artifactRoot = FS.resolvePath(id, buildsRoot)
  const workRoot = FS.resolvePath(`.work-${id}`, buildsRoot)
  const snapshotRoot = FS.resolvePath('source', workRoot)
  const snapshotApp = FS.resolvePath(FS.relativePath(app.projectRoot, app.appPath), snapshotRoot)
  const record: BuildRecord = {
    appName: app.appName,
    createdAt: new Date().toISOString(),
    id,
    mode: options.compileOnly === true ? 'compile-only' : 'artifact',
    projectRoot: app.projectRoot,
    results: {},
    schemaVersion: 1,
    targets: [...selectedTargets],
    toolchainVersion:
      (await FS.readJson<{ version: string }>(FS.resolvePath('package.json', RuntimeToolchainPaths.packageRoot)))
        .version,
  }
  await ensureBuildsIgnored(app.projectRoot)
  const progress = new BuildProgress(selectedTargets, id)
  try {
    progress.start()
    record.sourceDigest = await snapshotProject(app.projectRoot, snapshotRoot)
    await FS.mkdir(artifactRoot)
    await FS.writeJson(FS.resolvePath('build.json', artifactRoot), record)
    progress.snapshotComplete()
    record.results = await executeBuildTargets(selectedTargets, async target => {
      if (options.compileOnly === true) {
        const compileRoot = FS.resolvePath(`compiled/${target}`, artifactRoot)
        const generated = await Runtime.generateApp(snapshotApp, {
          appName: app.appName,
          runtimePackageRoot: compileRoot,
        })
        return FS.dirname(generated.outputPath)
      }
      if (target === 'ios' || target === 'android') {
        Errors.throwUserInput(`Local ${target} builds are not yet implemented.`)
      }
      const site = FS.resolvePath('site', target === 'web' ? FS.resolvePath('web', artifactRoot) : workRoot)
      await exportWeb(snapshotApp, app.appName, workRoot, site, target)
      return target === 'web'
        ? await finishWebArtifact(site)
        : await buildDesktopApp({
          appName: app.appName,
          outputRoot: FS.resolvePath('desktop', artifactRoot),
          siteRoot: site,
          workRoot,
          agents: options.agents ? { buildId: id } : undefined,
        })
    }, (target, status) => progress.set(target, status))
    for (const target of selectedTargets) {
      if (record.results[target]?.status === 'failed') {
        const partial = options.compileOnly === true ? `compiled/${target}` : target
        await FS.remove(FS.resolvePath(partial, artifactRoot))
      }
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
  if (!HCI.isInteractive()) {
    Errors.throwUserInput(
      'Choose build targets with --web, --desktop, --ios, and/or --android in a non-interactive terminal.',
    )
  }
  HCI.writeLine('Build targets: 1. web  2. desktop  3. iOS (not yet implemented)  4. Android (not yet implemented)')
  const answer = await HCI.askText({
    message: 'Select target numbers (comma-separated)',
    validate: value =>
      parseTargetSelection(value) === undefined ? 'Choose one or more numbers from 1 to 4.' : undefined,
  })
  return parseTargetSelection(answer)!
}

function parseTargetSelection(value: string): BuildTarget[] | undefined {
  const parts = value.split(',').map(part => part.trim())
  if (parts.some(part => !/^[1-4]$/.test(part))) {
    return undefined
  }
  return targets.filter((_, index) => parts.includes(String(index + 1)))
}

async function chooseApp(path: string, appName?: string): Promise<TaoDevApp> {
  const projects = await discoverTaoDevProjects(path)
  const apps = projects.flatMap(project => project.apps)
  if (apps.length === 0) {
    Errors.throwUserInput(`No runnable Tao apps found under ${FS.displayPath(FS.resolvePath(path))}.`)
  }
  if (appName !== undefined) {
    const matches = apps.filter(app => app.appName === appName)
    if (matches.length !== 1) {
      Errors.throwUserInput(`--app '${appName}' must identify exactly one runnable app (${matches.length} found).`)
    }
    return matches[0]!
  }
  if (apps.length === 1) {
    return apps[0]!
  }
  if (!HCI.isInteractive()) {
    Errors.throwUserInput('Multiple Tao apps found; choose one with --app in a non-interactive terminal.')
  }
  const selected = await selectTaoDevApp(projects)
  if (selected.kind !== 'selected') {
    Errors.throwUserInput('Build app selection was cancelled.')
  }
  return selected.app
}

async function ensureBuildsIgnored(projectRoot: string): Promise<void> {
  const ignorePath = FS.resolvePath('.tao/.gitignore', projectRoot)
  const existing = await FS.exists(ignorePath) ? await FS.readText(ignorePath) : ''
  if (!existing.split(/\r?\n/).includes('builds/')) {
    await FS.writeText(ignorePath, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}builds/\n`)
  }
}

async function snapshotProject(projectRoot: string, snapshotRoot: string): Promise<string> {
  const realRoot = await FS.realPath(projectRoot)
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
  return Platform.sha256Hex(digests.join('\n'))
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

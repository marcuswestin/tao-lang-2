import { RuntimeToolchainPaths } from '@expo-host'
import { CLI, type Diagnostic, FS, Platform, ProjectLocal, TaoResources } from '@shared'
import { TaoAppModules } from './app-modules'

/** checkBridgeModules asks TypeScript to check generated Tao contracts and their imported sidecars. */
export async function checkBridgeModules(workspaceRoot: string, modules: readonly string[]): Promise<Diagnostic[]> {
  if (modules.length === 0) {
    return []
  }
  await TaoAppModules.ensureProject(workspaceRoot)
  const projectConfig = FS.resolvePath('tsconfig.json', workspaceRoot)
  const checkoutRoot = FS.resolvePath('../../../..', import.meta.dir)
  const resourceRoot = TaoResources.declaredRoot()
  const hostModules = resourceRoot === undefined
    ? FS.resolvePath('node_modules', checkoutRoot)
    : FS.resolvePath(`../${TaoResources.HOST_DEPENDENCIES_DIRECTORY}/node_modules`, resourceRoot)
  const runtimeRoot = TaoAppModules.runtimeRoot()
  const dependencyRoots = [
    hostModules,
    ...(resourceRoot === undefined ? [FS.resolvePath('packages/apps/expo-host/node_modules', checkoutRoot)] : []),
    FS.resolvePath('node_modules', runtimeRoot),
  ]
  const typeRoots = dependencyRoots.map(root => FS.resolvePath('@types', root))
  const ambientTypes = (await Promise.all(
    ['bun', 'node', 'react'].map(async name =>
      typeRoots.some(root => FS.existsSync(FS.resolvePath(name, root))) ? name : undefined
    ),
  )).filter((name): name is string => name !== undefined)
  const repositoryConfig = FS.resolvePath('packages/tsconfig.base.json', checkoutRoot)
  const inheritedConfig = await FS.isFile(projectConfig)
    ? projectConfig
    : FS.pathIsWithin(workspaceRoot, checkoutRoot) && await FS.isFile(repositoryConfig)
    ? repositoryConfig
    : undefined
  // TypeScript resolves `extends` (including package configs) and the declaring file's relative
  // type roots. Read those effective options before adding the host's installed ambient types.
  const typescript = await import(
    FS.resolvePath('typescript/lib/typescript.js', hostModules)
  ) as typeof import('typescript')
  const inheritedOptions = inheritedConfig === undefined
    ? undefined
    : typescript.getParsedCommandLineOfConfigFile(inheritedConfig, {}, {
      ...typescript.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    })?.options
  const configPath = ProjectLocal.cacheResolve('bridge-check/tsconfig.json', workspaceRoot)
  const projectTypeRoots = inheritedOptions?.typeRoots ?? visibleTypeRoots(FS.dirname(configPath))
  const projectTypes = inheritedOptions?.types ?? typescript.getAutomaticTypeDirectiveNames({
    ...inheritedOptions,
    typeRoots: projectTypeRoots,
  }, typescript.sys)
  const bridgeTypeRoots = [
    ...new Set([
      ...projectTypeRoots,
      ...typeRoots,
    ]),
  ]
  const bridgeTypes = [...new Set([...projectTypes, ...ambientTypes])]
  const config = {
    ...(inheritedConfig === undefined ? {} : { extends: inheritedConfig }),
    compilerOptions: {
      allowImportingTsExtensions: true,
      composite: false,
      declaration: false,
      jsx: 'react-jsx',
      lib: ['DOM', 'DOM.Iterable', 'ES2023'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      noEmit: true,
      noPropertyAccessFromIndexSignature: false,
      ...(inheritedConfig === undefined
        ? { paths: { '@tao/runtime': [FS.resolvePath('TaoRuntime-src/TR.ts', runtimeRoot)] } }
        : {}),
      skipLibCheck: true,
      strict: true,
      target: 'ES2022',
      typeRoots: bridgeTypeRoots,
      types: bridgeTypes,
      ...(inheritedConfig === repositoryConfig ? { rootDir: checkoutRoot } : {}),
    },
    files: modules,
    include: [],
  }
  await ProjectLocal.prepare(workspaceRoot)
  await FS.writeJson(configPath, config)
  const tsc = resourceRoot === undefined
    ? FS.resolvePath('../../../../node_modules/typescript/bin/tsc', import.meta.dir)
    : FS.resolvePath(`../${TaoResources.HOST_DEPENDENCIES_DIRECTORY}/node_modules/typescript/bin/tsc`, resourceRoot)
  const runTsc = () =>
    CLI.run(Platform.runtimeProcess.execPath, {
      args: [tsc, '--project', configPath, '--pretty', 'false'],
      ...(resourceRoot === undefined ? {} : {
        env: {
          ...RuntimeToolchainPaths.nodeLauncherEnvironment(RuntimeToolchainPaths.hostInstallRoot),
          BUN_BE_BUN: '1',
        },
      }),
      cwd: workspaceRoot,
    })
  let result = await runTsc()
  if (
    result.exitCode !== 0 && await linkMissingHostDependencies(
      workspaceRoot,
      `${result.stdout}\n${result.stderr}`,
      dependencyRoots,
    )
  ) {
    result = await runTsc()
  }
  if (result.exitCode === 0) {
    return []
  }
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const diagnostics: Diagnostic[] = []
  for (const line of output.split('\n')) {
    const match = /^(.*)\((\d+),(\d+)\): error TS\d+: (.*)$/.exec(line)
    if (match === null) {
      continue
    }
    const sourcePath = FS.resolvePath(match[1]!, workspaceRoot)
    const owner = modules.find(module => module === sourcePath)
    diagnostics.push({
      filePath: owner?.endsWith('.tao.ts') ? owner.slice(0, -3) : sourcePath,
      message: `TypeScript bridge: ${match[4]}`,
      severity: 'error',
      source: 'compiler',
      ...(owner === undefined
        ? {
          range: {
            start: { line: Number(match[2]) - 1, character: Number(match[3]) - 1 },
            end: { line: Number(match[2]) - 1, character: Number(match[3]) - 1 },
          },
        }
        : {}),
    })
  }
  if (diagnostics.length > 0) {
    return diagnostics
  }
  return [{
    filePath: modules[0]!.slice(0, -3),
    message: `TypeScript bridge check failed: ${output || `exit code ${result.exitCode}`}`,
    severity: 'error',
    source: 'compiler',
  }]
}

/** TypeScript's default ambient lookup visits node_modules/@types in the config's directory and every ancestor. */
function visibleTypeRoots(configDirectory: string): string[] {
  const roots: string[] = []
  let directory = configDirectory
  while (true) {
    roots.push(FS.resolvePath('node_modules/@types', directory))
    const parent = FS.dirname(directory)
    if (parent === directory) {
      return roots
    }
    directory = parent
  }
}

/** Only missing packages already installed with the host are linked; project dependencies win. */
async function linkMissingHostDependencies(
  workspaceRoot: string,
  output: string,
  dependencyRoots: readonly string[],
): Promise<boolean> {
  let linked = false
  const missing = [...output.matchAll(/error TS2307: Cannot find module '([^']+)'/g)]
  for (const [, specifier] of missing) {
    const packageName = hostPackageName(specifier ?? '')
    if (packageName === undefined) {
      continue
    }
    const linkPath = FS.resolvePath(`node_modules/${packageName}`, workspaceRoot)
    if (await FS.exists(linkPath) || await FS.isSymbolicLink(linkPath)) {
      continue
    }
    const target = dependencyRoots.map(root => FS.resolvePath(packageName, root))
      .find(path => FS.existsSync(path))
    if (target === undefined || !await FS.isDirectory(target)) {
      continue
    }
    try {
      await FS.symlink(target, linkPath)
      linked = true
    } catch (error) {
      if (!await FS.exists(linkPath) && !await FS.isSymbolicLink(linkPath)) {
        throw error
      }
    }
  }
  return linked
}

function hostPackageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) {
    return undefined
  }
  const segments = specifier.split('/')
  const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  return name !== undefined && /^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(name) ? name : undefined
}

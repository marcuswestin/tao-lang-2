import { CLI, type Diagnostic, FS, Platform, TaoResources } from '@shared'
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
  const repositoryConfig = FS.resolvePath('packages/tsconfig.base.json', checkoutRoot)
  const inheritedConfig = await FS.isFile(projectConfig)
    ? projectConfig
    : FS.pathIsWithin(workspaceRoot, checkoutRoot) && await FS.isFile(repositoryConfig)
    ? repositoryConfig
    : undefined
  const configPath = FS.resolvePath('.tao/bridge-check.tsconfig.json', workspaceRoot)
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
      typeRoots: [FS.resolvePath('@types', hostModules), FS.resolvePath('node_modules/@types', runtimeRoot)],
      types: ['bun', 'node', 'react'],
      ...(inheritedConfig === repositoryConfig ? { rootDir: checkoutRoot } : {}),
    },
    files: modules,
    include: [],
  }
  await FS.writeJson(configPath, config)
  const tsc = resourceRoot === undefined
    ? FS.resolvePath('../../../../node_modules/typescript/bin/tsc', import.meta.dir)
    : FS.resolvePath(`../${TaoResources.HOST_DEPENDENCIES_DIRECTORY}/node_modules/typescript/bin/tsc`, resourceRoot)
  const result = await CLI.run(Platform.runtimeProcess.execPath, {
    args: [...(resourceRoot === undefined ? [] : ['--bun']), tsc, '--project', configPath, '--pretty', 'false'],
    cwd: workspaceRoot,
  })
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

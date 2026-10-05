import type { BridgeModule } from '@compiler/bridge-metadata'
import { Assert, FS } from '@shared'
import type { inspectMaintainedNativeBindings } from 'tao-native-bindings'
import type * as TS from 'typescript'
import { hostModulePaths, nativeBindingModuleRoots, resolveRuntimeRoot } from './ProjectHostModules'
import type { ProjectToolingOptions, ProjectToolingSourceMapping } from './ProjectTooling'
import { createProjectTypeScriptProgram, type ProjectTypeScriptDeclarationViews } from './ProjectTypeScriptProgram'

type Inspection = Awaited<ReturnType<typeof inspectMaintainedNativeBindings>>

/** Check real native bodies and Tao signatures together, then expose declarations to the host program. */
export async function checkProjectNativeTypeScript(
  root: string,
  ordinary: TS.Program,
  contractPaths: readonly string[],
  mappings: readonly ProjectToolingSourceMapping[],
  options: ProjectToolingOptions,
  inspected: Inspection,
  nativeContracts: readonly BridgeModule[] = [],
): Promise<
  {
    declarations: ProjectTypeScriptDeclarationViews
    diagnostics: readonly TS.Diagnostic[]
    paths?: TS.CompilerOptions['paths']
  }
> {
  const nativeOutputs = new Set(inspected.outputPaths.map(path => FS.resolvePath(path)))
  const nativeSources = new Set([
    ...nativeOutputs,
    ...mappings.filter(mapping => nativeOutputs.has(mapping.sourcePath)).map(mapping => mapping.generatedPath),
  ])
  const implementationPaths = new Set(
    ordinary.getSourceFiles().filter(file =>
      !file.isDeclarationFile
      && nativeSources.has(FS.resolvePath(file.fileName))
      && file.fileName.includes('/.tao-ts/native-bindings/')
    ).map(file => FS.resolvePath(file.fileName)),
  )
  for (const module of nativeContracts) {
    for (const implementation of module.implementationPaths) {
      Assert(
        nativeOutputs.has(implementation.sourcePath),
        'Expected: reached native implementations belong to the fresh inventory.',
      )
      implementationPaths.add(implementation.sourcePath)
    }
  }
  if (implementationPaths.size === 0 && nativeContracts.length === 0) {
    return { declarations: new Map(), diagnostics: [] }
  }
  const contracts = [
    ...new Set([
      ...nativeContracts.map(module => module.path),
      ...contractPaths.filter(path =>
        mappings.some(mapping =>
          mapping.generatedPath === path
          && mapping.sourcePath.endsWith('.tao') && nativeOutputs.has(mapping.sourcePath)
        )
      ),
    ]),
  ]
  const sourceViews = new Map(nativeContracts.map(module => [module.path, module.code]))
  const nativeRoots = nativeContracts.map(module => module.path.slice(0, module.path.indexOf('/.tao-ts/')))
  Assert(
    contracts.length > 0,
    'Expected: reached maintained native implementations have generated Tao signature contracts.',
  )
  const enginePath = inspected.inputPaths.find(path => path.endsWith('/typescript/lib/typescript.js'))
  Assert.defined(enginePath, 'Expected: a fresh native binding inspection identifies its executable TypeScript engine.')
  const ts = require(enginePath) as typeof TS
  Assert(ts.ScriptTarget?.ESNext !== undefined, 'Expected: the pinned native TypeScript engine supports ESNext.')
  const moduleRoots = await nativeBindingModuleRoots(options)
  const nativePaths = await hostModulePaths(FS.resolvePath('__native_contract_program__', root), {
    ...options,
    hostModulesRoot: moduleRoots[0],
    hostModuleRoots: moduleRoots.slice(1),
  })
  const ordinaryOptions = ordinary.getCompilerOptions()
  const runtimePath = ordinaryOptions.paths?.['@tao/runtime']
  const runtimeRoot = resolveRuntimeRoot(root, options)
  const runtimePaths = { '@runtime/*': [FS.resolvePath('TaoRuntime-src/*', runtimeRoot)] }
  const compilerOptions: TS.CompilerOptions = {
    ...ordinaryOptions,
    configFilePath: undefined,
    rootDir: undefined,
    rootDirs: [
      ...new Set([
        ...(ordinaryOptions.rootDirs ?? []),
        ...nativeRoots.flatMap(root => [root, FS.resolvePath('.tao-ts', root)]),
      ]),
    ],
    target: ts.ScriptTarget.ESNext,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
    typeRoots: [],
    customConditions: ['react-native'],
    paths: {
      ...ordinaryOptions.paths,
      ...nativePaths,
      ...runtimePaths,
      ...(runtimePath === undefined ? {} : { '@tao/runtime': runtimePath }),
    },
    noEmit: false,
    noEmitOnError: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    incremental: false,
    composite: false,
    outDir: FS.resolvePath('.tao/cache/typescript/native-declarations', root),
    declarationDir: undefined,
  }
  const ambientPath = FS.resolvePath('.tao/cache/typescript/native-loader.d.ts', root)
  // Metro's dynamic native loader has no Node environment; only its require primitive is declared.
  const ambient = new Map([[ambientPath, 'declare function require(specifier: string): any;\n']])
  const roots = [...implementationPaths, ...contracts, ambientPath]
  const seed = createProjectTypeScriptProgram(roots, compilerOptions, ambient, ts, sourceViews)
  for (const file of seed.getSourceFiles()) {
    const path = FS.resolvePath(file.fileName)
    if (!file.isDeclarationFile && nativeSources.has(path) && path.includes('/.tao-ts/native-bindings/')) {
      implementationPaths.add(path)
    }
  }
  const sourcesByPath = new Map(seed.getSourceFiles().map(file => [FS.resolvePath(file.fileName), file]))
  const runtimeSources = new Set(
    seed.getSourceFiles().filter(file =>
      !file.isDeclarationFile
      && FS.pathIsWithin(FS.resolvePath(file.fileName), runtimeRoot)
      && !implementationPaths.has(FS.resolvePath(file.fileName))
      && !contracts.includes(FS.resolvePath(file.fileName))
    ).map(file => FS.resolvePath(file.fileName)),
  )
  const queue = [...runtimeSources]
  while (queue.length > 0) {
    const path = queue.shift()!
    const source = sourcesByPath.get(path)!
    for (const imported of ts.preProcessFile(source.text).importedFiles) {
      const resolved = ts.resolveModuleName(imported.fileName, path, compilerOptions, ts.sys).resolvedModule
      if (resolved === undefined) {
        continue
      }
      const target = FS.resolvePath(resolved.resolvedFileName)
      const targetSource = sourcesByPath.get(target)
      if (
        targetSource !== undefined && !targetSource.isDeclarationFile
        && !implementationPaths.has(target) && !contracts.includes(target) && !runtimeSources.has(target)
      ) {
        runtimeSources.add(target)
        queue.push(target)
      }
    }
  }
  const runtimeDeclarations = new Map<string, string>(ambient)
  const nativeDeclarations = new Map<string, string>()
  const emitted = seed.emit(undefined, (_path, text, _bom, _error, sources) => {
    for (const source of sources ?? []) {
      const path = FS.resolvePath(source.fileName)
      if (runtimeSources.has(path)) {
        runtimeDeclarations.set(path, text)
      }
      if (implementationPaths.has(path)) {
        nativeDeclarations.set(path, text)
      }
    }
  })
  for (const path of implementationPaths) {
    Assert(
      nativeDeclarations.has(path) || emitted.diagnostics.length > 0,
      `Expected: native declaration emission retains ${path}.`,
    )
  }
  const isolated = createProjectTypeScriptProgram(
    roots,
    {
      ...compilerOptions,
      noEmit: true,
      declaration: false,
      emitDeclarationOnly: false,
    },
    runtimeDeclarations,
    ts,
    sourceViews,
  )
  return {
    declarations: new Map(
      [...runtimeDeclarations].filter(([path]) => path !== ambientPath).concat([...nativeDeclarations]),
    ),
    diagnostics: [...emitted.diagnostics, ...ts.getPreEmitDiagnostics(isolated)],
    paths: runtimePaths,
  }
}

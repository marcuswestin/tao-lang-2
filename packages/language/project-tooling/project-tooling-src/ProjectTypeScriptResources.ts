import { FS } from '@shared'
import * as ts from 'typescript'
import { hostModulePaths, nativeBindingModuleRoots } from './ProjectHostModules'
import type { ProjectToolingOptions } from './ProjectTooling'

export type ProjectTypeScriptResource = {
  sourcePath: string
  packageRoot: string
  packageName: string
  relativePath: string
}

export type ProjectTypeScriptResourceResult = {
  files: readonly ProjectTypeScriptResource[]
  diagnostics: readonly string[]
}

type ResourceInputs = {
  runtimeRoot: string
  moduleRoots: readonly string[]
  typescriptLibRoot: string
  nativeBindings?: ProjectToolingOptions['nativeBindings']
}

type RuntimeManifest = {
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/** Collect the installed files reached by the native TypeScript SDK program. */
export async function collectProjectTypeScriptResources(
  inputs: ResourceInputs,
): Promise<ProjectTypeScriptResourceResult> {
  const runtimeRoot = FS.resolvePath(inputs.runtimeRoot)
  const runtimeEntry = FS.resolvePath('TaoRuntime-src/TR.ts', runtimeRoot)
  const moduleRoots = [
    ...inputs.moduleRoots,
    ...await nativeBindingModuleRoots({ nativeBindings: inputs.nativeBindings }),
  ]
  const typeRoots = moduleRoots.map(root => FS.resolvePath('@types', root))
    .filter(root => FS.existsSync(root))
  const available = await installedNames(moduleRoots)
  const allowedInstallRoots = await installRoots(moduleRoots, available)
  const hostPaths = await hostModulePaths(FS.resolvePath('__editor_resource_project__', runtimeRoot), {
    hostModuleRoots: inputs.moduleRoots,
    nativeBindings: inputs.nativeBindings,
  })
  const paths = Object.fromEntries(
    Object.entries(hostPaths).filter(([name]) =>
      [...available].some(installed => name === installed || name.startsWith(`${installed}/`))
    ),
  )
  const options: ts.CompilerOptions = {
    allowImportingTsExtensions: true,
    allowJs: true,
    checkJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.es2023.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    paths,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    typeRoots,
    types: ['node', 'react'],
  }
  const manifest = await FS.readJson<RuntimeManifest>(FS.resolvePath('package.json', runtimeRoot))
  const roots = [runtimeEntry]
  const diagnostics: string[] = []
  for (const name of Object.keys(manifest.peerDependencies ?? {}).toSorted()) {
    const resolved = ts.resolveModuleName(name, runtimeEntry, options, ts.sys).resolvedModule
    if (resolved !== undefined) {
      roots.push(resolved.resolvedFileName)
    } else if (manifest.peerDependenciesMeta?.[name]?.optional !== true) {
      diagnostics.push(`The editor TypeScript SDK cannot resolve installed runtime peer ${name}.`)
    }
  }
  const program = ts.createProgram(roots, options)
  const resolutionCodes = new Set([2307, 2688, 7016])
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (resolutionCodes.has(diagnostic.code)) {
      diagnostics.push(`TypeScript: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
    }
  }
  const files: ProjectTypeScriptResource[] = []
  const seen = new Set<string>()
  const realRuntimeRoot = await FS.realPath(runtimeRoot)
  const typeScriptLibRoot = await FS.realPath(inputs.typescriptLibRoot)
  const compilerLibRoot = FS.dirname(await FS.realPath(ts.getDefaultLibFilePath(options)))
  for (const file of program.getSourceFiles()) {
    const sourcePath = FS.resolvePath(ts.sys.realpath?.(file.fileName) ?? file.fileName)
    if (
      seen.has(sourcePath) || FS.pathIsWithin(sourcePath, realRuntimeRoot)
      || FS.pathIsWithin(sourcePath, typeScriptLibRoot)
      || FS.pathIsWithin(sourcePath, compilerLibRoot)
    ) {
      continue
    }
    seen.add(sourcePath)
    const installed = installedPackage(sourcePath)
    if (installed === undefined) {
      diagnostics.push(`The editor TypeScript SDK resolved an unowned file ${sourcePath}.`)
      continue
    }
    if (!allowedInstallRoots.some(root => FS.pathIsWithin(installed.packageRoot, root))) {
      diagnostics.push(
        `The editor TypeScript SDK resolved installed package ${installed.packageName} outside the supplied install roots: ${installed.packageRoot}.`,
      )
      continue
    }
    files.push({ sourcePath, ...installed })
  }
  return {
    files: files.toSorted((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
    diagnostics: [...new Set(diagnostics)],
  }
}

async function installRoots(moduleRoots: readonly string[], names: ReadonlySet<string>): Promise<string[]> {
  const roots = new Set<string>()
  for (const moduleRoot of moduleRoots) {
    if (!await FS.isDirectory(moduleRoot)) {
      continue
    }
    roots.add(await FS.realPath(moduleRoot))
    for (const name of names) {
      const installed = FS.resolvePath(name, moduleRoot)
      if (await FS.isDirectory(installed)) {
        roots.add(await FS.realPath(installed))
      }
    }
  }
  return [...roots]
}

async function installedNames(moduleRoots: readonly string[]): Promise<Set<string>> {
  const names = new Set<string>()
  for (const root of moduleRoots) {
    if (!await FS.isDirectory(root)) {
      continue
    }
    for (const entry of await FS.listDir(root)) {
      if (entry.startsWith('@') && await FS.isDirectory(FS.resolvePath(entry, root))) {
        for (const name of await FS.listDir(FS.resolvePath(entry, root))) {
          names.add(`${entry}/${name}`)
        }
      } else if (!entry.startsWith('.')) {
        names.add(entry)
      }
    }
  }
  return names
}

function installedPackage(sourcePath: string): Omit<ProjectTypeScriptResource, 'sourcePath'> | undefined {
  let directory = FS.dirname(sourcePath)
  while (true) {
    const parent = FS.dirname(directory)
    const grandparent = FS.dirname(parent)
    const moduleRoot = FS.basename(parent) === 'node_modules'
      ? parent
      : FS.basename(grandparent) === 'node_modules' && FS.basename(parent).startsWith('@')
      ? grandparent
      : undefined
    if (moduleRoot !== undefined) {
      return {
        packageRoot: directory,
        packageName: FS.relativePath(moduleRoot, directory),
        relativePath: FS.relativePath(directory, sourcePath),
      }
    }
    if (parent === directory) {
      return undefined
    }
    directory = parent
  }
}

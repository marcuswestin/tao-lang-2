import { collectProjectTypeScriptResources, type ProjectToolingOptions } from '@project-tooling'
import { Errors, FS } from '@shared'

type ResourceInputs = {
  runtimeRoot: string
  moduleRoots: readonly string[]
  typescriptLibRoot: string
  outputRoot: string
  nativeBindings?: ProjectToolingOptions['nativeBindings']
}

const RESOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'])

/** Stage runtime source and the files reached by the native TypeScript SDK program. */
export async function stageProjectToolingResources(inputs: ResourceInputs): Promise<void> {
  const runtime = FS.resolvePath('runtime', inputs.outputRoot)
  await copyVisibleSource(
    FS.resolvePath('TaoRuntime-src', inputs.runtimeRoot),
    FS.resolvePath('TaoRuntime-src', runtime),
  )
  await FS.copyFile(FS.resolvePath('package.json', inputs.runtimeRoot), FS.resolvePath('package.json', runtime))

  const typeLibs = (await FS.listDir(inputs.typescriptLibRoot)).filter(name => /^lib(?:\..+)?\.d\.ts$/.test(name))
  if (typeLibs.length === 0) {
    Errors.throwHostEnvironment(`TypeScript library declarations are missing from ${inputs.typescriptLibRoot}.`)
  }
  for (const name of typeLibs.toSorted()) {
    await FS.copyFile(
      FS.resolvePath(name, inputs.typescriptLibRoot),
      FS.resolvePath(`extension/${name}`, inputs.outputRoot),
    )
  }

  const resources = await collectProjectTypeScriptResources(inputs)
  if (resources.diagnostics.length > 0) {
    Errors.throwHostEnvironment(resources.diagnostics.join('\n'))
  }
  const modules = FS.resolvePath('host/node_modules', inputs.outputRoot)
  const packageRoots = new Map<string, string>()
  for (const file of resources.files) {
    const prior = packageRoots.get(file.packageName)
    if (prior !== undefined && prior !== file.packageRoot) {
      Errors.throwHostEnvironment(`The editor TypeScript SDK resolves multiple installs of ${file.packageName}.`)
    }
    if (prior === undefined) {
      packageRoots.set(file.packageName, file.packageRoot)
      await FS.copyFile(
        FS.resolvePath('package.json', file.packageRoot),
        FS.resolvePath(`${file.packageName}/package.json`, modules),
      )
    }
    await FS.copyFile(file.sourcePath, FS.resolvePath(`${file.packageName}/${file.relativePath}`, modules))
  }
}

async function copyVisibleSource(source: string, destination: string): Promise<void> {
  const realRoot = await FS.realPath(source)
  const paths: string[] = []
  for await (
    const path of FS.walk(realRoot, {
      includeHidden: true,
      followSymlinks: true,
      excludeDirectory: name => name === 'node_modules' || name === '.git',
    })
  ) {
    const name = FS.basename(path)
    if (RESOURCE_EXTENSIONS.has(FS.extname(path)) || /^(?:LICEN[CS]E|NOTICE|COPYING)/iu.test(name)) {
      paths.push(path)
    }
  }
  for (const path of paths.toSorted()) {
    const realPath = await FS.realPath(path)
    if (!FS.pathIsWithin(realPath, realRoot)) {
      Errors.throwHostEnvironment(`Installed resource ${path} resolves outside its package.`)
    }
    await FS.copyFile(realPath, FS.resolvePath(FS.relativePath(realRoot, path), destination))
  }
}

import { Errors, FS, HCI } from '@shared'
import { chooseTaoApp } from './dev-app-selection'
import { type HostedProvider, readHostedProviderInputs } from './hosted-provider-inputs'

type GenerateOptions = Readonly<{ appName?: string; force?: boolean; output: string }>

/** Generate backend source for one app, leaving existing files untouched unless forced. */
export async function runHostedProviderGenerate(
  provider: HostedProvider,
  path: string,
  options: GenerateOptions,
): Promise<void> {
  const app = await chooseTaoApp(path, options.appName, `${provider} generate`)
  const { definition, policy } = await readHostedProviderInputs(app.appPath, app.appName, provider)
  const files: Readonly<Record<string, string>> = provider === 'jazz'
    ? (await import('tao-jazz/deployment')).jazzDeploymentFiles(definition, policy)
    : provider === 'convex'
    ? (await import('tao-convex/generate')).generateConvexBackend(definition, policy)
    : (await import('tao-pylon/generate')).generatePylonBackend(definition, policy, { name: app.appName }).files
  const output = FS.resolvePath(options.output)
  if (await FS.isSymbolicLink(output)) {
    Errors.throwUserInput(`Output ${FS.displayPath(output)} is a symbolic link.`)
  }
  if (await FS.exists(output) && !await FS.isDirectory(output)) {
    Errors.throwUserInput(`Output ${FS.displayPath(output)} is not a directory.`)
  }
  const entries = Object.entries(files)
  if (entries.length === 0) {
    return Errors.throwUnexpected(`${provider} generation returned no backend files`)
  }
  const targets = entries.map(([name, code]) => {
    if (
      name.split('/').some(part => part === '' || part === '.' || part === '..')
      || name.includes('\\') || typeof code !== 'string'
    ) {
      Errors.throwUnexpected(`${provider} generation returned an invalid backend file`)
    }
    const path = FS.resolvePath(name, output)
    if (!FS.pathIsWithin(path, output) || path === output) {
      Errors.throwUnexpected(`${provider} generation returned an invalid backend file`)
    }
    return { code, path }
  })
  const conflicts: string[] = []
  for (const target of targets) {
    let parent = FS.dirname(target.path)
    while (parent !== output) {
      if (await FS.isSymbolicLink(parent) || await FS.exists(parent) && !await FS.isDirectory(parent)) {
        Errors.throwUserInput(`Output ${FS.displayPath(parent)} is not a regular directory.`)
      }
      parent = FS.dirname(parent)
    }
    if (await FS.isSymbolicLink(target.path) || await FS.isDirectory(target.path)) {
      Errors.throwUserInput(`Output ${FS.displayPath(target.path)} is not a regular file.`)
    }
    if (await FS.exists(target.path) && await FS.readText(target.path) !== target.code && options.force !== true) {
      conflicts.push(FS.displayPath(target.path))
    }
  }
  if (conflicts.length > 0) {
    Errors.throwUserInput(
      `Generated files already exist with different content: ${conflicts.join(', ')}. Pass --force to replace them.`,
    )
  }
  await FS.mkdir(output)
  for (const target of targets) {
    if (!await FS.exists(target.path) || await FS.readText(target.path) !== target.code) {
      await FS.writeText(target.path, target.code)
    }
  }
  HCI.writeSuccess(`Generated ${provider} backend files in ${FS.displayPath(output)}\n`)
}

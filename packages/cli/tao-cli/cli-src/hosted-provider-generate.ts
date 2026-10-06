import { Errors, FS, HCI, readFirebaseConnections } from '@shared'
import { chooseTaoApp } from './dev-app-selection'
import { printFirebaseConsoleSetup } from './firebase-console-guidance'
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
    ? (await import('tao-jazz/deployment')).jazzDeploymentFiles(definition, policy!)
    : provider === 'convex'
    ? (await import('tao-convex/generate')).generateConvexBackend(definition, policy!)
    : provider === 'pylon'
    ? (await import('tao-pylon/generate')).generatePylonBackend(definition, policy!, { name: app.appName }).files
    : {
      ...(await import('tao-firebase/generate')).generateFirebaseBackend(definition, policy).files,
      'firebase.json': `${
        JSON.stringify(
          {
            firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
          },
          null,
          2,
        )
      }\n`,
    }
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
  const connection = provider === 'firebase' ? await readFirebaseConnections(app.projectRoot) : undefined
  await FS.mkdir(output)
  for (const target of targets) {
    if (!await FS.exists(target.path) || await FS.readText(target.path) !== target.code) {
      await FS.writeText(target.path, target.code)
    }
  }
  HCI.writeSuccess(`Generated ${provider} backend files in ${FS.displayPath(output)}\n`)
  if (provider === 'firebase') {
    HCI.writeLine(
      'Review these rules and combine them with any existing project-wide Firestore rules before deployment.',
    )
    HCI.writeLine('Install the Firebase CLI if needed: https://firebase.google.com/docs/cli#install_the_firebase_cli')
    HCI.writeLine(
      'Run firebase login and complete Google sign-in locally with an account allowed to deploy to this project.',
    )
    HCI.writeLine('These are local deployment files; no separate backend server is needed.')
    if (connection !== undefined) {
      printFirebaseConsoleSetup(connection.projectId)
    }
    if (connection === undefined) {
      HCI.writeLine(
        `Connect this Tao project first: tao connect firebase '${app.projectRoot.replaceAll("'", "'\\''")}'`,
      )
    } else {
      HCI.writeLine('The generated index list is empty; deploy rules only to preserve existing indexes.')
      HCI.writeLine(`From ${FS.displayPath(output)}, deploy with the Firebase CLI:`)
      HCI.writeLine(
        `firebase deploy --only firestore:rules --project '${connection.projectId.replaceAll("'", "'\\''")}'`,
      )
    }
  }
}

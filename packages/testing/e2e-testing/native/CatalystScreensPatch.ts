import { Errors, FS, Platform, Repo } from '@shared'
import { recordedCommand } from '../CommandReceipts'

const packageName = 'react-native-screens'
const reviewedFiles = [
  {
    path: 'ios/RNSScreenStack.mm',
    originalDigest: '58d30df9e72b5fea6eb264b6f166fd98e2704d0afd6ec51469f34b1cd2dc97e4',
    replacementDigest: 'd5225abec756371b3b17085c84c0d5378154bc9bdf69fdf42c672eb5c66f1114',
  },
  {
    path: 'ios/tabs/host/RNSTabsHostComponentView.mm',
    originalDigest: '63a2faed5da53adbc12b1e9e99833cf28aaccaecb33fbefe22ab769bda8ad613',
    replacementDigest: '713d139a069ad5f388834e750d18831434d28e3eb0a578014184280d82866b19',
  },
] as const

/** Copies the pinned package before applying the experimental native tab-pane adaptation. */
export async function applyCatalystScreensPatch(
  sourceModules: string,
  destinationModules: string,
  artifacts: string,
): Promise<void> {
  const source = await FS.realPath(FS.resolvePath(packageName, sourceModules))
  const destinationRoot = await FS.realPath(destinationModules)
  const artifactRoot = await FS.realPath(artifacts)
  const destination = FS.resolvePath(packageName, destinationRoot)
  requireCondition(FS.pathIsWithin(destination, artifactRoot), 'Screens copy must stay inside the trial artifacts.')
  requireCondition(
    !FS.pathIsWithin(destination, source) && !FS.pathIsWithin(source, destination),
    'Screens copy must not alias or contain the source package.',
  )
  requireCondition(
    !await FS.exists(destination) && !await FS.isSymbolicLink(destination),
    'Screens copy destination must be absent; skip its dependency symlink during isolation.',
  )
  const manifest = await FS.readJson<{ version: string; dependencies: Record<string, string> }>(
    FS.resolvePath('package.json', source),
  )
  requireCondition(manifest.version === '4.26.2', 'Catalyst screens patch requires installed screens 4.26.2.')
  for (const file of reviewedFiles) {
    const sourceTarget = await FS.realPath(FS.resolvePath(file.path, source))
    requireCondition(FS.pathIsWithin(sourceTarget, source), 'Reviewed screens source escapes its package.')
    requireCondition(
      await digest(sourceTarget) === file.originalDigest,
      `Installed screens source differs from the reviewed patch: ${file.path}`,
    )
  }
  await FS.copyDirectory(source, destination)
  const copiedRoot = await FS.realPath(destination)
  requireCondition(copiedRoot === destination, 'Screens copy must be a real directory in the trial.')
  // Bun stores a package's own dependencies beside it. Preserve those resolved links when
  // copying the package away from that store; peers still resolve through the trial host.
  const copiedModules = FS.resolvePath('node_modules', copiedRoot)
  await FS.mkdir(copiedModules)
  const dependencyLinks: Record<string, string> = {}
  for (const name of Object.keys(manifest.dependencies)) {
    const installed = await FS.realPath(FS.resolvePath(`../${name}`, source))
    const link = FS.resolvePath(name, copiedModules)
    requireCondition(FS.pathIsWithin(link, copiedModules), 'Screens dependency link escapes the copied package.')
    await FS.mkdir(FS.dirname(link))
    await FS.symlink(installed, link)
    dependencyLinks[name] = installed
  }
  for (const file of reviewedFiles) {
    const target = await FS.realPath(FS.resolvePath(file.path, copiedRoot))
    requireCondition(
      FS.pathIsWithin(target, copiedRoot) && !FS.pathIsWithin(target, source),
      `Screens patch target escapes the copy or aliases its source: ${file.path}`,
    )
    requireCondition(
      await digest(target) === file.originalDigest,
      `Copied screens source differs from the reviewed patch: ${file.path}`,
    )
  }
  const resource = Repo.resolvePath('packages/testing/e2e-testing/native/catalyst/screens-tab-pane-layout.patch')
  const retainedPatch = FS.resolvePath('screens-tab-pane-layout.patch', artifactRoot)
  await FS.copyFile(resource, retainedPatch)
  const receiptFiles: { path: string; originalDigest: string; replacementDigest: string }[] = []
  try {
    await recordedCommand('screens-patch-command', 'patch', {
      args: ['-p1', '--forward', '-i', retainedPatch],
      cwd: copiedRoot,
    }, artifactRoot)
    for (const file of reviewedFiles) {
      const replacementDigest = await digest(FS.resolvePath(file.path, copiedRoot))
      receiptFiles.push({ path: file.path, originalDigest: file.originalDigest, replacementDigest })
      requireCondition(
        replacementDigest === file.replacementDigest,
        `Patched screens source differs from the reviewed replacement: ${file.path}`,
      )
    }
  } finally {
    const sourceDigests = await Promise.all(reviewedFiles.map(async file => ({
      path: file.path,
      digest: await digest(FS.resolvePath(file.path, source)),
      expected: file.originalDigest,
    })))
    const sourceUnchanged = sourceDigests.every(file => file.digest === file.expected)
    await FS.writeJson(FS.resolvePath('screens-patch.json', artifactRoot), {
      package: packageName,
      version: manifest.version,
      source,
      destination: copiedRoot,
      patch: retainedPatch,
      patchDigest: await digest(retainedPatch),
      files: receiptFiles,
      sourceDigests,
      sourceUnchanged,
      dependencyLinks,
      acceptance: 'Experimental source adaptation; physical native UI validation remains required.',
    })
    requireCondition(sourceUnchanged, 'Screens patch changed protected source package files.')
  }
}

async function digest(path: string): Promise<string> {
  return Platform.sha256Hex(await FS.readText(path))
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) {
    Errors.throwHostEnvironment(message)
  }
}

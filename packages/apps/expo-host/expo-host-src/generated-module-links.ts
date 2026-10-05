import type { DependencyEnvironment } from '@compiler'
import { managedDependencyModulesRoot, validateManagedDependencyEnvironments } from '@project-tooling'
import { Assert, FS, ProjectLocal } from '@shared'
import { RuntimeToolchainPaths } from './runtime-toolchain-paths'

type ModuleLink = { relativePath: string; target: string }
type ModuleLinkManifest = { links: ModuleLink[]; version: 1 }

const manifestSuffix = '.tao-module-links.json'

export const generatedModuleLinkFileOperations = {
  remove: FS.remove,
  symlink: FS.symlink,
  writeJson: FS.writeJson,
}

/**
 * Keep imported packages outside the synchronized source graph and its content fingerprint.
 * Set preserveUnchangedLinks only when the publisher can preserve symlink paths in generated output.
 * Full-tree publication uses the default so it can replace the generated directory safely.
 */
export async function withGeneratedModuleLinks(
  outputRoot: string,
  requesterRoot: string,
  environments: readonly DependencyEnvironment[],
  publish: () => Promise<void>,
  moduleLinkRoot = requesterRoot,
  options: { preserveUnchangedLinks?: boolean } = {},
): Promise<void> {
  const manifestPath = `${outputRoot}${manifestSuffix}`
  let boundaryPath = FS.resolvePath(requesterRoot)
  while (!FS.pathIsWithin(manifestPath, boundaryPath)) {
    boundaryPath = FS.dirname(boundaryPath)
  }
  await FS.withFileMutationLock(manifestPath, boundaryPath, async () => {
    const diagnostics = await validateManagedDependencyEnvironments(requesterRoot, environments, {
      moduleLinkRoot,
      checkSnapshotLinks: false,
    })
    Assert.input(diagnostics.length === 0, diagnostics.map(diagnostic => diagnostic.message).join('\n'))
    const desired = await plannedLinks(requesterRoot, moduleLinkRoot, environments)
    const desiredByPath = new Map(desired.map(link => [link.relativePath, link]))
    const retained = new Set<string>()
    const removed: ModuleLink[] = []
    for (const link of await readOwnedLinks(manifestPath)) {
      const path = FS.resolvePath(link.relativePath, outputRoot)
      if (!await FS.exists(path) && !await FS.isSymbolicLink(path)) {
        continue
      }
      await assertOwnedLink(outputRoot, link)
      const desiredLink = desiredByPath.get(link.relativePath)
      if (options.preserveUnchangedLinks === true && desiredLink?.target === link.target) {
        retained.add(link.relativePath)
      } else {
        removed.push(link)
      }
    }
    const installed: ModuleLink[] = []
    try {
      for (const link of removed) {
        await generatedModuleLinkFileOperations.remove(FS.resolvePath(link.relativePath, outputRoot))
      }
      await publish()
      for (const link of desired) {
        if (retained.has(link.relativePath)) {
          const retainedPath = FS.resolvePath(link.relativePath, outputRoot)
          if (await FS.exists(retainedPath) || await FS.isSymbolicLink(retainedPath)) {
            await assertOwnedLink(outputRoot, link)
            continue
          }
        }
        const linkPath = FS.resolvePath(link.relativePath, outputRoot)
        Assert.input(
          !await FS.exists(linkPath) && !await FS.isSymbolicLink(linkPath),
          `Generated module link path is occupied: ${linkPath}`,
        )
        await generatedModuleLinkFileOperations.symlink(link.target, linkPath)
        installed.push(link)
      }
      const serializedManifest = `${JSON.stringify({ version: 1, links: desired } satisfies ModuleLinkManifest, null, 2)}\n`
      const manifestUnchanged = await FS.isFile(manifestPath)
        && await FS.readText(manifestPath) === serializedManifest
      if (manifestUnchanged) {
        return
      }
      if (desired.length === 0) {
        if (await FS.exists(manifestPath) || await FS.isSymbolicLink(manifestPath)) {
          await generatedModuleLinkFileOperations.remove(manifestPath)
        }
      } else {
        await generatedModuleLinkFileOperations.writeJson(manifestPath, { version: 1, links: desired } satisfies ModuleLinkManifest)
      }
    } catch (error) {
      for (const link of installed) {
        await assertOwnedLink(outputRoot, link)
        await generatedModuleLinkFileOperations.remove(FS.resolvePath(link.relativePath, outputRoot))
      }
      for (const link of removed) {
        const linkPath = FS.resolvePath(link.relativePath, outputRoot)
        if (!await FS.exists(linkPath) && !await FS.isSymbolicLink(linkPath)) {
          await generatedModuleLinkFileOperations.symlink(link.target, linkPath)
        }
      }
      throw error
    }
  }, { lockDirectory: ProjectLocal.cacheResolve('locks', requesterRoot) })
}

async function plannedLinks(
  requesterRoot: string,
  moduleLinkRoot: string,
  environments: readonly DependencyEnvironment[],
): Promise<ModuleLink[]> {
  const links: ModuleLink[] = []
  for (const environment of environments) {
    if (environment.npm.length === 0) {
      continue
    }
    const local = environment.projectRoot === requesterRoot
    const target = local
      ? FS.resolvePath('node_modules', moduleLinkRoot)
      : managedDependencyModulesRoot(moduleLinkRoot, environment.namespace)
    for (const requirement of environment.npm) {
      const manifest = FS.resolvePath(`${requirement.alias}/package.json`, target)
      Assert.input(
        await FS.isFile(manifest),
        `Declared TypeScript dependency '${requirement.alias}' for ${environment.projectRoot} is not installed in its ${
          local ? 'project' : 'private'
        } environment.`,
      )
    }
    links.push({
      relativePath: local ? 'node_modules' : `modules/dependencies/${environment.namespace}/node_modules`,
      target,
    })
  }
  if (!links.some(link => link.relativePath === 'node_modules')) {
    links.unshift({ relativePath: 'node_modules', target: RuntimeToolchainPaths.dependencyRoot() })
  }
  return links
}

async function readOwnedLinks(manifestPath: string): Promise<ModuleLink[]> {
  if (!await FS.isFile(manifestPath)) {
    return []
  }
  const manifest = await FS.readJson<ModuleLinkManifest>(manifestPath)
  Assert.input(
    manifest.version === 1 && Array.isArray(manifest.links),
    `Invalid generated module link manifest: ${manifestPath}`,
  )
  for (const link of manifest.links) {
    Assert.input(
      typeof link.relativePath === 'string'
        && (link.relativePath === 'node_modules'
          || /^modules\/dependencies\/[a-zA-Z0-9_-]+\/node_modules$/u.test(link.relativePath))
        && typeof link.target === 'string' && FS.isAbsolute(link.target),
      `Invalid generated module link manifest: ${manifestPath}`,
    )
  }
  return manifest.links
}

async function assertOwnedLink(outputRoot: string, link: ModuleLink): Promise<void> {
  const path = FS.resolvePath(link.relativePath, outputRoot)
  const metadata = await FS.entryMetadata(path)
  Assert.input(
    metadata.kind === 'symlink' && metadata.linkTarget === link.target,
    `Generated module link was changed outside Tao: ${path}`,
  )
}

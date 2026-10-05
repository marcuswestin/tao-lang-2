import { Packages } from '@ast-utils'
import { CompilerDependencies } from '@compiler'
import { BridgeMetadata, type BridgeModule } from '@compiler/bridge-metadata'
import type { ModuleOrigin } from '@parser'
import { type Diagnostic, FS, Platform } from '@shared'
import type { inspectMaintainedNativeBindings } from 'tao-native-bindings'
import { type ProjectPlannedOutput, snapshotContent } from './ProjectOutputPublisher'
import type { ProjectToolingSourceMapping } from './ProjectTooling'

const TRANSITIVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.mts', '.cts', '.mjs', '.cjs']
type TaoSidecarEdge = ReturnType<typeof CompilerDependencies.taoSidecarEdges>[number]

const ProjectSnapshotValidationMessages = {
  missingRelativeImport: (specifier: string, path: string) =>
    `The dependency TypeScript import ${JSON.stringify(specifier)} from ${path} could not be found.`,
  outsideDependency: (specifier: string, path: string) =>
    `The dependency TypeScript import ${JSON.stringify(specifier)} from ${path} leaves its project root.`,
  unverifiedNativeBinding: (path: string) =>
    `The maintained native TypeScript source ${path} does not match a fresh native binding inspection. Regenerate maintained native bindings.`,
} as const

export type ProjectDependencySnapshots = {
  outputs: readonly ProjectPlannedOutput[]
  diagnostics: readonly Diagnostic[]
  sourceTexts: ReadonlyMap<string, string>
  relativeEdges: ReadonlyMap<string, readonly string[]>
  taoTypeSources: ReadonlyMap<string, ModuleOrigin>
  taoEdges: ReadonlyMap<string, readonly TaoSidecarEdge[]>
}

type SnapshotQueueEntry = {
  sourcePath: string
  origin: ModuleOrigin
  importedFrom: string
  specifier: string
  range?: Diagnostic['range']
}

/** Copy the reachable private TypeScript source closure beside each dependency contract. */
export async function collectProjectDependencySnapshots(
  projectRoot: string,
  modules: readonly BridgeModule[],
  origins: ReadonlyMap<string, ModuleOrigin>,
  nativeBindings?: Awaited<ReturnType<typeof inspectMaintainedNativeBindings>>,
): Promise<ProjectDependencySnapshots> {
  const outputs = new Map<string, ProjectPlannedOutput>()
  const diagnostics: Diagnostic[] = []
  const sourceTexts = new Map<string, string>()
  const relativeEdges = new Map<string, readonly string[]>()
  const taoTypeSources = new Map<string, ModuleOrigin>()
  const taoEdges = new Map<string, readonly TaoSidecarEdge[]>()
  const queue: SnapshotQueueEntry[] = []
  const nativeHashes = new Map<string, string>()
  if (nativeBindings?.status === 'fresh') {
    for (const path of nativeBindings.outputPaths.filter(path => FS.basename(path) === 'maintained.json')) {
      try {
        const manifest = await FS.readJson<{ outputs: { path: string; hash: string }[] }>(path)
        for (const output of manifest.outputs) {
          if (output.path.startsWith('typescript/')) {
            nativeHashes.set(FS.resolvePath(output.path.slice('typescript/'.length), FS.dirname(path)), output.hash)
          }
        }
      } catch {
        // The file can disappear or change after inspection; the service reinspects
        // before publication, and an unreadable manifest never authorizes bytes here.
        diagnostics.push(error(path, ProjectSnapshotValidationMessages.unverifiedNativeBinding(path)))
      }
    }
  }
  for (const module of modules) {
    const origin = origins.get(module.sourcePath)
    if (origin === undefined) {
      continue
    }
    for (const implementation of module.implementationPaths) {
      if (implementation.path !== implementation.sourcePath) {
        queue.push({
          sourcePath: implementation.sourcePath,
          origin,
          importedFrom: module.sourcePath,
          specifier: FS.relativePath(FS.dirname(module.sourcePath), implementation.sourcePath),
          range: module.sourceMappings[0]?.source,
        })
      }
    }
  }

  while (queue.length > 0) {
    const entry = queue.shift()!
    const sourcePath = FS.resolvePath(entry.sourcePath)
    if (
      !FS.pathIsWithin(sourcePath, entry.origin.projectRoot)
      || await Packages.containingProjectRoot(FS.dirname(sourcePath)) !== entry.origin.projectRoot
    ) {
      diagnostics.push(error(
        entry.importedFrom,
        ProjectSnapshotValidationMessages.outsideDependency(entry.specifier, entry.importedFrom),
        entry.range,
      ))
      continue
    }
    const destination = BridgeMetadata.dependencySnapshotPath(projectRoot, sourcePath, entry.origin)
    if (outputs.has(destination)) {
      continue
    }
    if (!await FS.isFile(sourcePath)) {
      diagnostics.push(
        error(sourcePath, ProjectSnapshotValidationMessages.missingRelativeImport(sourcePath, sourcePath)),
      )
      continue
    }
    const original = await FS.readText(sourcePath)
    const isNativeBinding = FS.pathIsWithin(
      sourcePath,
      FS.resolvePath('.tao-ts/native-bindings', entry.origin.projectRoot),
    )
    const nativeHash = Platform.sha256Hex(original)
    if (
      isNativeBinding && (
        nativeBindings?.status !== 'fresh' || !nativeBindings.outputPaths.includes(sourcePath)
        || nativeHashes.get(sourcePath) !== nativeHash
      )
    ) {
      diagnostics.push(error(sourcePath, ProjectSnapshotValidationMessages.unverifiedNativeBinding(sourcePath)))
      continue
    }
    sourceTexts.set(sourcePath, original)
    const content = snapshotContent(sourcePath, original)
    outputs.set(destination, {
      path: destination,
      sourcePath,
      content,
      kind: 'snapshot',
      sourceMappings: [fullFileMapping(sourcePath, destination, original)],
      ...(isNativeBinding ? { nativeBindingProvenance: { identity: nativeBindings!.identity, hash: nativeHash } } : {}),
    })
    if (FS.extname(sourcePath) === '.json') {
      relativeEdges.set(sourcePath, [])
      taoEdges.set(sourcePath, [])
      continue
    }
    taoEdges.set(sourcePath, CompilerDependencies.taoSidecarEdges({ sourcePath, sourceText: original }))
    const edges: string[] = []
    for (const imported of CompilerDependencies.sidecarImports({ sourcePath, sourceText: original })) {
      const specifier = imported.specifier
      if (imported.kind !== 'relative') {
        continue
      }
      const candidate = FS.resolvePath(specifier, FS.dirname(sourcePath))
      if (!FS.pathIsWithin(candidate, entry.origin.projectRoot)) {
        diagnostics.push(
          error(sourcePath, ProjectSnapshotValidationMessages.outsideDependency(specifier, sourcePath), imported.range),
        )
        continue
      }
      if (specifier.endsWith('.tao')) {
        if (await Packages.containingProjectRoot(FS.dirname(candidate)) !== entry.origin.projectRoot) {
          diagnostics.push(
            error(
              sourcePath,
              ProjectSnapshotValidationMessages.outsideDependency(specifier, sourcePath),
              imported.range,
            ),
          )
        } else if (!await FS.isFile(candidate)) {
          diagnostics.push(
            error(
              sourcePath,
              ProjectSnapshotValidationMessages.missingRelativeImport(specifier, sourcePath),
              imported.range,
            ),
          )
        } else {
          const module = FS.relativePath(entry.origin.projectRoot, candidate).split('/')[0] ?? ''
          taoTypeSources.set(candidate, {
            ...entry.origin,
            modulePath: module.startsWith('@')
              ? FS.resolvePath(module, entry.origin.projectRoot)
              : entry.origin.projectRoot,
          })
        }
        continue
      }
      const resolved = await resolveRelativeSource(candidate)
      if (resolved === undefined) {
        diagnostics.push(
          error(
            sourcePath,
            ProjectSnapshotValidationMessages.missingRelativeImport(specifier, sourcePath),
            imported.range,
          ),
        )
        continue
      }
      if (await Packages.containingProjectRoot(FS.dirname(resolved)) !== entry.origin.projectRoot) {
        diagnostics.push(
          error(sourcePath, ProjectSnapshotValidationMessages.outsideDependency(specifier, sourcePath), imported.range),
        )
        continue
      }
      edges.push(resolved)
      queue.push({
        sourcePath: resolved,
        origin: entry.origin,
        importedFrom: sourcePath,
        specifier,
        range: imported.range,
      })
    }
    relativeEdges.set(sourcePath, edges)
  }
  return { outputs: [...outputs.values()], diagnostics, sourceTexts, relativeEdges, taoTypeSources, taoEdges }
}

function fullFileMapping(sourcePath: string, generatedPath: string, original: string): ProjectToolingSourceMapping {
  const lines = original.split('\n')
  const lastLine = lines.length - 1
  const offset = FS.extname(sourcePath) === '.json' ? 0 : 1
  return {
    generatedPath,
    generatedRange: {
      start: { line: offset, character: 0 },
      end: { line: lastLine + offset, character: lines[lastLine]!.length },
    },
    sourcePath,
    sourceRange: {
      start: { line: 0, character: 0 },
      end: { line: lastLine, character: lines[lastLine]!.length },
    },
  }
}

/** Match native relative sidecar imports while following a source closure. */
export async function resolveRelativeSource(candidate: string): Promise<string | undefined> {
  if (await FS.isFile(candidate)) {
    return candidate
  }
  for (const extension of TRANSITIVE_EXTENSIONS) {
    if (await FS.isFile(`${candidate}${extension}`)) {
      return `${candidate}${extension}`
    }
  }
  if (/\.jsx?$/.test(candidate)) {
    const source = candidate.replace(/\.jsx?$/, candidate.endsWith('.jsx') ? '.tsx' : '.ts')
    if (await FS.isFile(source)) {
      return source
    }
  }
  if (await FS.isDirectory(candidate)) {
    for (const extension of TRANSITIVE_EXTENSIONS) {
      const index = FS.resolvePath(`index${extension}`, candidate)
      if (await FS.isFile(index)) {
        return index
      }
    }
  }
  return undefined
}

function error(filePath: string, message: string, range?: Diagnostic['range']): Diagnostic {
  return { filePath, message, severity: 'error', source: 'compiler', ...(range === undefined ? {} : { range }) }
}

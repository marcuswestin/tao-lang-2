import { Packages } from '@ast-utils'
import type { DependencyEnvironment } from '@compiler'
import type { BridgeModule } from '@compiler/bridge-metadata'
import type { SidecarSourceGraphInspection } from '@compiler/sidecar-source-graph'
import { discoverProjectTaoFiles } from '@compiler/workspace'
import { type Diagnostic, FS, Platform, ReleaseCapabilities } from '@shared'
import type { ProjectPlannedOutput, ProjectPublishedOutputs } from './ProjectOutputPublisher'
import type { ProjectToolingOptions, ProjectToolingResult } from './ProjectTooling'

type Discovery = {
  sourcePaths: readonly string[]
  sourceOwners: readonly (string | undefined)[]
  entryPaths: readonly string[]
  contextFingerprint?: string
}
type Audit = {
  key: string
  fingerprint: string
  texts: ReadonlyMap<string, string>
  discoveries: ReadonlyMap<string, Discovery>
}

/** Plain saved inputs and publication metadata; no compiler documents outlive a refresh. */
export type ProjectRefreshReceiptData = {
  result: ProjectToolingResult
  nativeDiagnostics: readonly Diagnostic[]
  nativeIdentity: string
  nativeContracts: readonly BridgeModule[]
  published: ProjectPublishedOutputs
  planned: readonly ProjectPlannedOutput[]
  environments: readonly DependencyEnvironment[]
  privatePackages: ReadonlySet<string>
  consumedTexts: ReadonlyMap<string, string>
  sidecars: ReadonlyMap<string, SidecarSourceGraphInspection>
  auditComplete: boolean
  discovery: Discovery
}

const SOURCE_EXTENSIONS = new Set([
  '.tao',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
])
const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.git', '.artifacts', '.expo', '.tao-ts', '.tao'])

/** One watch's last fully audited fresh publication, released when the watch stops. */
export class ProjectRefreshReceipt {
  private roots: string[]
  private probes: string[] = []
  private saved?: { audit: Audit; outputs: string; data: ProjectRefreshReceiptData }

  constructor(private readonly root: string, private readonly stdlibRoot: string) {
    this.roots = [...new Set([root, FS.resolvePath(stdlibRoot)])]
  }

  clear(): void {
    this.saved = undefined
  }

  static contextFingerprint(context: Packages.Context): string {
    return JSON.stringify([
      context.stdlibRoot,
      context.index.projectRoot,
      context.index.projectRoots,
      [...context.index.packages],
    ])
  }

  async audit(options: ProjectToolingOptions, force = false, nativeIdentity?: string): Promise<Audit | undefined> {
    if (force) {
      this.clear()
    }
    try {
      const records: string[] = []
      const texts = new Map<string, string>()
      const discoveries = new Map<string, Discovery>()
      const stdlibRoot = FS.resolvePath(options.nativeBindings?.stdlibRoot ?? this.stdlibRoot)
      let complete = true
      const observe = async (path: string): Promise<void> => {
        if (forbiddenInput(path) || FS.isFileMutationAuxiliaryPath(path)) {
          return
        }
        // Symlinked authored trees require a physical discovery audit, which this receipt
        // deliberately leaves to the cold path rather than following an incomplete tree.
        if (await FS.isSymbolicLink(path)) {
          complete = false
          return
        }
        if (!await FS.exists(path)) {
          records.push(JSON.stringify([path, 'missing']))
        } else if (await FS.isDirectory(path)) {
          records.push(JSON.stringify([path, 'directory', await FS.realPath(path)]))
        } else if (SOURCE_EXTENSIONS.has(FS.extname(path)) || FS.basename(path) === '.gitignore') {
          const text = await FS.readText(path)
          texts.set(path, text)
          records.push(JSON.stringify([path, await FS.realPath(path), Platform.sha256Hex(text)]))
        }
      }
      for (const root of new Set([this.root, ...this.roots.filter(root => root !== this.stdlibRoot), stdlibRoot])) {
        await observe(root)
        if (!await FS.isDirectory(root)) {
          continue
        }
        const sourcePaths = await discoverProjectTaoFiles(root)
        const sourceOwners = root === this.root
          ? await Promise.all(sourcePaths.map(path => Packages.containingProjectRoot(FS.dirname(path))))
          : []
        const discovery = {
          sourcePaths,
          sourceOwners,
          entryPaths: sourcePaths.filter((_, index) => sourceOwners[index] === root),
          contextFingerprint: root === this.root
            ? ProjectRefreshReceipt.contextFingerprint(await Packages.createContext(root, { stdlibRoot }))
            : undefined,
        }
        discoveries.set(root, discovery)
        records.push(JSON.stringify([root, discovery]))
        for await (
          const path of FS.walk(root, {
            includeHidden: true,
            includeDirectories: true,
            excludeDirectory: name => EXCLUDED_DIRECTORIES.has(name) || name.startsWith('_gen_'),
          })
        ) {
          const name = FS.basename(path)
          if (EXCLUDED_DIRECTORIES.has(name) && name !== '.tao') {
            continue
          }
          await observe(path)
          if (name === '.tao' && await FS.isDirectory(path)) {
            const store = FS.resolvePath('store', path)
            await observe(store)
            await observe(FS.resolvePath('project.json', store))
            await observe(FS.resolvePath('lock.jsonc', store))
          }
        }
      }
      for (const path of this.probes) {
        await observe(path)
      }
      if (!complete) {
        return undefined
      }
      return {
        key: JSON.stringify([
          this.root,
          options.runtimeRoot,
          stdlibRoot,
          options.nativeBindings?.sourceRoots?.map(path => FS.resolvePath(path)),
          nativeIdentity,
          options.hostModulesRoot,
          options.hostModuleRoots,
          ReleaseCapabilities.fingerprint(),
        ]),
        fingerprint: Platform.sha256Hex(records.sort().join('\n')),
        texts,
        discoveries,
      }
    } catch {
      // A transient or incomplete filesystem view cannot authorize reuse.
      return undefined
    }
  }

  async candidate(audit: Audit | undefined): Promise<ProjectRefreshReceiptData | undefined> {
    const saved = this.saved
    if (!audit || !saved || !sameAudit(audit, saved.audit)) {
      return undefined
    }
    return await this.outputFingerprint() === saved.outputs ? saved.data : undefined
  }

  async remember(
    before: Audit | undefined,
    options: ProjectToolingOptions,
    data: ProjectRefreshReceiptData,
  ): Promise<void> {
    this.clear()
    const roots = [
      ...new Set([
        this.root,
        FS.resolvePath(options.nativeBindings?.stdlibRoot ?? this.stdlibRoot),
        ...data.result.dependencyRoots,
      ]),
    ].sort()
    const probes = [
      ...new Set([
        ...data.result.configInputPaths,
        ...data.result.sidecarOwnershipInputPaths,
        ...[...data.sidecars.values()].flatMap(inspection => inspection.unresolvedCandidatePaths),
      ]),
    ].sort()
    const expanded = JSON.stringify(roots) !== JSON.stringify([...this.roots].sort())
      || JSON.stringify(probes) !== JSON.stringify(this.probes)
    this.roots = roots
    this.probes = probes
    if (
      expanded || !data.auditComplete || data.result.status !== 'fresh'
      || data.result.externalSidecarInputPaths.length > 0
      || data.result.dependencyRoots.some(root => root !== this.root)
      || !before
    ) {
      return
    }
    const after = await this.audit(options, false, data.nativeIdentity)
    if (!after || !sameAudit(before, after)) {
      return
    }
    for (const audit of [before, after]) {
      const discovery = audit.discoveries.get(this.root)
      if (
        !discovery
        || JSON.stringify([discovery.sourcePaths, discovery.sourceOwners, discovery.entryPaths])
          !== JSON.stringify([data.discovery.sourcePaths, data.discovery.sourceOwners, data.discovery.entryPaths])
        || (data.discovery.contextFingerprint !== undefined
          && discovery.contextFingerprint !== data.discovery.contextFingerprint)
      ) {
        return
      }
    }
    for (const [path, text] of data.consumedTexts) {
      if (before.texts.get(path) !== text || after.texts.get(path) !== text) {
        return
      }
    }
    // Record the publication we actually produced, not bytes another writer replaced
    // between publication and this audit. The manifest is not a TypeScript input.
    if (!await this.publicationMatches(data.planned)) {
      return
    }
    const outputs = await this.outputFingerprint()
    if (outputs !== undefined) {
      this.saved = { audit: after, outputs, data }
    }
  }

  private async publicationMatches(planned: readonly ProjectPlannedOutput[]): Promise<boolean> {
    try {
      const manifest = {
        version: 1,
        outputs: planned.map(output => ({
          path: FS.resolvePath(output.path),
          sourcePath: FS.resolvePath(output.sourcePath),
          hash: Platform.sha256Hex(output.content),
          kind: output.kind,
          sourceMappings: output.sourceMappings,
        })).toSorted((left, right) => left.path.localeCompare(right.path)),
      }
      if (
        await FS.readText(FS.resolvePath('.tao/cache/typescript/outputs.json', this.root))
          !== `${JSON.stringify(manifest, null, 2)}\n`
      ) {
        return false
      }
      for (const output of planned) {
        if (!await FS.isFile(output.path) || await FS.readText(output.path) !== output.content) {
          return false
        }
      }
      return true
    } catch {
      return false
    }
  }

  private async outputFingerprint(): Promise<string | undefined> {
    try {
      const paths = [
        FS.resolvePath('tsconfig.json', this.root),
        FS.resolvePath('.tao/cache/typescript/tsconfig.json', this.root),
        FS.resolvePath('.tao/cache/typescript/outputs.json', this.root),
      ]
      const generated = FS.resolvePath('.tao-ts', this.root)
      if (await FS.isDirectory(generated)) {
        for await (
          const path of FS.walk(generated, {
            includeHidden: true,
            includeDirectories: true,
            excludeDirectory: name => name === 'node_modules',
          })
        ) {
          if (FS.basename(path) !== 'node_modules' && !FS.isFileMutationAuxiliaryPath(path)) {
            paths.push(path)
          }
        }
      }
      const records: string[] = []
      for (const path of paths.sort()) {
        if (forbiddenInput(path) || await FS.isSymbolicLink(path)) {
          return undefined
        }
        records.push(JSON.stringify([
          path,
          await FS.exists(path) ? await FS.realPath(path) : undefined,
          await FS.isFile(path) ? Platform.sha256Hex(await FS.readText(path)) : await FS.isDirectory(path),
        ]))
      }
      return Platform.sha256Hex(records.join('\n'))
    } catch {
      return undefined
    }
  }
}

function sameAudit(left: Audit, right: Audit): boolean {
  return left.key === right.key && left.fingerprint === right.fingerprint
}

function forbiddenInput(path: string): boolean {
  const name = FS.basename(path)
  return name === '.env' || name.startsWith('.env.')
}

import {
  AST,
  type PackageResolver,
  type ProjectAppRequirements,
  type ProjectGraph,
  type ProjectModuleBinding,
  type ProjectPublication,
  type ProjectRequirement,
} from '@parser'
import { FS, Platform, Repo, TaoFiles } from '@shared'
import { Stdlib } from '@stdlib'
import { datasourceCollectionNames } from './data-stores'
import { Type } from './Type'

/** Packages exposes Tao package discovery, import resolution, and visibility helpers. */
export namespace Packages {
  type Indexed = {
    name: string
    path: string
    duplicatePaths: readonly string[]
  }

  /** Index maps `@package` names to all matching package folder paths. */
  export type Index = {
    projectRoot: string
    projectRoots: string[]
    packages: Map<string, string[]>
  }

  /** Context declares shared lookup state for Tao imports. */
  export type Context = {
    sourcePaths?: ReadonlySet<string>
    index: Index
    stdlibRoot: string
    /**
     * Symlink-resolved paths the current workspace build has already asked the file system about.
     * Document lifecycle events clear candidate paths before linking can reuse them, while stable
     * paths remain shared across every reference resolved within one build.
     */
    physicalPaths: Map<string, string>
    requirementAliases: Map<string, {
      requirement: AST.PackageRequires
      targetProjectRoot: string
      sourceModuleRoot: string
    }>
  }

  /** ContextOptions configures package roots shared by one parser or workspace lifetime. */
  export type ContextOptions = {
    sourcePaths?: readonly string[]
    stdlibRoot?: string
  }

  export type Relation =
    | 'same-file'
    | 'same-directory'
    | 'same-package'
    | 'same-project-package'
    | 'external-publication'
    | 'stdlib'
    | 'invalid'

  type CandidateMode = 'direct' | 'recursive'

  type InvalidReason =
    | 'duplicate-package'
    | 'package-not-found'
    | 'package-boundary'
    | 'package-path-escape'
    | 'project-boundary'

  /** Resolution declares resolved lookup metadata for a use statement. */
  export type Resolution = {
    importPath?: string
    relation: Relation
    targetPath?: string
    candidateMode?: CandidateMode
    packageName?: string
    duplicatePackagePaths?: readonly string[]
    invalidReason?: InvalidReason
    reservedPackagePath?: string
    excludedProjectRoots?: readonly string[]
    /** Existing candidates must remain physically inside this root after symlink resolution. */
    physicalBoundaryRoot?: string
    requirement?: AST.PackageRequires
  }

  /** ResolveRequest declares one import resolution request. */
  export interface ResolveRequest {
    importPath?: string
    fromFilePath: string
  }

  /** TargetMatchRequest declares one target-file membership check. */
  export interface TargetMatchRequest {
    filePath: string
    workspaceFilePaths: ReadonlySet<string>
  }

  type BuildCacheResolver = PackageResolver & {
    clearPhysicalPathCache(): void
  }

  /** createResolver creates a parser package resolver backed by this package context. */
  export function createResolver(context: Context): PackageResolver {
    const resolver: BuildCacheResolver = {
      clearPhysicalPathCache() {
        context.physicalPaths.clear()
      },
      async intrinsicFilePaths() {
        const prelude = FS.resolvePath('@tao/Prelude.tao', context.stdlibRoot)
        return await Promise.all(
          [prelude].map(async path => path && await FS.isFile(path) ? path : undefined),
        )
          .then(paths => paths.filter((path): path is string => path !== undefined))
      },
      async projectRootFilePaths(fromFilePath) {
        // Each parser load rebuilds requirement bindings from current source, including removals.
        context.requirementAliases.clear()
        const root = await containingProjectRoot(FS.dirname(fromFilePath))
        if (!root) {
          return []
        }
        return (await FS.listDir(root)).filter(isImportableTaoSourceName)
          .map(name => FS.resolvePath(name, root))
      },
      async requirementFilePaths(requirement, fromFilePath) {
        if (!requirement.locator) {
          return []
        }
        const sourceRoot = await containingProjectRoot(FS.dirname(fromFilePath))
        if (!sourceRoot) {
          return []
        }
        const targetRoot = FS.resolvePath(requirement.locator, sourceRoot)
        if (!await FS.isDirectory(FS.resolvePath('.tao', targetRoot))) {
          return []
        }
        if (!context.index.projectRoots.includes(targetRoot)) {
          context.index.projectRoots.push(targetRoot)
        }
        for (const name of await FS.listDir(targetRoot)) {
          if (!name.startsWith('@') || name === '@') {
            continue
          }
          const moduleRoot = FS.resolvePath(name, targetRoot)
          if (await FS.isDirectory(moduleRoot)) {
            const indexed = context.index.packages.get(name) ?? []
            if (!indexed.includes(moduleRoot)) {
              context.index.packages.set(name, [...indexed, moduleRoot])
            }
          }
        }
        for (const binding of requirement.bindings?.bindings ?? []) {
          const localName = binding.alias ?? binding.module
          const key = `${sourceRoot}#${localName}`
          context.requirementAliases.set(key, {
            requirement,
            targetProjectRoot: targetRoot,
            sourceModuleRoot: FS.resolvePath(binding.module, targetRoot),
          })
        }
        const sweep = createProjectRootSweep()
        const files = await Repo.filesUnder(targetRoot, {
          excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
          extensions: ['.tao'],
        })
        const owners = await Promise.all(files.map(path => containingProjectRoot(FS.dirname(path), sweep)))
        return files.filter((path, index) => owners[index] === targetRoot && isImportableTaoSourcePath(path))
      },
      collectTargetDeclarations(useStatement, request) {
        const resolution = resolveUse(context, useStatement, request.fromFilePath)
        const selectedPublication = resolution.requirement
          ? createProjectGraph(context, request, false).requirements
            .find(entry => entry.declaration === resolution.requirement)?.selectedPublication
          : undefined
        const workspaceFilePaths = new Set(request.workspaceFiles.map(workspaceFilePath))
        const targetFiles = request.workspaceFiles.filter(file =>
          targetMatches(context, resolution, {
            filePath: workspaceFilePath(file),
            workspaceFilePaths,
          })
        )
        return targetFiles.flatMap(file =>
          file.statements
            .filter(AST.isDeclaration)
            .filter(declaration => declarationIsImportableFromUse(declaration, resolution))
            .filter(declaration =>
              resolution.relation !== 'external-publication'
              || selectedPublication?.publicDeclarations.includes(declaration) === true
            )
        )
      },
      async candidateFilePaths(useStatement, request) {
        const resolution = resolveUse(context, useStatement, request.fromFilePath)
        const diskPaths = await candidateFilePaths(resolution)
        const sourcePaths = [...context.sourcePaths ?? []]
        const workspaceFilePaths = new Set([...diskPaths, ...sourcePaths])
        return [...workspaceFilePaths].filter(filePath =>
          targetMatches(context, resolution, { filePath, workspaceFilePaths })
        )
      },
      projectSourceFiles(request) {
        const projectRoot = projectRootForPath(context.index, request.fromFilePath)
        return request.workspaceFiles.filter(file => {
          const path = workspaceFilePath(file)
          return !isTestSourcePath(path) && projectRootForPath(context.index, path) === projectRoot
        })
      },
      projectGraph(request) {
        return createProjectGraph(context, request)
      },
    }
    return resolver
  }

  /** createProjectGraph keeps publication API selection separate from private source reachability. */
  function createProjectGraph(
    context: Context,
    request: { fromFilePath: string; workspaceFiles: readonly AST.TaoFile[] },
    includeReachability: boolean = true,
  ): ProjectGraph {
    const projectRoot = projectRootForPath(context.index, request.fromFilePath)
      ?? FS.dirname(request.fromFilePath)
    // A validation result may expose only its requested entries even though the parser built and
    // linked their dependencies. Recover that same build's documents from each entry's AST.
    const allFiles = [...new Set(request.workspaceFiles.flatMap(AST.workspaceFilesFor))]
      .filter(file => {
        const path = workspaceFilePath(file)
        return !isTestSourcePath(path) || path === request.fromFilePath
      })
    if (includeReachability) {
      // A fresh resolver has not run requirementFilePaths, so index the roots of the linked
      // documents before assigning files to publications. Checking each ancestor also preserves
      // isolation when a required project contains a nested project marker.
      for (const file of allFiles) {
        let directory = FS.dirname(workspaceFilePath(file))
        while (true) {
          const marker = FS.resolvePath('.tao', directory)
          if (FS.existsSync(marker)) {
            try {
              FS.listDirSync(marker)
              if (!context.index.projectRoots.includes(directory)) {
                context.index.projectRoots.push(directory)
              }
              break
            } catch {
              // A file named .tao is not a project marker.
            }
          }
          const parent = FS.dirname(directory)
          if (parent === directory || FS.existsSync(FS.resolvePath('.git', directory))) {
            break
          }
          directory = parent
        }
      }
      for (const file of allFiles) {
        const filePath = workspaceFilePath(file)
        const owner = projectRootForPath(context.index, filePath)
        if (!owner) {
          continue
        }
        let directory = owner
        for (const segment of FS.dirname(FS.relativePath(owner, filePath)).split('/')) {
          directory = FS.resolvePath(segment, directory)
          if (!segment.startsWith('@') || segment === '@') {
            continue
          }
          const paths = context.index.packages.get(segment) ?? []
          if (!paths.includes(directory)) {
            context.index.packages.set(segment, [...paths, directory])
          }
        }
      }
    }
    const projectFiles = allFiles.filter(file =>
      projectRootForPath(context.index, workspaceFilePath(file)) === projectRoot
    )
    const publicationFiles = allFiles.filter(file => !isTestSourcePath(workspaceFilePath(file)))
    const publicationDeclarations = publicationFiles.flatMap(file => file.statements.filter(AST.isPackageDeclaration))
    const publicationRequirements = new Map<AST.PackageDeclaration, ProjectRequirement[]>()
    const publications = publicationDeclarations.map(declaration => {
      const owned: ProjectRequirement[] = []
      publicationRequirements.set(declaration, owned)
      return publicationGraph(context.index, declaration, publicationFiles, owned, includeReachability)
    })
    const byDeclaration = new Map<AST.PackageRequires, ProjectRequirement>()
    for (const file of allFiles) {
      const sourceRoot = projectRootForPath(context.index, workspaceFilePath(file))
        ?? FS.dirname(workspaceFilePath(file))
      for (const declaration of AST.streamAllContents(file).filter(AST.isPackageRequires)) {
        byDeclaration.set(declaration, requirementGraph(declaration, sourceRoot, publications))
      }
    }
    for (const publication of publications) {
      publicationRequirements.get(publication.declaration)?.push(
        ...publication.declaration.block.statements.filter(AST.isPackageRequires)
          .flatMap(declaration => byDeclaration.get(declaration) ?? []),
      )
    }
    const requirements = projectFiles.flatMap(file =>
      AST.streamAllContents(file).filter(AST.isPackageRequires)
        .flatMap(declaration => byDeclaration.get(declaration) ?? [])
    )
    const appRequirements: ProjectAppRequirements[] = includeReachability
      ? projectFiles.flatMap(file =>
        AST.appValueDeclarationsInFile(file).map(app => {
          const sourceDeclarations = reachableProjectDeclarations([app], allFiles, projectRoot, context.index)
          return {
            app,
            requirements: effectiveAppRequirementDeclarations(app)
              .flatMap(declaration => byDeclaration.get(declaration) ?? []),
            sourceDeclarations,
            sourceFiles: [
              ...new Set(
                sourceDeclarations.map(declaration => AST.getDocument(declaration).parseResult.value).filter(
                  AST.isTaoFile,
                ),
              ),
            ],
          }
        })
      )
      : []
    return { projectRoot, projectFiles, publications, requirements, appRequirements }
  }

  /** A variant inherits its base app's requirements and adds requirements in its own patch. */
  function effectiveAppRequirementDeclarations(
    app: AST.AppValueDeclaration,
    seen: Set<AST.AppValueDeclaration> = new Set(),
  ): readonly AST.PackageRequires[] {
    if (seen.has(app)) {
      return []
    }
    seen.add(app)
    if (AST.isAppDeclaration(app) && app.block) {
      return app.block.statements.filter(AST.isPackageRequires)
    }
    const expression = app.value
    if (!expression) {
      return []
    }
    if (
      AST.isPrimitiveConfigurationConstructor(expression)
      || AST.isInferredConfigurationConstructor(expression)
      || AST.isConfigurationConstructor(expression)
    ) {
      return expression.block?.entries.flatMap(entry => entry.requirement ?? []) ?? []
    }
    if (AST.isRefinementExpression(expression) || AST.isValueReference(expression)) {
      const base = expression.target.ref
      const inherited = base && AST.isAppValueDeclaration(base)
        ? effectiveAppRequirementDeclarations(base, seen)
        : []
      const added = AST.isRefinementExpression(expression)
        ? expression.patchBlock.entries.flatMap(entry => entry.requirement ?? [])
        : []
      return [...new Set([...inherited, ...added])]
    }
    return []
  }

  function publicationGraph(
    index: Index,
    declaration: AST.PackageDeclaration,
    allFiles: readonly AST.TaoFile[],
    requirements: readonly ProjectRequirement[],
    includeReachability: boolean,
  ): ProjectPublication {
    const projectRoot = FS.dirname(AST.getDocument(declaration).uri.path)
    const name = declaration.block.statements.find(AST.isPackageName)?.value
    const version = declaration.block.statements.find(AST.isPackageVersion)?.value
    const includedModuleRoots = declaration.block.statements.filter(AST.isPackageIncludes)
      .flatMap(includes => includes.modules.map(module => FS.resolvePath(module, projectRoot)))
    const includedFiles = allFiles.filter(file =>
      projectRootForPath(index, workspaceFilePath(file)) === projectRoot
      && includedModuleRoots.includes(containingPath(workspaceFilePath(file), index)?.path ?? '')
    )
    const publicDeclarations = includedFiles.flatMap(file =>
      file.statements.filter(AST.isDeclaration).filter(statement => visibilityOf(statement) === 'public')
    )
    const sourceDeclarations = includeReachability
      ? reachableProjectDeclarations(publicDeclarations, allFiles, projectRoot, index)
      : publicDeclarations
    return {
      declaration,
      name,
      version,
      includedModuleRoots,
      publicDeclarations,
      requirements,
      sourceDeclarations,
      sourceFiles: [
        ...new Set(sourceDeclarations.map(entry => AST.getDocument(entry).parseResult.value).filter(AST.isTaoFile)),
      ],
    }
  }

  /** Reachability stays at declaration granularity so another app in the same file owns no edges. */
  export function reachableProjectDeclarations(
    seeds: readonly AST.Node[],
    allFiles: readonly AST.TaoFile[],
    projectRoot: string,
    index: Index,
  ): readonly AST.Declaration[] {
    const eligible = new Set(
      allFiles
        .filter(file => projectRootForPath(index, workspaceFilePath(file)) === projectRoot)
        .map(workspaceFilePath),
    )
    const reached = new Set<AST.Declaration>()
    const queue = seeds.flatMap(seed => topLevelDeclaration(seed) ?? [])
    while (queue.length > 0) {
      const declaration = queue.shift()!
      if (reached.has(declaration) || !eligible.has(AST.getDocument(declaration).uri.path)) {
        continue
      }
      reached.add(declaration)
      for (const node of [declaration, ...AST.streamAllContents(declaration)]) {
        // Queries and relations select entities by name, outside Langium cross-references.
        // Datasource Data membership is likewise a structural name list.
        if (AST.isEntityQueryDeclaration(node)) {
          const entity = Type.queryEntity(node)
          if (entity) {
            queue.push(entity)
          }
        } else if (AST.isEntityDataField(node)) {
          const entity = Type.dataFieldRelationEntity(node)
          if (entity) {
            queue.push(entity)
          }
        }
        for (const reference of AST.streamReferences(node)) {
          const target = 'ref' in reference.reference ? reference.reference.ref : undefined
          const local = target && topLevelDeclaration(target)
          if (local && !reached.has(local)) {
            queue.push(local)
          }
        }
      }
      if (AST.isDatasourceDeclaration(declaration)) {
        const names = datasourceCollectionNames(declaration) ?? []
        for (const entity of AST.visibleFileDeclarations(declaration, AST.isEntityDataDeclaration)) {
          if (names.includes(entity.name)) {
            queue.push(entity)
          }
        }
      }
    }
    return [...reached]
  }

  function topLevelDeclaration(node: AST.Node): AST.Declaration | undefined {
    let current: AST.Node | undefined = node
    while (current && !AST.isTaoFile(current)) {
      if (AST.isDeclaration(current) && AST.isTaoFile(current.$container)) {
        return current
      }
      current = current.$container
    }
    return undefined
  }

  function requirementGraph(
    declaration: AST.PackageRequires,
    sourceRoot: string,
    publications: readonly ProjectPublication[],
  ): ProjectRequirement {
    const targetProjectRoot = declaration.locator ? FS.resolvePath(declaration.locator, sourceRoot) : undefined
    const targetPublications = targetProjectRoot === undefined
      ? []
      : publications.filter(publication =>
        FS.dirname(AST.getDocument(publication.declaration).uri.path) === targetProjectRoot
      )
    const selectedPublication = targetPublications.find(publication =>
      publication.name === declaration.name
      && publication.version !== undefined
      && versionMatches(publication.version, declaration.version)
    )
    const bindings: ProjectModuleBinding[] = []
    const seenBindings = new Set<string>()
    if (selectedPublication && targetProjectRoot) {
      for (const binding of declaration.bindings?.bindings ?? []) {
        const sourceModuleRoot = FS.resolvePath(binding.module, targetProjectRoot)
        if (!selectedPublication.includedModuleRoots.includes(sourceModuleRoot)) {
          continue
        }
        const localName = binding.alias ?? binding.module
        const bindingKey = `${localName}#${sourceModuleRoot}`
        if (seenBindings.has(bindingKey)) {
          continue
        }
        seenBindings.add(bindingKey)
        bindings.push({
          localName,
          origin: {
            projectRoot: targetProjectRoot,
            packageName: selectedPublication.name,
            packageVersion: selectedPublication.version,
            modulePath: sourceModuleRoot,
          },
          sourceRoot: sourceModuleRoot,
          requirement: declaration,
        })
      }
    }
    return {
      declaration,
      sourceRoot,
      targetProjectRoot,
      requestedName: declaration.name,
      versionRange: declaration.version,
      selectedPublication,
      bindings,
    }
  }

  function versionMatches(version: string, range: string): boolean {
    try {
      return Platform.semverSatisfies(version, range)
    } catch {
      return false
    }
  }

  /** createContext creates shared package lookup state for one project root. */
  export async function createContext(projectRoot: string, options: ContextOptions = {}): Promise<Context> {
    const resolvedProjectRoot = FS.resolvePath(projectRoot)
    return {
      index: await createIndex(resolvedProjectRoot, options.sourcePaths),
      sourcePaths: options.sourcePaths === undefined ? undefined : new Set(options.sourcePaths),
      stdlibRoot: FS.resolvePath(options.stdlibRoot ?? Stdlib.rootPath),
      physicalPaths: new Map(),
      requirementAliases: new Map(),
    }
  }

  /** createIndex scans one project root for project-local Tao package directories. */
  export async function createIndex(projectRoot: string, sourcePaths: readonly string[] = []): Promise<Index> {
    const requestedRoot = FS.resolvePath(projectRoot)
    const resolvedRoot = await containingProjectRoot(requestedRoot) ?? requestedRoot
    const scanRoot = await FS.realPath(resolvedRoot).catch(() => resolvedRoot)
    // One discovery answers every question below. Opening a workspace used to ask Git five times —
    // for the project roots, the package directories, and each package's sources — at about 30ms
    // a spawn on a busy machine, which was most of what opening cost.
    const listing = await Repo.listUnder(scanRoot)
    const discoveredProjectRoots = await discoverProjectRoots(resolvedRoot, scanRoot, listing)
    const projectRoots = discoveredProjectRoots.length === 0 ? [resolvedRoot] : discoveredProjectRoots
    const packages = new Map<string, string[]>()
    const record = (path: string) => {
      const name = FS.basename(path)
      const paths = packages.get(name) ?? []
      if (!paths.includes(path)) {
        paths.push(path)
      }
      packages.set(name, paths)
    }
    if (await FS.isDirectory(resolvedRoot)) {
      const generatedPackage = FS.resolvePath('@', resolvedRoot)
      if (await FS.isDirectory(generatedPackage)) {
        // The bare `@` directory is a reserved project package even while its generated scaffold
        // is empty. Studio may populate it after the package context has been created.
        record(generatedPackage)
      }
      for (const root of projectRoots) {
        const projectGeneratedPackage = FS.resolvePath('@', root)
        if (projectGeneratedPackage !== generatedPackage && await FS.isDirectory(projectGeneratedPackage)) {
          record(projectGeneratedPackage)
        }
      }
      for (const scannedPath of listing.directories({ namePrefix: '@' })) {
        const path = FS.resolvePath(FS.relativePath(scanRoot, scannedPath), resolvedRoot)
        if (FS.basename(path) === '@') {
          continue
        }
        const owningRoot = projectRoots
          .filter(root => FS.pathIsWithin(path, root))
          .toSorted((left, right) => right.length - left.length)[0]
        const excluded = owningRoot
          && FS.relativePath(owningRoot, path).split('/').some(segment =>
            segment.startsWith('_gen_tao-') || segment.startsWith('.tao-')
            || TaoFiles.discoveryExcludeDirectoryNames.some(excluded => excluded === segment)
          )
        if (owningRoot && path !== owningRoot && !excluded && containsTaoSource(listing, scannedPath)) {
          record(path)
        }
      }
    }
    for (const sourcePath of sourcePaths) {
      const projectRoot = projectRoots
        .filter(root => FS.pathIsWithin(sourcePath, root))
        .toSorted((left, right) => right.length - left.length)[0] ?? resolvedRoot
      const relative = FS.relativePath(projectRoot, sourcePath)
      const moduleName = relative.split('/')[0]
      if (moduleName?.startsWith('@') && moduleName.length > 1) {
        record(FS.resolvePath(moduleName, projectRoot))
      }
    }
    for (const paths of packages.values()) {
      paths.sort()
    }
    return { projectRoot: resolvedRoot, projectRoots, packages }
  }

  function containsTaoSource(listing: Repo.Listing, directory: string): boolean {
    return listing.files({ extensions: ['.tao'] }).some(path => FS.pathIsWithin(path, directory))
  }

  /**
   * ProjectRootSweep memoizes the directories one sweep has already asked about.
   *
   * The marker lookup is scoped to one sweep so a long-lived language server can see a new .tao/.
   */
  export type ProjectRootSweep = {
    readonly declarations: Map<string, Promise<boolean>>
  }

  /** createProjectRootSweep opens a memo for one sweep of project-root lookups. */
  export function createProjectRootSweep(): ProjectRootSweep {
    return { declarations: new Map() }
  }

  /** ContainingProjectRootOptions overrides the temp-directory boundary; production leaves it unset. */
  export type ContainingProjectRootOptions = {
    /** temporaryRoot stands in for the OS temp directory. Tests point this at a fixture directory. */
    temporaryRoot?: string
  }

  /**
   * containingProjectRoot finds the nearest ancestor containing a direct .tao/ marker.
   * Pass a `sweep` when resolving many paths at once so they share the memo.
   *
   * The climb never treats the OS temp directory itself as a project root and stops there, the same
   * way it stops at `.git`. A stray marker left directly in the temp directory by an unrelated
   * process would otherwise make every fixture beneath it resolve to that directory.
   */
  export async function containingProjectRoot(
    start: string,
    sweep?: ProjectRootSweep,
    options?: ContainingProjectRootOptions,
  ): Promise<string | undefined> {
    const memo = sweep ?? createProjectRootSweep()
    const boundary = await temporaryClimbBoundary(options?.temporaryRoot)
    let directory = start
    while (true) {
      if (boundary.has(directory)) {
        return undefined
      }
      if (await declaresProject(memo, directory)) {
        return directory
      }
      if (await FS.exists(FS.resolvePath('.git', directory))) {
        return undefined
      }
      const parent = FS.dirname(directory)
      if (parent === directory) {
        return undefined
      }
      directory = parent
    }
  }

  /**
   * temporaryClimbBoundary resolves the OS temp directory both as reported and with symlinks
   * resolved, since macOS reports `/tmp` while resolving it to `/private/tmp`, and `$TMPDIR` itself
   * can be a symlinked `/var/folders/…` path. `start` may be given in either spelling, so both must
   * be recognized to stop the climb there.
   */
  async function temporaryClimbBoundary(temporaryRoot?: string): Promise<ReadonlySet<string>> {
    const root = FS.resolvePath(temporaryRoot ?? FS.tmpdir())
    const realRoot = await FS.realPath(root).catch(() => root)
    return new Set([root, realRoot])
  }

  /**
   * declaresProject answers from the sweep's memo, storing the pending promise so concurrent
   * walkers asking about one ancestor wait on a single directory lookup.
   */
  async function declaresProject(sweep: ProjectRootSweep, directory: string): Promise<boolean> {
    const asked = sweep.declarations.get(directory)
    if (asked !== undefined) {
      return await asked
    }
    const pending = directoryDeclaresProject(directory)
    sweep.declarations.set(directory, pending)
    return await pending
  }

  async function directoryDeclaresProject(directory: string): Promise<boolean> {
    return await FS.isDirectory(FS.resolvePath('.tao', directory))
  }

  async function discoverProjectRoots(root: string, scanRoot: string, listing: Repo.Listing): Promise<string[]> {
    const roots = new Set<string>()
    const sweep = createProjectRootSweep()
    for (
      const scannedPath of listing.files({
        excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
        extensions: ['.tao'],
      })
    ) {
      const path = FS.resolvePath(FS.relativePath(scanRoot, scannedPath), root)
      if (!isImportableTaoSourcePath(path)) {
        continue
      }
      const discovered = await containingProjectRoot(FS.dirname(path), sweep)
      if (discovered && FS.pathIsWithin(discovered, root)) {
        roots.add(discovered)
      }
    }
    return [...roots].sort()
  }

  /** projectRootForPath returns the nearest project namespace owning `path`. */
  export function projectRootForPath(index: Index, path: string): string | undefined {
    return index.projectRoots
      .filter(root => FS.pathIsWithin(path, root))
      .toSorted((left, right) => right.length - left.length)[0]
      ?? (FS.pathIsWithin(path, index.projectRoot) ? index.projectRoot : undefined)
  }

  /** resolve resolves a Tao use path using local packages, relative paths, and the stdlib root. */
  export function resolve(
    context: Context,
    request: ResolveRequest,
  ): Resolution {
    const importPath = request.importPath
    if (!importPath) {
      return resolveBareUse(context, request)
    }
    if (isStdLibImport(importPath)) {
      // The stdlib lives in a real `@tao` package directory, so the import path maps to it
      // literally rather than having its `@` stripped.
      const packageRoot = FS.resolvePath('@tao', context.stdlibRoot)
      const targetPath = FS.resolvePath(importPath, context.stdlibRoot)
      if (!FS.pathIsWithin(targetPath, packageRoot)) {
        return invalidResolution(importPath, 'package-path-escape', { packageName: '@tao' })
      }
      return {
        importPath,
        relation: 'stdlib',
        targetPath,
        candidateMode: 'direct',
        physicalBoundaryRoot: packageRoot,
      }
    }
    if (importPath.startsWith('@')) {
      return resolveIndexedImport(importPath, context, request)
    }
    return resolveRelativePath(importPath, context, request)
  }

  function resolveUse(
    context: Context,
    useStatement: AST.UseStatement | AST.UsePackageStatement,
    fromFilePath: string,
  ): Resolution {
    return resolve(context, {
      importPath: useStatement.importPath,
      fromFilePath,
    })
  }

  function resolveBareUse(context: Context, request: ResolveRequest): Resolution {
    const sourceProjectRoot = sourceRootForPath(context, request.fromFilePath)
    if (sourceProjectRoot === undefined) {
      return invalidResolution(undefined, 'project-boundary')
    }
    const containingPackage = containingPath(request.fromFilePath, context.index)
    if (containingPackage) {
      return {
        relation: 'same-package',
        targetPath: containingPackage.path,
        candidateMode: 'recursive',
        packageName: containingPackage.name,
        reservedPackagePath: FS.resolvePath('@', context.index.projectRoot),
        excludedProjectRoots: nestedProjectRoots(context.index, sourceProjectRoot, containingPackage.path),
        physicalBoundaryRoot: containingPackage.path,
      }
    }
    return {
      relation: 'same-directory',
      reservedPackagePath: FS.resolvePath('@', context.index.projectRoot),
      targetPath: FS.dirname(request.fromFilePath),
      candidateMode: 'direct',
      physicalBoundaryRoot: sourceProjectRoot,
    }
  }

  function resolveIndexedImport(
    importPath: string,
    context: Context,
    request: ResolveRequest,
  ): Resolution {
    const packageName = nameFromImportPath(importPath)
    const sourceProjectRoot = sourceRootForPath(context, request.fromFilePath)
    if (sourceProjectRoot === undefined) {
      return invalidResolution(importPath, 'project-boundary', { packageName })
    }
    const required = context.requirementAliases.get(`${sourceProjectRoot}#${packageName}`)
    if (required) {
      const subpath = importPath === packageName ? '' : importPath.slice(packageName.length + 1)
      const targetPath = subpath
        ? FS.resolvePath(subpath, required.sourceModuleRoot)
        : required.sourceModuleRoot
      if (!FS.pathIsWithin(targetPath, required.sourceModuleRoot)) {
        return invalidResolution(importPath, 'package-path-escape', { packageName })
      }
      return {
        importPath,
        relation: 'external-publication',
        targetPath,
        candidateMode: 'direct',
        packageName,
        physicalBoundaryRoot: required.sourceModuleRoot,
        requirement: required.requirement,
      }
    }
    const packagePaths = (context.index.packages.get(packageName) ?? [])
      .filter(path => projectRootForPath(context.index, path) === sourceProjectRoot)
    if (packagePaths.length === 0) {
      return invalidResolution(importPath, 'package-not-found', { packageName })
    }
    if (packagePaths.length > 1) {
      return invalidResolution(importPath, 'duplicate-package', {
        packageName,
        duplicatePackagePaths: packagePaths,
      })
    }

    const packagePath = packagePaths[0]!
    const subpath = importPath === packageName ? '' : importPath.slice(packageName.length + 1)
    const targetPath = subpath ? FS.resolvePath(subpath, packagePath) : packagePath
    if (!FS.pathIsWithin(targetPath, packagePath)) {
      return invalidResolution(importPath, 'package-path-escape', { packageName })
    }
    if (projectRootForPath(context.index, targetPath) !== sourceProjectRoot) {
      return invalidResolution(importPath, 'project-boundary', { packageName })
    }
    const containingPackage = containingPath(request.fromFilePath, context.index)
    return {
      importPath,
      relation: containingPackage?.path === packagePath ? 'same-package' : 'same-project-package',
      targetPath,
      candidateMode: 'direct',
      packageName,
      physicalBoundaryRoot: packagePath,
    }
  }

  function nameFromImportPath(importPath: string): string {
    return importPath.split('/')[0]!
  }

  function resolveRelativePath(
    importPath: string,
    context: Context,
    request: ResolveRequest,
  ): Resolution {
    const fromDirectory = FS.dirname(request.fromFilePath)
    const targetPath = FS.resolvePath(importPath, fromDirectory)
    const sourceProjectRoot = sourceRootForPath(context, request.fromFilePath)
    if (sourceProjectRoot === undefined) {
      return invalidResolution(importPath, 'project-boundary')
    }
    if (
      FS.pathIsWithin(request.fromFilePath, context.index.projectRoot)
      && (
        !FS.pathIsWithin(targetPath, sourceProjectRoot)
        || sourceProjectRoot !== sourceRootForPath(context, targetPath)
      )
    ) {
      return invalidResolution(importPath, 'project-boundary')
    }
    const sourcePackage = containingPath(request.fromFilePath, context.index)
    const targetPackage = containingPath(targetPath, context.index)

    if (sourcePackage?.path !== targetPackage?.path) {
      if (relativeImportLeavesGeneratedPackage(sourcePackage, targetPackage, targetPath)) {
        return {
          importPath,
          relation: 'same-project-package',
          targetPath,
          candidateMode: 'direct',
          packageName: sourcePackage.name,
          physicalBoundaryRoot: sourceProjectRoot,
        }
      }
      if (sourcePackage && !targetPackage && FS.pathIsWithin(targetPath, sourceProjectRoot)) {
        return {
          importPath,
          relation: 'same-project-package',
          targetPath,
          candidateMode: 'direct',
          physicalBoundaryRoot: sourceProjectRoot,
        }
      }
      return invalidResolution(importPath, 'package-boundary')
    }

    return {
      importPath,
      relation: sourcePackage ? 'same-package' : relationForRelativeTarget(targetPath, request.fromFilePath),
      targetPath,
      candidateMode: 'direct',
      packageName: sourcePackage?.name,
      physicalBoundaryRoot: sourcePackage?.path ?? sourceProjectRoot,
    }
  }

  function relativeImportLeavesGeneratedPackage(
    sourcePackage: Indexed | undefined,
    targetPackage: Indexed | undefined,
    targetPath: string,
  ): sourcePackage is Indexed {
    return sourcePackage?.name === '@'
      && targetPackage === undefined
      && FS.pathIsWithin(targetPath, FS.dirname(sourcePackage.path))
  }

  function relationForRelativeTarget(targetPath: string, fromFilePath: string): Relation {
    if (targetPath === fromFilePath || `${targetPath}.tao` === fromFilePath) {
      return 'same-file'
    }
    return 'same-directory'
  }

  function sourceRootForPath(context: Context, path: string): string | undefined {
    return FS.pathIsWithin(path, context.stdlibRoot)
      ? context.stdlibRoot
      : projectRootForPath(context.index, path)
  }

  function invalidResolution(
    importPath: string | undefined,
    invalidReason: InvalidReason,
    opts: {
      packageName?: string
      duplicatePackagePaths?: readonly string[]
    } = {},
  ): Resolution {
    return {
      importPath,
      relation: 'invalid',
      invalidReason,
      packageName: opts.packageName,
      duplicatePackagePaths: opts.duplicatePackagePaths,
    }
  }

  function containingPath(path: string, index: Index): Indexed | undefined {
    const matches: Indexed[] = []
    const projectRoot = projectRootForPath(index, path)
    if (projectRoot === undefined) {
      return undefined
    }
    for (const [name, paths] of index.packages) {
      for (const packagePath of paths) {
        if (projectRootForPath(index, packagePath) === projectRoot && FS.pathIsWithin(path, packagePath)) {
          matches.push({ name, path: packagePath, duplicatePaths: paths })
        }
      }
    }
    return matches.sort((a, b) => b.path.length - a.path.length)[0]
  }

  /** isStdLibImport returns true when `importPath` references the Tao standard library namespace. */
  export function isStdLibImport(importPath: string): boolean {
    return importPath.startsWith('@tao/')
  }

  async function directCandidateFilePaths(resolution: Resolution): Promise<string[]> {
    const targetPath = resolution.targetPath
    if (!targetPath) {
      return []
    }
    if (await FS.isFile(targetPath)) {
      return canUseFileCandidate(resolution) && isImportableTaoSourcePath(targetPath)
          && await remainsInsidePhysicalBoundary(targetPath, resolution)
        ? [targetPath]
        : []
    }
    const fileCandidate = `${targetPath}.tao`
    if (
      canUseFileCandidate(resolution) && isImportableTaoSourcePath(fileCandidate) && await FS.isFile(fileCandidate)
      && await remainsInsidePhysicalBoundary(fileCandidate, resolution)
    ) {
      return [fileCandidate]
    }
    if (!await FS.isDirectory(targetPath) || !await remainsInsidePhysicalBoundary(targetPath, resolution)) {
      return []
    }
    const names = await FS.listDir(targetPath)
    const candidates = names
      .filter(isImportableTaoSourceName)
      .map(name => FS.resolvePath(name, targetPath))
    const allowed = await Promise.all(candidates.map(path => remainsInsidePhysicalBoundary(path, resolution)))
    return candidates.filter((_, index) => allowed[index])
  }

  /** candidateFilePaths returns Tao source paths selected by an import resolution. */
  export async function candidateFilePaths(resolution: Resolution): Promise<string[]> {
    if (resolution.relation === 'invalid' || !resolution.targetPath) {
      return []
    }
    if (resolution.candidateMode === 'recursive') {
      return await recursiveCandidateFiles(resolution)
    }
    return await directCandidateFilePaths(resolution)
  }

  async function recursiveCandidateFiles(resolution: Resolution): Promise<string[]> {
    const targetPath = resolution.targetPath
    if (!targetPath) {
      return []
    }
    if (await FS.isFile(targetPath)) {
      return isImportableTaoSourcePath(targetPath) && await remainsInsidePhysicalBoundary(targetPath, resolution)
        ? [targetPath]
        : []
    }
    const fileCandidate = `${targetPath}.tao`
    if (
      isImportableTaoSourcePath(fileCandidate) && await FS.isFile(fileCandidate)
      && await remainsInsidePhysicalBoundary(fileCandidate, resolution)
    ) {
      return [fileCandidate]
    }
    if (!await FS.isDirectory(targetPath) || !await remainsInsidePhysicalBoundary(targetPath, resolution)) {
      return []
    }
    const candidates = (await Repo.filesUnder(targetPath, {
      excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
      extensions: ['.tao'],
    }))
      .filter(isImportableTaoSourcePath)
      .filter(path => !pathCrossesPackageDirectory(targetPath, path, resolution.reservedPackagePath))
      .filter(path => !isUnderExcludedProject(path, resolution))
    const allowed = await Promise.all(candidates.map(path => remainsInsidePhysicalBoundary(path, resolution)))
    return candidates.filter((_, index) => allowed[index])
  }

  async function remainsInsidePhysicalBoundary(path: string, resolution: Resolution): Promise<boolean> {
    if (resolution.physicalBoundaryRoot === undefined) {
      return true
    }
    try {
      const [physicalPath, physicalRoot] = await Promise.all([
        FS.realPath(path),
        FS.realPath(resolution.physicalBoundaryRoot),
      ])
      return FS.pathIsWithin(physicalPath, physicalRoot)
    } catch {
      return false
    }
  }

  /**
   * targetMatches returns whether a resolution target includes a Tao file path.
   *
   * The linker asks this for every workspace file, for every use statement, for every reference it
   * resolves. The path comparison is string work and turns nearly every candidate away, so it runs
   * before the boundary guard, which is the only part that asks the file system.
   */
  export function targetMatches(context: Context, resolution: Resolution, request: TargetMatchRequest): boolean {
    if (resolution.relation === 'invalid' || !resolution.targetPath) {
      return false
    }
    if (isTestSourcePath(request.filePath)) {
      return false
    }
    const matchesTargetPath = resolution.candidateMode === 'recursive'
      ? recursiveTargetMatches(resolution, request.filePath)
      : directTargetMatches(resolution, request)
    return matchesTargetPath && remainsInsidePhysicalBoundarySync(context, request.filePath, resolution)
  }

  function remainsInsidePhysicalBoundarySync(context: Context, path: string, resolution: Resolution): boolean {
    if (resolution.physicalBoundaryRoot === undefined) {
      return true
    }
    try {
      return FS.pathIsWithin(physicalPath(context, path), physicalPath(context, resolution.physicalBoundaryRoot))
    } catch {
      return false
    }
  }

  /**
   * physicalPath resolves a path's symlinks once per workspace build. Asked afresh each time it was
   * two `realpath` calls per question: about 450,000 for a 13-file app, and 88% of an uncached
   * `tao check`. A path that does not resolve is not remembered, because an unsaved editor buffer
   * fails today and has to succeed once it is written.
   */
  function physicalPath(context: Context, path: string): string {
    let resolved = context.physicalPaths.get(path)
    if (resolved === undefined) {
      const virtual = context.sourcePaths !== undefined
        && [...context.sourcePaths].some(source => source === path || FS.pathIsWithin(source, path))
      let ancestor = path
      if (virtual) {
        while (!FS.existsSync(ancestor)) {
          ancestor = FS.dirname(ancestor)
        }
      }
      resolved = FS.resolvePath(FS.relativePath(ancestor, path), FS.realPathSync(ancestor))
      context.physicalPaths.set(path, resolved)
    }
    return resolved
  }

  function directTargetMatches(resolution: Resolution, request: TargetMatchRequest): boolean {
    const targetPath = resolution.targetPath
    if (!targetPath) {
      return false
    }
    if (request.filePath === targetPath) {
      return canUseFileCandidate(resolution) || FS.extname(targetPath) !== '.tao'
    }
    const fileCandidate = `${targetPath}.tao`
    if (canUseFileCandidate(resolution) && request.workspaceFilePaths.has(fileCandidate)) {
      return request.filePath === fileCandidate
    }
    if (request.workspaceFilePaths.has(targetPath)) {
      return false
    }
    return FS.dirname(request.filePath) === targetPath
  }

  function canUseFileCandidate(resolution: Resolution): boolean {
    return !resolution.importPath?.startsWith('@')
  }

  /** declarationIsImportableFromUse applies visibility without resolving aliases during linking. */
  export function declarationIsImportableFromUse(
    declaration: AST.Declaration,
    resolution: Resolution,
  ): boolean {
    // Scope construction must not resolve an alias initializer: doing so can re-enter the linker
    // while the imported file's constructor and patch scopes are still being built. Primitive-head
    // app declarations carry their app family syntactically; inferred aliases use ordinary Tao
    // visibility (for example `project let App = app { ... }`).
    if (AST.isAppDeclaration(declaration)) {
      // An unmarked app keeps its historical directory reach, so sibling scenario and test sidecars
      // still find it without an import. An explicit marker is read literally -- `file app Name` has
      // to mean file-only -- which `visibilityOf` cannot say, because it maps 'file' onto undefined.
      if (declaration.visibility === undefined) {
        return resolution.relation === 'same-file' || resolution.relation === 'same-directory'
      }
      return isVisible(declaration.visibility, resolution)
    }
    return isVisible(visibilityOf(declaration), resolution)
  }

  /** isTestSourcePath returns whether a path names a Tao sidecar test file. */
  export function isTestSourcePath(filePath: string): boolean {
    return AST.isTestSidecarPath(filePath)
  }

  /** isScenariosSourcePath returns whether a path names a Tao scenarios sidecar file. */
  export function isScenariosSourcePath(filePath: string): boolean {
    return FS.basename(filePath).endsWith('.scenarios.tao')
  }

  /** isSidecarSourcePath returns whether a path names a test or scenarios companion file. */
  export function isSidecarSourcePath(filePath: string): boolean {
    return isTestSourcePath(filePath) || isScenariosSourcePath(filePath)
  }

  function isImportableTaoSourceName(name: string): boolean {
    return FS.extname(name) === '.tao' && !isTestSourcePath(name)
  }

  function isImportableTaoSourcePath(filePath: string): boolean {
    return FS.extname(filePath) === '.tao' && !isTestSourcePath(filePath)
      && !filePath.split('/').some(segment =>
        segment.startsWith('_gen_tao-') || segment === '.tao-ts'
        || TaoFiles.discoveryExcludeDirectoryNames.some(excluded => excluded === segment)
      )
  }

  function recursiveTargetMatches(resolution: Resolution, filePath: string): boolean {
    const targetPath = resolution.targetPath
    if (!targetPath) {
      return false
    }
    if (filePath === targetPath || filePath === `${targetPath}.tao`) {
      return true
    }
    if (
      FS.extname(filePath) !== '.tao'
      || !FS.pathIsWithin(filePath, targetPath)
      || isUnderExcludedProject(filePath, resolution)
    ) {
      return false
    }
    const relativeDirectory = FS.dirname(FS.relativePath(targetPath, filePath))
    if (relativeDirectory === '.') {
      return true
    }
    let directory = targetPath
    return relativeDirectory.split('/').every(segment => {
      directory = FS.resolvePath(segment, directory)
      return segment.length > 0 && !isPackageDirectory(segment, directory, resolution.reservedPackagePath)
    })
  }

  function nestedProjectRoots(index: Index, projectRoot: string, targetPath: string): string[] {
    return index.projectRoots.filter(root => root !== projectRoot && FS.pathIsWithin(root, targetPath))
  }

  function isUnderExcludedProject(path: string, resolution: Resolution): boolean {
    return resolution.excludedProjectRoots?.some(root => FS.pathIsWithin(path, root)) ?? false
  }

  function pathCrossesPackageDirectory(
    rootPath: string,
    filePath: string,
    reservedPackagePath: string | undefined,
  ): boolean {
    const relativeDirectory = FS.dirname(FS.relativePath(rootPath, filePath))
    if (relativeDirectory === '.') {
      return false
    }
    let directory = rootPath
    return relativeDirectory.split('/').some(segment => {
      directory = FS.resolvePath(segment, directory)
      return isPackageDirectory(segment, directory, reservedPackagePath)
    })
  }

  function isPackageDirectory(name: string, path: string, reservedPackagePath: string | undefined): boolean {
    return name.startsWith('@') && (name.length > 1 || path === reservedPackagePath)
  }

  /** isVisible returns whether a declaration visibility is accessible through a resolved relation. */
  export function isVisible(
    visibility: AST.DeclarationVisibility | undefined,
    resolution: Resolution,
  ): boolean {
    if (resolution.relation === 'same-file') {
      return true
    }
    if (visibility === undefined || visibility === 'file' || resolution.relation === 'invalid') {
      return false
    }
    // A `folder` declaration is visible to its siblings, which reach it without a `use` statement.
    if (visibility === 'folder') {
      return resolution.relation === 'same-directory'
    }
    if (visibility === 'package') {
      // A file outside any `@package` directory still has a package: its own folder. Without this
      // the marker is unusable in an ordinary app directory, where every sibling import resolves
      // as `same-directory` rather than `same-package`.
      return resolution.relation === 'same-package' || resolution.relation === 'same-directory'
    }
    if (visibility === 'project') {
      return resolution.relation === 'same-directory'
        || resolution.relation === 'same-package'
        || resolution.relation === 'same-project-package'
    }
    if (resolution.relation === 'external-publication') {
      return visibility === 'public'
    }
    return true
  }

  /** visibilityOf returns the optional visibility marker on a declaration. */
  export function visibilityOf(declaration: AST.Declaration): AST.DeclarationVisibility | undefined {
    const visibility = 'visibility' in declaration ? declaration.visibility : undefined
    // Direct apps predate visibility markers and have always been importable by companion files in
    // their folder. Preserve that source compatibility while letting an explicit `file app` opt out.
    if (AST.isAppDeclaration(declaration) && visibility === undefined) {
      return 'folder'
    }
    return visibility === 'file' ? undefined : visibility
  }

  function workspaceFilePath(file: AST.TaoFile): string {
    return AST.getDocument(file).uri.path
  }
}

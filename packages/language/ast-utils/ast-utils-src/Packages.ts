import { AST, type PackageResolver, Parser } from '@parser'
import { FS, Repo, TaoFiles } from '@shared'
import { Stdlib } from '@stdlib'

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
    projectRoots: readonly string[]
    packages: ReadonlyMap<string, readonly string[]>
  }

  /** Context declares shared lookup state for Tao imports. */
  export type Context = {
    index: Index
    stdlibRoot: string
    /**
     * Symlink-resolved paths the current workspace build has already asked the file system about.
     * Document lifecycle events clear candidate paths before linking can reuse them, while stable
     * paths remain shared across every reference resolved within one build.
     */
    physicalPaths: Map<string, string>
  }

  /** ContextOptions configures package roots shared by one parser or workspace lifetime. */
  export type ContextOptions = {
    stdlibRoot?: string
  }

  export type Relation =
    | 'same-file'
    | 'same-directory'
    | 'same-package'
    | 'same-project-package'
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
        const stdlibProject = FS.resolvePath('Project.tao', context.stdlibRoot)
        const project = await ancestorProjectFile(context.index.projectRoot)
        return await Promise.all(
          [project, stdlibProject, prelude].map(async path => path && await FS.isFile(path) ? path : undefined),
        )
          .then(paths => paths.filter((path): path is string => path !== undefined))
      },
      collectTargetDeclarations(useStatement, request) {
        const resolution = resolveUse(context, useStatement, request.fromFilePath)
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
        )
      },
      async candidateFilePaths(useStatement, request) {
        return await candidateFilePaths(resolveUse(context, useStatement, request.fromFilePath))
      },
      projectSourceFiles(request) {
        const projectRoot = projectRootForPath(context.index, request.fromFilePath)
        return request.workspaceFiles.filter(file => {
          const path = workspaceFilePath(file)
          return !isTestSourcePath(path) && projectRootForPath(context.index, path) === projectRoot
        })
      },
    }
    return resolver
  }

  async function ancestorProjectFile(root: string): Promise<string | undefined> {
    let current = root
    let previous = ''
    while (current !== previous) {
      const project = FS.resolvePath('Project.tao', current)
      if (await FS.isFile(project)) {
        return project
      }
      if (await FS.exists(FS.resolvePath('.git', current))) {
        return undefined
      }
      previous = current
      current = FS.dirname(current)
    }
    return undefined
  }

  /** createContext creates shared package lookup state for one project root. */
  export async function createContext(projectRoot: string, options: ContextOptions = {}): Promise<Context> {
    const resolvedProjectRoot = FS.resolvePath(projectRoot)
    return {
      index: await createIndex(resolvedProjectRoot),
      stdlibRoot: FS.resolvePath(options.stdlibRoot ?? Stdlib.rootPath),
      physicalPaths: new Map(),
    }
  }

  /** createIndex scans one project root for project-local Tao package directories. */
  export async function createIndex(projectRoot: string): Promise<Index> {
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
        if (containsTaoSource(listing, scannedPath)) {
          record(path)
        }
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
   * Deciding whether a directory declares a project means reading and parsing every `.tao` file in
   * it, and the walk from a file to its project root passes through the same ancestors as the walk
   * from its neighbour — `Apps/` is asked about once per file beneath it. A sweep is scoped to one
   * pass on purpose: a cached answer is only safe while nothing is adding or removing a project
   * declaration underneath it, which a long-lived language server cannot assume.
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
   * containingProjectRoot finds the nearest ancestor directory that directly declares a project.
   * Pass a `sweep` when resolving many paths at once so they share the memo.
   *
   * The climb never treats the OS temp directory itself as a project root and stops there, the same
   * way it stops at `.git`. A stray project-declaring `.tao` file left directly in the temp directory
   * by an unrelated process would otherwise make every fixture beneath it, however deeply nested,
   * resolve its workspace root to the whole temp directory — see `temporaryClimbBoundary`.
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
   * declaresProject answers from the sweep's memo, storing the pending promise rather than its
   * result so that concurrent walkers asking about one ancestor wait on a single read of it instead
   * of each starting their own.
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
    for (const name of await FS.listDir(directory).catch(() => [])) {
      const path = FS.resolvePath(name, directory)
      if (FS.extname(path) !== '.tao' || !await FS.isFile(path)) {
        continue
      }
      if (await fileDeclaresProject(path)) {
        return true
      }
    }
    return false
  }

  /**
   * fileDeclaresProject reads one file and asks its syntax alone. Whether a file declares a project
   * needs no import resolved and no reference linked, so a syntax parse on the shared context is
   * enough; a parser context of its own per question built a Langium container per question.
   */
  async function fileDeclaresProject(path: string): Promise<boolean> {
    const source = await FS.readText(path)
    return source.includes('project')
      && Parser.parseSyntax(source).ast.statements.some(AST.isProjectDeclaration)
  }

  async function discoverProjectRoots(root: string, scanRoot: string, listing: Repo.Listing): Promise<string[]> {
    const roots = new Set<string>()
    for (
      const scannedPath of listing.files({
        excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
        extensions: ['.tao'],
      })
    ) {
      const path = FS.resolvePath(FS.relativePath(scanRoot, scannedPath), root)
      if (await fileDeclaresProject(path)) {
        roots.add(FS.dirname(path))
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
      resolved = FS.realPathSync(path)
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
    // visibility (for example `workspace let App = app { ... }`).
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
    if (visibility === 'workspace') {
      return resolution.relation === 'same-directory'
        || resolution.relation === 'same-package'
        || resolution.relation === 'same-project-package'
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

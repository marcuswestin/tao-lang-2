import { AST, type PackageResolver } from '@parser'
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
    packages: ReadonlyMap<string, readonly string[]>
  }

  /** Context declares shared lookup state for Tao imports. */
  export type Context = {
    index: Index
    stdlibRoot: string
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

  /** createResolver creates a parser package resolver backed by this package context. */
  export function createResolver(context: Context): PackageResolver {
    return {
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
          targetMatches(resolution, {
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
    }
  }

  async function ancestorProjectFile(root: string): Promise<string | undefined> {
    let current = root
    let previous = ''
    while (current !== previous) {
      const project = FS.resolvePath('Project.tao', current)
      if (await FS.isFile(project)) {
        return project
      }
      if (await FS.isDirectory(FS.resolvePath('.git', current))) {
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
    }
  }

  /** createIndex scans a project root, and the directories above it, for Tao package directories. */
  export async function createIndex(projectRoot: string): Promise<Index> {
    const resolvedRoot = FS.resolvePath(projectRoot)
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
      for (const path of await Repo.directoriesUnder(resolvedRoot, { namePrefix: '@' })) {
        if (FS.basename(path) === '@' && path !== generatedPackage) {
          continue
        }
        if (await containsTaoSource(path)) {
          record(path)
        }
      }
    }
    // A workspace is often rooted below the project — at one test sidecar's own folder, say — so a
    // package declared above that root is still in scope. Without this, whether `@data` resolves
    // would depend on which file the workspace happened to be opened for.
    for (const ancestor of await ancestorPackageDirectories(resolvedRoot)) {
      if (await containsTaoSource(ancestor)) {
        record(ancestor)
      }
    }
    for (const paths of packages.values()) {
      paths.sort()
    }
    return { projectRoot: resolvedRoot, packages }
  }

  async function containsTaoSource(path: string): Promise<boolean> {
    return (await Repo.filesUnder(path, { extensions: ['.tao'] })).length > 0
  }

  async function ancestorPackageDirectories(root: string): Promise<string[]> {
    const found: string[] = []
    let current = FS.dirname(root)
    let previous = root
    while (current !== previous) {
      for (const name of await FS.listDir(current).catch(() => [])) {
        const path = FS.resolvePath(name, current)
        if (name.startsWith('@') && await FS.isDirectory(path)) {
          found.push(path)
        }
      }
      if (await FS.isDirectory(FS.resolvePath('.git', current))) {
        break
      }
      previous = current
      current = FS.dirname(current)
    }
    return found
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
      return {
        importPath,
        relation: 'stdlib',
        targetPath: FS.resolvePath(importPath, context.stdlibRoot),
        candidateMode: 'direct',
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
    const containingPackage = containingPath(request.fromFilePath, context.index)
    if (containingPackage) {
      return {
        relation: 'same-package',
        targetPath: containingPackage.path,
        candidateMode: 'recursive',
        packageName: containingPackage.name,
        reservedPackagePath: FS.resolvePath('@', context.index.projectRoot),
      }
    }
    return {
      relation: 'same-directory',
      reservedPackagePath: FS.resolvePath('@', context.index.projectRoot),
      targetPath: FS.dirname(request.fromFilePath),
      candidateMode: 'direct',
    }
  }

  function resolveIndexedImport(
    importPath: string,
    context: Context,
    request: ResolveRequest,
  ): Resolution {
    const packageName = nameFromImportPath(importPath)
    const packagePaths = context.index.packages.get(packageName) ?? []
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
    const containingPackage = containingPath(request.fromFilePath, context.index)
    return {
      importPath,
      relation: containingPackage?.path === packagePath ? 'same-package' : 'same-project-package',
      targetPath,
      candidateMode: 'direct',
      packageName,
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
    for (const [name, paths] of index.packages) {
      for (const packagePath of paths) {
        if (FS.pathIsWithin(path, packagePath)) {
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
      return canUseFileCandidate(resolution) && isImportableTaoSourcePath(targetPath) ? [targetPath] : []
    }
    const fileCandidate = `${targetPath}.tao`
    if (canUseFileCandidate(resolution) && isImportableTaoSourcePath(fileCandidate) && await FS.isFile(fileCandidate)) {
      return [fileCandidate]
    }
    if (!await FS.isDirectory(targetPath)) {
      return []
    }
    const names = await FS.listDir(targetPath)
    return names
      .filter(isImportableTaoSourceName)
      .map(name => FS.resolvePath(name, targetPath))
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
      return isImportableTaoSourcePath(targetPath) ? [targetPath] : []
    }
    const fileCandidate = `${targetPath}.tao`
    if (isImportableTaoSourcePath(fileCandidate) && await FS.isFile(fileCandidate)) {
      return [fileCandidate]
    }
    if (!await FS.isDirectory(targetPath)) {
      return []
    }
    return (await Repo.filesUnder(targetPath, {
      excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
      extensions: ['.tao'],
    }))
      .filter(isImportableTaoSourcePath)
      .filter(path => !pathCrossesPackageDirectory(targetPath, path, resolution.reservedPackagePath))
  }

  /** targetMatches returns whether a resolution target includes a Tao file path. */
  export function targetMatches(resolution: Resolution, request: TargetMatchRequest): boolean {
    if (resolution.relation === 'invalid' || !resolution.targetPath) {
      return false
    }
    if (isTestSourcePath(request.filePath)) {
      return false
    }
    if (resolution.candidateMode === 'recursive') {
      return recursiveTargetMatches(resolution, request.filePath)
    }
    return directTargetMatches(resolution, request)
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
    return FS.basename(filePath).endsWith('.test.tao')
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
    if (FS.extname(filePath) !== '.tao' || !FS.pathIsWithin(filePath, targetPath)) {
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
    return visibility === 'file' ? undefined : visibility
  }

  function workspaceFilePath(file: AST.TaoFile): string {
    return AST.getDocument(file).uri.path
  }
}

import { AST, type PackageResolver } from '@parser'
import { FS } from '@shared'

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
            .filter(declaration => isDeclarationImportableFromUse(declaration, resolution, request.fromFilePath))
        )
      },
      async candidateFilePaths(useStatement, request) {
        return await candidateFilePaths(resolveUse(context, useStatement, request.fromFilePath))
      },
    }
  }

  const TAO_DIRECTORY_IGNORE_NAMES = new Set([
    'node_modules',
    '.git',
    '.artifacts',
    '.direnv',
    '.devenv',
    '.expo',
    'ios',
    'android',
    'pods',
  ])

  /** createContext creates shared package lookup state for one project root. */
  export async function createContext(projectRoot: string): Promise<Context> {
    const resolvedProjectRoot = FS.resolvePath(projectRoot)
    return {
      index: await createIndex(resolvedProjectRoot),
    }
  }

  /** createIndex scans a project root for local Tao package directories. */
  export async function createIndex(projectRoot: string): Promise<Index> {
    const resolvedRoot = FS.resolvePath(projectRoot)
    const packages = new Map<string, string[]>()
    if (await FS.isDirectory(resolvedRoot)) {
      await collectDirectories(resolvedRoot, packages)
    }
    for (const paths of packages.values()) {
      paths.sort()
    }
    return { projectRoot: resolvedRoot, packages }
  }

  /** shouldSkipTaoDirectory returns whether Tao source discovery should ignore a directory name. */
  export function shouldSkipTaoDirectory(name: string): boolean {
    return name.startsWith('.')
      || TAO_DIRECTORY_IGNORE_NAMES.has(name.toLowerCase())
  }

  async function collectDirectories(directoryPath: string, packages: Map<string, string[]>): Promise<void> {
    for (const name of await FS.listDir(directoryPath)) {
      if (shouldSkipScanDirectory(name)) {
        continue
      }
      const path = FS.resolvePath(name, { cwd: directoryPath })
      if (!await FS.isDirectory(path)) {
        continue
      }
      if (isDirectoryName(name)) {
        const paths = packages.get(name) ?? []
        paths.push(path)
        packages.set(name, paths)
      }
      await collectDirectories(path, packages)
    }
  }

  function shouldSkipScanDirectory(name: string): boolean {
    return shouldSkipTaoDirectory(name)
  }

  function isDirectoryName(name: string): boolean {
    return name.startsWith('@') && name.length > 1
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
      return {
        importPath,
        relation: 'stdlib',
        targetPath: FS.resolvePath(importPath.slice(1), { cwd: defaultStdLibRoot() }),
        candidateMode: 'direct',
      }
    }
    if (importPath.startsWith('@')) {
      return resolveIndexedImport(importPath, context, request)
    }
    return resolveRelativePath(importPath, context, request)
  }

  function resolveUse(context: Context, useStatement: AST.UseStatement, fromFilePath: string): Resolution {
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
      }
    }
    return {
      relation: 'same-directory',
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
    const targetPath = subpath ? FS.resolvePath(subpath, { cwd: packagePath }) : packagePath
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
    const targetPath = FS.resolvePath(importPath, { cwd: fromDirectory })
    const sourcePackage = containingPath(request.fromFilePath, context.index)
    const targetPackage = containingPath(targetPath, context.index)

    if (sourcePackage?.path !== targetPackage?.path) {
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
        if (pathIsWithin(path, packagePath)) {
          matches.push({ name, path: packagePath, duplicatePaths: paths })
        }
      }
    }
    return matches.sort((a, b) => b.path.length - a.path.length)[0]
  }

  function pathIsWithin(path: string, directoryPath: string): boolean {
    const relative = FS.relativePath(directoryPath, path)
    return relative === '' || (!relative.startsWith('..') && relative !== '..')
  }

  /** isStdLibImport returns true when `importPath` references the Tao standard library namespace. */
  export function isStdLibImport(importPath: string): boolean {
    return importPath.startsWith('@tao/')
  }

  function defaultStdLibRoot(): string {
    return FS.repoPath('packages/runtime/tao-stdlib')
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
      .map(name => FS.resolvePath(name, { cwd: targetPath }))
  }

  /** candidateFilePaths returns Tao source paths selected by an import resolution. */
  export async function candidateFilePaths(resolution: Resolution): Promise<string[]> {
    if (resolution.relation === 'invalid' || !resolution.targetPath) {
      return []
    }
    if (resolution.candidateMode === 'recursive') {
      return await recursiveCandidateFiles(resolution.targetPath)
    }
    return await directCandidateFilePaths(resolution)
  }

  async function recursiveCandidateFiles(targetPath: string): Promise<string[]> {
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
    const files: string[] = []
    await collectTaoFiles(targetPath, targetPath, files)
    return files.sort()
  }

  async function collectTaoFiles(rootPath: string, directoryPath: string, files: string[]): Promise<void> {
    for (const name of await FS.listDir(directoryPath)) {
      if (shouldSkipScanDirectory(name) || isDirectoryName(name)) {
        continue
      }
      const path = FS.resolvePath(name, { cwd: directoryPath })
      if (await FS.isDirectory(path)) {
        await collectTaoFiles(rootPath, path, files)
        continue
      }
      if (isImportableTaoSourceName(name)) {
        files.push(path)
      }
    }
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
      return recursiveTargetMatches(resolution.targetPath, request.filePath)
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

  function isDeclarationImportableFromUse(
    declaration: AST.Declaration,
    resolution: Resolution,
    fromFilePath: string,
  ): boolean {
    if (AST.isAppDeclaration(declaration)) {
      return isTestSourcePath(fromFilePath)
        && (resolution.relation === 'same-file' || resolution.relation === 'same-directory')
    }
    return isVisible(visibilityOf(declaration), resolution)
  }

  /** isTestSourcePath returns whether a path names a Tao sidecar test file. */
  export function isTestSourcePath(filePath: string): boolean {
    return FS.basename(filePath).endsWith('.test.tao')
  }

  function isImportableTaoSourceName(name: string): boolean {
    return FS.extname(name) === '.tao' && !isTestSourcePath(name)
  }

  function isImportableTaoSourcePath(filePath: string): boolean {
    return FS.extname(filePath) === '.tao' && !isTestSourcePath(filePath)
  }

  function recursiveTargetMatches(targetPath: string, filePath: string): boolean {
    if (filePath === targetPath || filePath === `${targetPath}.tao`) {
      return true
    }
    if (FS.extname(filePath) !== '.tao' || !pathIsWithin(filePath, targetPath)) {
      return false
    }
    const relativeDirectory = FS.dirname(FS.relativePath(targetPath, filePath))
    if (relativeDirectory === '.') {
      return true
    }
    return relativeDirectory.split('/').every(segment =>
      segment.length > 0 && !shouldSkipScanDirectory(segment) && !isDirectoryName(segment)
    )
  }

  /** isVisible returns whether a declaration visibility is accessible through a resolved relation. */
  export function isVisible(
    visibility: AST.DeclarationVisibility | undefined,
    resolution: Resolution,
  ): boolean {
    if (resolution.relation === 'same-file') {
      return true
    }
    if (visibility === undefined || resolution.relation === 'invalid') {
      return false
    }
    if (visibility === 'package') {
      return resolution.relation === 'same-package'
    }
    if (visibility === 'project') {
      return resolution.relation === 'same-directory'
        || resolution.relation === 'same-package'
        || resolution.relation === 'same-project-package'
    }
    return true
  }

  /** visibilityOf returns the optional visibility marker on a declaration. */
  export function visibilityOf(declaration: AST.Declaration): AST.DeclarationVisibility | undefined {
    return 'visibility' in declaration ? declaration.visibility : undefined
  }

  function workspaceFilePath(file: AST.TaoFile): string {
    return AST.getDocument(file).uri.path
  }
}

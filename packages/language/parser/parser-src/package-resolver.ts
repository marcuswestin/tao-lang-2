import * as AST from './parserASTExport'

type PackageDeclarationResolveRequest = {
  fromFilePath: string
  workspaceFiles: readonly AST.TaoFile[]
}

/** A published module keeps its source and publication identity through any local alias. */
export type ModuleOrigin = {
  projectRoot: string
  packageName?: string
  packageVersion?: string
  modulePath: string
}

/** One project-local name bound to a module from a selected publication. */
export type ProjectModuleBinding = {
  localName: string
  origin: ModuleOrigin
  sourceRoot: string
  requirement: AST.PackageRequires
}

/** A publication exposes public declarations only from explicitly included modules. */
export type ProjectPublication = {
  declaration: AST.PackageDeclaration
  name?: string
  version?: string
  includedModuleRoots: readonly string[]
  publicDeclarations: readonly AST.Declaration[]
  /** Requirements written in this publication, resolved independently of overlapping module roots. */
  requirements: readonly ProjectRequirement[]
  /** Public declarations and the private declarations they reach within this project. */
  sourceDeclarations: readonly AST.Declaration[]
  /** Unique files containing sourceDeclarations; consumers must select declarations within them. */
  sourceFiles: readonly AST.TaoFile[]
}

/** A requirement records its own origin and the publication selected by name and version. */
export type ProjectRequirement = {
  declaration: AST.PackageRequires
  sourceRoot: string
  targetProjectRoot?: string
  requestedName?: string
  versionRange: string
  selectedPublication?: ProjectPublication
  bindings: readonly ProjectModuleBinding[]
}

/** An app's effective requirements include those inherited through with. */
export type ProjectAppRequirements = {
  app: AST.AppValueDeclaration
  requirements: readonly ProjectRequirement[]
  /** The app and own-project declarations reached through its linked Tao references. */
  sourceDeclarations: readonly AST.Declaration[]
  /** Unique files containing sourceDeclarations; scan declarations, not whole files, for sidecars. */
  sourceFiles: readonly AST.TaoFile[]
}

/** Shared project graph for validation, compiler selection, and language tooling. */
export type ProjectGraph = {
  projectRoot: string
  projectFiles: readonly AST.TaoFile[]
  publications: readonly ProjectPublication[]
  requirements: readonly ProjectRequirement[]
  appRequirements: readonly ProjectAppRequirements[]
}

/** PackageFileResolveRequest declares import lookup state for reachable files. */
type PackageFileResolveRequest = {
  fromFilePath: string
}

/** ImportingStatement is any statement that names an import path to resolve against packages. */
type ImportingStatement = AST.UseStatement | AST.UsePackageStatement

/** Physical observations shared only while publishing one completed build's dependency snapshots. */
export type ValidationBoundaryObservations = {
  realPath(path: string): Promise<string>
  isDirectory(path: string): Promise<boolean>
}

/** Share exact operation/path observations, including failures, until this publication is discarded. */
export function createValidationBoundaryObservations(
  operations: ValidationBoundaryObservations,
): ValidationBoundaryObservations {
  const realPaths = new Map<string, Promise<string>>()
  const directories = new Map<string, Promise<boolean>>()
  const observe = <T>(cache: Map<string, Promise<T>>, path: string, operation: () => Promise<T>): Promise<T> => {
    let pending = cache.get(path)
    if (!pending) {
      pending = Promise.resolve().then(operation)
      cache.set(path, pending)
    }
    return pending
  }
  return {
    realPath: path => observe(realPaths, path, () => operations.realPath(path)),
    isDirectory: path => observe(directories, path, () => operations.isDirectory(path)),
  }
}

/** PackageResolver resolves declarations and files reachable through Tao use statements. */
export type PackageResolver = {
  intrinsicFilePaths(): Promise<readonly string[]>
  /** Current resolver ownership and physical boundaries; unavailable metadata cannot authorize reuse. */
  validationBoundary(
    fromFilePath: string,
    observations?: ValidationBoundaryObservations,
  ): Promise<string | undefined>
  projectRootFilePaths(
    fromFilePath: string,
    options?: { clearRequirementAliases?: boolean },
  ): Promise<readonly string[]>
  requirementFilePaths(requirement: AST.PackageRequires, fromFilePath: string): Promise<readonly string[]>
  collectTargetDeclarations(
    useStatement: ImportingStatement,
    request: PackageDeclarationResolveRequest,
  ): readonly AST.Declaration[]
  candidateFilePaths(
    useStatement: ImportingStatement,
    request: PackageFileResolveRequest,
  ): Promise<readonly string[]>
  /**
   * projectSourceFiles keeps the workspace files that belong to the project `fromFilePath` belongs
   * to, test sidecars excluded. Project visibility names things by project membership rather than
   * by import, and a test sidecar is loaded only when it is the file being checked, so counting one
   * would make the answer depend on which file a command was pointed at.
   */
  projectSourceFiles(request: PackageDeclarationResolveRequest): readonly AST.TaoFile[]
  projectGraph(request: PackageDeclarationResolveRequest): ProjectGraph
}

/**
 * emptyPackageResolver resolves no package declarations or files for standalone parser contexts. It
 * knows of no projects either, so everything such a context holds counts as one.
 */
export const emptyPackageResolver: PackageResolver = {
  intrinsicFilePaths: async () => [],
  validationBoundary: async () => 'standalone',
  projectRootFilePaths: async () => [],
  requirementFilePaths: async () => [],
  collectTargetDeclarations: () => [],
  candidateFilePaths: async () => [],
  projectSourceFiles: request => request.workspaceFiles,
  projectGraph: request => ({
    projectRoot: request.fromFilePath.slice(0, request.fromFilePath.lastIndexOf('/')),
    projectFiles: request.workspaceFiles,
    publications: [],
    requirements: [],
    appRequirements: [],
  }),
}

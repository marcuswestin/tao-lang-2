import * as AST from './parserASTExport'

type PackageDeclarationResolveRequest = {
  fromFilePath: string
  workspaceFiles: readonly AST.TaoFile[]
}

/** PackageFileResolveRequest declares import lookup state for reachable files. */
type PackageFileResolveRequest = {
  fromFilePath: string
}

/** ImportingStatement is any statement that names an import path to resolve against packages. */
type ImportingStatement = AST.UseStatement | AST.UsePackageStatement

/** PackageResolver resolves declarations and files reachable through Tao use statements. */
export type PackageResolver = {
  intrinsicFilePaths(): Promise<readonly string[]>
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
   * to, test sidecars excluded. A project declaration names things by project membership rather than
   * by import, and a test sidecar is loaded only when it is the file being checked, so counting one
   * would make the answer depend on which file a command was pointed at.
   */
  projectSourceFiles(request: PackageDeclarationResolveRequest): readonly AST.TaoFile[]
}

/**
 * emptyPackageResolver resolves no package declarations or files for standalone parser contexts. It
 * knows of no projects either, so everything such a context holds counts as one.
 */
export const emptyPackageResolver: PackageResolver = {
  intrinsicFilePaths: async () => [],
  collectTargetDeclarations: () => [],
  candidateFilePaths: async () => [],
  projectSourceFiles: request => request.workspaceFiles,
}

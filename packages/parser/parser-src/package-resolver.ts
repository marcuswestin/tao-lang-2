import * as AST from './parserASTExport'

export type PackageDeclarationResolveRequest = {
  fromFilePath: string
  workspaceFiles: readonly AST.TaoFile[]
}

/** PackageFileResolveRequest declares import lookup state for reachable files. */
export type PackageFileResolveRequest = {
  fromFilePath: string
}

/** PackageResolver resolves declarations and files reachable through Tao use statements. */
export type PackageResolver = {
  intrinsicFilePaths(): Promise<readonly string[]>
  collectTargetDeclarations(
    useStatement: AST.UseStatement,
    request: PackageDeclarationResolveRequest,
  ): readonly AST.Declaration[]
  candidateFilePaths(
    useStatement: AST.UseStatement,
    request: PackageFileResolveRequest,
  ): Promise<readonly string[]>
}

/** emptyPackageResolver resolves no package declarations or files for standalone parser contexts. */
export const emptyPackageResolver: PackageResolver = {
  intrinsicFilePaths: async () => [],
  collectTargetDeclarations: () => [],
  candidateFilePaths: async () => [],
}

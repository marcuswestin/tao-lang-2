import { FS } from '@shared'
import { Langium } from './langium-exports'
import * as AST from './parserASTExport'

/** ModuleResolution declares resolved module lookup metadata for a use statement. */
export type ModuleResolution = {
  modulePath: string
  targetPath: string
  sameModule: boolean
}

/** resolveModulePath resolves a Tao module path from a file path and optional stdlib root. */
export function resolveModulePath(
  modulePath: string,
  fromFilePath: string,
  stdLibRoot?: string,
): ModuleResolution | undefined {
  if (isTaoModuleImport(modulePath)) {
    if (!stdLibRoot) {
      return undefined
    }
    return {
      modulePath,
      targetPath: FS.resolvePath(modulePath.slice(1), { cwd: stdLibRoot }),
      sameModule: false,
    }
  }
  // Non-stdlib package imports are not supported until Tao packages land.
  if (modulePath.startsWith('@')) {
    return undefined
  }

  const fromDirectory = FS.dirname(fromFilePath)
  const targetPath = FS.resolvePath(modulePath, { cwd: fromDirectory })
  return {
    modulePath,
    targetPath,
    sameModule: targetPath === fromDirectory,
  }
}

/** isTaoModuleImport returns true when `modulePath` references the Tao standard library namespace. */
export function isTaoModuleImport(modulePath: string): boolean {
  return modulePath.startsWith('@tao/')
}

/** defaultStdLibRoot returns the repo-local Tao standard library root. */
export function defaultStdLibRoot(): string {
  return FS.repoPath('packages/runtime/tao-stdlib')
}

/** moduleCandidates returns the Tao files a resolved module target path refers to. */
export async function moduleCandidates(targetPath: string): Promise<string[]> {
  if (await FS.isFile(targetPath)) {
    return FS.extname(targetPath) === '.tao' ? [targetPath] : []
  }
  const fileCandidate = `${targetPath}.tao`
  if (await FS.isFile(fileCandidate)) {
    return [fileCandidate]
  }
  if (!await FS.isDirectory(targetPath)) {
    return []
  }
  const names = await FS.listDir(targetPath)
  return names
    .filter(name => FS.extname(name) === '.tao')
    .map(name => FS.resolvePath(name, { cwd: targetPath }))
}

/** loadEntryAndReachableDocuments loads the entry Tao document and all documents reachable through use statements. */
export async function loadEntryAndReachableDocuments(
  services: { shared: Langium.LangiumSharedCoreServices },
  entryPath: string,
): Promise<AST.Document[]> {
  const documents = new Map<string, AST.Document>()
  const queue: string[] = [entryPath]
  const stdLibRoot = defaultStdLibRoot()

  while (queue.length > 0) {
    const currentPath = queue.shift()!
    if (documents.has(currentPath)) {
      continue
    }
    const document = await services.shared.workspace.LangiumDocumentFactory.fromUri<AST.TaoFile>(
      Langium.URI.file(currentPath),
    )
    documents.set(currentPath, document)
    const useStatements = document.parseResult.value.statements.filter(AST.isUseStatement)
    for (const useStatement of useStatements) {
      const resolution = resolveModulePath(useStatement.modulePath, currentPath, stdLibRoot)
      if (!resolution) {
        continue
      }
      for (const candidatePath of await moduleCandidates(resolution.targetPath)) {
        if (!documents.has(candidatePath)) {
          queue.push(candidatePath)
        }
      }
    }
  }

  return [...documents.values()]
}

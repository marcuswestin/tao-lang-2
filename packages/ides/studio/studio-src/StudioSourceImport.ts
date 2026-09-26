import { Packages } from '@ast-utils'
import { Assert, FS } from '@shared'

/** Selects an existing project import without crossing package or physical boundaries. */
export function studioSourceImport(context: Packages.Context, from: string, to: string): string {
  const packages = [...context.index.packages].flatMap(([name, paths]) => paths.map(path => ({ name, path })))
    .filter(candidate => FS.pathIsWithin(to, candidate.path)).sort((a, b) => b.path.length - a.path.length)
  const targetPackage = packages[0]
  const relative = FS.relativePath(FS.dirname(from), to)
  const path = targetPackage === undefined
    ? (relative.startsWith('.') ? relative : `./${relative}`)
    : [targetPackage.name, FS.relativePath(targetPackage.path, FS.dirname(to))].filter(Boolean).join('/')
  const resolution = Packages.resolve(context, { fromFilePath: from, importPath: path })
  Assert.input(
    Packages.targetMatches(context, resolution, { filePath: to, workspaceFilePaths: new Set([to]) }),
    `Studio source cannot be imported from this sketch: ${path}`,
  )
  return path
}

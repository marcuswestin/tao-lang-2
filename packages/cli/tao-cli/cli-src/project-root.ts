import { AST, Langium, Parser } from '@parser'
import { Errors, FS, Repo } from '@shared'

export type TaoProjectSource = {
  path: string
  project: AST.ProjectDeclaration
  root: string
}

/** Find the nearest project declaration above a Tao file or directory. */
export async function findTaoProjectSource(targetPath: string): Promise<TaoProjectSource> {
  const target = FS.resolvePath(targetPath)
  if (!await FS.exists(target)) {
    Errors.throwUserInput(`No file or directory found at ${target}`)
  }
  let directory = await FS.isFile(target) ? FS.dirname(target) : target
  const parserContext = Parser.createContext()
  while (true) {
    const candidates = (await Repo.filesUnder(directory, { extensions: ['.tao'] }))
      .filter(path => FS.dirname(path) === directory && !path.endsWith('.test.tao'))
    const projectFiles: Array<{ path: string; project: AST.ProjectDeclaration }> = []
    for (const path of candidates) {
      const parsed = await Parser.parseSource(parserContext, await FS.readText(path), {
        uri: Langium.URI.file(path),
        validation: false,
      })
      for (const project of parsed.entry.ast.statements.filter(AST.isProjectDeclaration)) {
        projectFiles.push({ path, project })
      }
    }
    if (projectFiles.length > 1) {
      Errors.throwUserInput(
        `More than one Tao project declaration was found in ${directory}: ${
          projectFiles.map(item => item.path).join(', ')
        }.`,
      )
    }
    if (projectFiles.length === 1) {
      return { ...projectFiles[0]!, root: await FS.realPath(directory) }
    }
    const parent = FS.dirname(directory)
    if (parent === directory) {
      Errors.throwUserInput(`No Tao project root was found from ${target}. Add a project block or pass its directory.`)
    }
    directory = parent
  }
}

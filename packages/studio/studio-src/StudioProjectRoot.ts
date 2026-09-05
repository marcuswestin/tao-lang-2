import { AST, Langium, Parser } from '@parser'
import { Errors, FS, Repo, TaoFiles } from '@shared'

/** StudioProjectRootResolution identifies the requested folder and the project selected for its Studio session. */
export type StudioProjectRootResolution = {
  inputRoot: string
  projectRoot: string
  selectedDescendant: boolean
}

/** discoverStudioProjectRoots finds directories that directly own exactly one Tao project declaration. */
export async function discoverStudioProjectRoots(input: string): Promise<string[]> {
  const inputRoot = await requireDirectory(input)
  const declarationCounts = new Map<string, number>()
  const parserContext = Parser.createContext()
  const paths = await Repo.filesUnder(inputRoot, {
    excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
    extensions: ['.tao'],
  })

  for (const path of paths) {
    const source = await FS.readText(path)
    const parsed = await Parser.parseSource(parserContext, source, { uri: Langium.URI.file(path), validation: false })
    const count = parsed.entry.ast.statements.filter(AST.isProjectDeclaration).length
    if (count > 0) {
      const owner = await FS.realPath(FS.dirname(path))
      declarationCounts.set(owner, (declarationCounts.get(owner) ?? 0) + count)
    }
  }

  return [...declarationCounts]
    .filter(([, count]) => count === 1)
    .map(([root]) => root)
    .toSorted()
}

/** resolveStudioProjectRoot keeps a project root or selects its sole descendant project root. */
export async function resolveStudioProjectRoot(input: string): Promise<StudioProjectRootResolution> {
  const inputRoot = await requireDirectory(input)
  const candidates = await discoverStudioProjectRoots(inputRoot)
  if (candidates.includes(inputRoot)) {
    return { inputRoot, projectRoot: inputRoot, selectedDescendant: false }
  }
  if (candidates.length === 1) {
    return { inputRoot, projectRoot: candidates[0]!, selectedDescendant: true }
  }

  const listedCandidates = candidates.length === 0
    ? '  (none)'
    : candidates.map(candidate => `  ${candidate}`).join('\n')
  throw new Errors.UserInputError(
    `Studio needs one project root under ${inputRoot}.\nCandidates:\n${listedCandidates}\nPass one project root to ./dev studio.`,
  )
}

async function requireDirectory(input: string): Promise<string> {
  const resolved = FS.resolvePath(input)
  if (!await FS.isDirectory(resolved)) {
    throw new Errors.UserInputError(`Studio project folder does not exist: ${resolved}`)
  }
  return await FS.realPath(resolved)
}

import { findProjectRoot } from '@project-tooling'
import { Errors, FS, TaoFiles } from '@shared'

/** StudioProjectRootResolution identifies the requested folder and the project selected for its Studio session. */
export type StudioProjectRootResolution = {
  inputRoot: string
  projectRoot: string
  selectedDescendant: boolean
}

/** discoverStudioProjectRoots finds marker-owned projects beneath the requested folder. */
export async function discoverStudioProjectRoots(input: string): Promise<string[]> {
  const inputRoot = await requireDirectory(input)
  const roots: string[] = []
  if (await FS.isDirectory(FS.resolvePath('.tao', inputRoot))) {
    roots.push(inputRoot)
  }
  for await (
    const path of FS.walk(inputRoot, {
      includeDirectories: true,
      includeHidden: true,
      excludeDirectory: name =>
        name.startsWith('.') || TaoFiles.discoveryExcludeDirectoryNames.some(excluded => excluded === name),
    })
  ) {
    if (FS.basename(path) === '.tao' && await FS.isDirectory(path)) {
      roots.push(await FS.realPath(FS.dirname(path)))
    }
  }
  return [...new Set(roots)].toSorted()
}

/** resolveStudioProjectRoot keeps a project root or selects its sole descendant project root. */
export async function resolveStudioProjectRoot(input: string): Promise<StudioProjectRootResolution> {
  const inputRoot = await requireDirectory(input)
  const containingRoot = await findProjectRoot(inputRoot)
  if (containingRoot !== undefined && FS.pathIsWithin(inputRoot, containingRoot)) {
    return { inputRoot, projectRoot: containingRoot, selectedDescendant: false }
  }
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
  Errors.throwUserInput(
    `Studio needs one project root under ${inputRoot}.\nCandidates:\n${listedCandidates}\nPass one project root to ./dev studio.`,
  )
}

async function requireDirectory(input: string): Promise<string> {
  const resolved = FS.resolvePath(input)
  if (!await FS.isDirectory(resolved)) {
    Errors.throwUserInput(`Studio project folder does not exist: ${resolved}`)
  }
  return await FS.realPath(resolved)
}

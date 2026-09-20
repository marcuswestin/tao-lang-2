import { FS, Repo, TaoFiles } from '@shared'

/** ProjectTaoSource is one discoverable Tao source file and its current disk content. */
export type ProjectTaoSource = Readonly<{ content: string; path: string }>

/**
 * discoverProjectTaoFiles is the project-wide Tao source contract shared by Studio and the CLI.
 *
 * Repo.filesUnder asks Git for tracked and unignored files when possible, and applies Tao's standard
 * generated-platform exclusions everywhere else. Keeping that choice here prevents an advisory report from
 * grounding itself on stale ignored files that Studio cannot see.
 */
export async function discoverProjectTaoFiles(projectRoot: string): Promise<string[]> {
  return await Repo.filesUnder(projectRoot, {
    excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
    extensions: ['.tao'],
  })
}

/** readProjectTaoSources reads the discoverable project files matching a caller's narrow predicate. */
export async function readProjectTaoSources(
  projectRoot: string,
  include: (path: string) => boolean = () => true,
): Promise<ProjectTaoSource[]> {
  const paths = (await discoverProjectTaoFiles(projectRoot)).filter(include)
  return await Promise.all(paths.map(async path => ({ content: await FS.readText(path), path })))
}

import type { ParseResult } from '@parser'
import { Assert, FS } from '@shared'
import { buildSemanticSnapshot, type SemanticSnapshot } from './SemanticSnapshot'
import { Workspace } from './Workspace'

/** SemanticSnapshotRequest identifies the one project app a read-only semantic report inspects. */
export type SemanticSnapshotRequest = Readonly<{
  appName: string
  entryPath: string
  projectRoot: string
  validate?: (entryPath: string) => Promise<ParseResult>
}>

/** loadSemanticSnapshot is the one validated snapshot path shared by Studio and the Tao CLI. */
export async function loadSemanticSnapshot(request: SemanticSnapshotRequest): Promise<SemanticSnapshot> {
  const projectRoot = await resolveProjectRoot(request.projectRoot)
  const entryPath = await resolveEntryPath(projectRoot, request.entryPath)
  const validation = await (request.validate ?? validateFromDisk(projectRoot))(entryPath)
  return buildSemanticSnapshot(projectRoot, request.appName, validation.files, validation.diagnostics)
}

function validateFromDisk(projectRoot: string): (entryPath: string) => Promise<ParseResult> {
  return async entryPath => await (await Workspace.open(projectRoot)).validate(entryPath)
}

/** resolveProjectRoot preserves Studio's user-facing project-root contract. */
export async function resolveProjectRoot(input: string): Promise<string> {
  const resolved = FS.resolvePath(input)
  Assert.input(await FS.isDirectory(resolved), `Studio project folder does not exist: ${resolved}`)
  return await FS.realPath(resolved)
}

/** resolveEntryPath resolves CLI entries from their named project rather than the process cwd. */
export async function resolveEntryPath(projectRoot: string, input: string): Promise<string> {
  const resolved = FS.resolvePath(input, projectRoot)
  Assert.input(
    FS.extname(resolved) === '.tao' && await FS.isFile(resolved),
    `Studio entry is not a Tao file in the project: ${input}`,
  )
  const realPath = await FS.realPath(resolved)
  Assert.input(FS.pathIsWithin(realPath, projectRoot), `Studio entry resolves outside the project: ${input}`)
  return realPath
}

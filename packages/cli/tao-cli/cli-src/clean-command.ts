import { Errors, FS, HCI } from '@shared'
import type { BuildRecord } from './build-command'
import { discoverTaoDevProjects } from './dev-app-discovery'

type CleanCandidate = { path: string; record: BuildRecord; size: number }

/** Interactively remove only explicitly selected, local Tao build artifacts. */
export async function runTaoClean(path: string): Promise<void> {
  if (!HCI.isInteractive()) {
    Errors.throwUserInput('tao clean requires an interactive terminal; no builds were removed.')
  }
  const candidates = await listBuilds(path)
  if (candidates.length === 0) {
    HCI.writeLine('No retained local builds found.')
    return
  }
  HCI.writeLine('Retained local builds:')
  for (const [index, candidate] of candidates.entries()) {
    const statuses = candidate.record.targets.map(target =>
      `${target}:${candidate.record.results[target]?.status ?? 'unknown'}`
    ).join(', ')
    HCI.writeLine(
      `${index + 1}. ${candidate.record.appName} (${statuses}) — ${formatSize(candidate.size)} — ${
        FS.displayPath(candidate.path)
      }`,
    )
  }
  const selected = await HCI.askText({
    message: 'Select build numbers to delete (comma-separated; blank cancels)',
    validate: answer =>
      parseSelection(answer, candidates.length) === undefined ? 'Enter listed numbers separated by commas.' : undefined,
  })
  const indexes = parseSelection(selected, candidates.length)
  if (indexes === undefined || indexes.length === 0) {
    HCI.writeLine('Nothing removed.')
    return
  }
  const selectedBuilds = indexes.map(index => candidates[index]!)
  HCI.writeLine('Will remove exactly:')
  for (const candidate of selectedBuilds) {
    HCI.writeLine(`  ${candidate.path} (${formatSize(candidate.size)})`)
  }
  if (!await HCI.askConfirm({ message: 'Delete these local build artifacts?', defaultValue: true })) {
    HCI.writeLine('Nothing removed.')
    return
  }
  for (const candidate of selectedBuilds) {
    await assertBuildCandidate(candidate.path, candidate.record.projectRoot)
    await FS.remove(candidate.path)
    HCI.writeLine(`Removed ${FS.displayPath(candidate.path)}`)
  }
}

async function listBuilds(path: string): Promise<CleanCandidate[]> {
  const target = FS.resolvePath(path)
  const targetRoot = await FS.isDirectory(target) ? target : FS.dirname(target)
  const projects = await discoverTaoDevProjects(path)
  const roots = new Set([targetRoot, ...projects.map(project => project.root)])
  const candidates: CleanCandidate[] = []
  for (const root of roots) {
    const buildsRoot = FS.resolvePath('.tao/builds', root)
    if (!await FS.isDirectory(buildsRoot) || await FS.isSymbolicLink(buildsRoot)) {
      continue
    }
    for (const name of await FS.listDir(buildsRoot)) {
      if (name.startsWith('.')) {
        continue
      }
      const candidatePath = FS.resolvePath(name, buildsRoot)
      if (!await FS.isDirectory(candidatePath) || await FS.isSymbolicLink(candidatePath)) {
        continue
      }
      const recordPath = FS.resolvePath('build.json', candidatePath)
      if (!await FS.isFile(recordPath) || await FS.isSymbolicLink(recordPath)) {
        continue
      }
      const record = await FS.readJson<BuildRecord>(recordPath)
      if (record.schemaVersion !== 1 || record.id !== name || record.projectRoot !== root) {
        continue
      }
      await assertBuildCandidate(candidatePath, root)
      candidates.push({ path: candidatePath, record, size: await folderSize(candidatePath) })
    }
  }
  return candidates.toSorted((a, b) => b.record.createdAt.localeCompare(a.record.createdAt))
}

async function assertBuildCandidate(path: string, projectRoot: string): Promise<void> {
  const buildsRoot = FS.resolvePath('.tao/builds', projectRoot)
  const realRoot = await FS.realPath(buildsRoot)
  const realCandidate = await FS.realPath(path)
  if (FS.dirname(realCandidate) !== realRoot || await FS.isSymbolicLink(path)) {
    Errors.throwUserInput(`Refusing to clean a path outside the project's build directory: ${path}`)
  }
}

async function folderSize(path: string): Promise<number> {
  let bytes = 0
  for await (const entry of FS.walk(path, { includeHidden: true })) {
    if (!await FS.isSymbolicLink(entry) && await FS.isFile(entry)) {
      bytes += await FS.byteSize(entry)
    }
  }
  return bytes
}

function parseSelection(input: string, length: number): number[] | undefined {
  if (input.trim() === '') {
    return []
  }
  const parts = input.split(',').map(part => part.trim())
  if (parts.some(part => !/^[1-9]\d*$/.test(part) || Number(part) > length)) {
    return undefined
  }
  return [...new Set(parts.map(part => Number(part) - 1))]
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

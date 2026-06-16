import { CLI, FS } from '@shared'
import { DEFAULT_EFFORT } from './constants'
import { buildReviewerInvocation, extractClaudeResultText } from './invocation'
import { buildReviewPrompt } from './lenses'
import type { ReviewerManifestEntry, ReviewMeta, ReviewStatus } from './types'

type LaunchContext = {
  runDir: string
  repoRoot: string
}

/** launchReviewer runs one reviewer CLI and writes its output artifacts. */
export async function launchReviewer(entry: ReviewerManifestEntry, ctx: LaunchContext): Promise<ReviewMeta> {
  await FS.mkdir(ctx.runDir)
  const effort = entry.effort ?? DEFAULT_EFFORT
  const promptText = await resolvePromptText(entry, ctx)
  const debugFile = FS.resolvePath(`${entry.label}.debug.log`, { cwd: ctx.runDir })
  const invocation = buildReviewerInvocation({
    reviewer: entry.reviewer,
    promptText,
    effort,
    debugFile,
    model: entry.model,
    timeoutSeconds: entry.timeoutSeconds,
  })

  const startedAt = Date.now()
  const result = await CLI.run(invocation.command, {
    args: invocation.args,
    stdin: invocation.stdin,
    cwd: ctx.repoRoot,
  })
  const durationMs = Date.now() - startedAt

  const reviewPath = FS.resolvePath(`${entry.label}.md`, { cwd: ctx.runDir })
  let reviewText = result.stdout
  let rawPath: string | undefined
  if (invocation.outputFormat === 'jsonl') {
    rawPath = FS.resolvePath(`${entry.label}.jsonl`, { cwd: ctx.runDir })
    await FS.writeText(rawPath, result.stdout)
    reviewText = extractClaudeResultText(result.stdout) ?? ''
  }
  await FS.writeText(reviewPath, reviewText)
  if (result.stderr.trim().length > 0) {
    await FS.writeText(FS.resolvePath(`${entry.label}.stderr.log`, { cwd: ctx.runDir }), result.stderr)
  }

  const bytes = Buffer.byteLength(reviewText, 'utf8')
  const failed = result.error !== undefined || (result.exitCode ?? 1) !== 0
  const status: ReviewStatus = failed ? 'failed' : bytes === 0 ? 'empty' : 'ok'
  const meta: ReviewMeta = {
    label: entry.label,
    reviewer: entry.reviewer,
    effort,
    status,
    exitCode: result.exitCode,
    durationMs,
    bytes,
    reviewPath,
    command: CLI.formatCommand(invocation.command, { args: invocation.args }),
    model: entry.model,
    lens: entry.lens,
    rawPath,
  }
  await FS.writeJson(FS.resolvePath(`${entry.label}.meta.json`, { cwd: ctx.runDir }), meta)
  return meta
}

async function resolvePromptText(entry: ReviewerManifestEntry, ctx: LaunchContext): Promise<string> {
  if (entry.promptFile !== undefined) {
    return FS.readText(FS.resolvePath(entry.promptFile, { cwd: ctx.repoRoot }))
  }
  const scope = entry.scope ?? (entry.scopeFile === undefined
    ? undefined
    : await FS.readText(FS.resolvePath(entry.scopeFile, { cwd: ctx.repoRoot })))
  const promptText = buildReviewPrompt({ repoRoot: ctx.repoRoot, scope, lensKey: entry.lens })
  await FS.writeText(FS.resolvePath(`prompt-${entry.label}.md`, { cwd: ctx.runDir }), promptText)
  return promptText
}

/** readRunMetas loads reviewer metadata files from a run directory. */
export async function readRunMetas(runDir: string): Promise<ReviewMeta[]> {
  if (!await FS.isDirectory(runDir)) {
    return []
  }
  const metas: ReviewMeta[] = []
  for (const name of await FS.listDir(runDir)) {
    if (name.endsWith('.meta.json')) {
      metas.push(await FS.readJson<ReviewMeta>(FS.resolvePath(name, { cwd: runDir })))
    }
  }
  return metas.sort((left, right) => left.label.localeCompare(right.label))
}

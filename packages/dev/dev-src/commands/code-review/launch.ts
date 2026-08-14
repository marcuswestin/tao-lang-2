import { CLI, FS } from '@shared'
import { DEFAULT_AGY_TIMEOUT_SECONDS, DEFAULT_EFFORT, DEFAULT_REVIEW_TIMEOUT_SECONDS } from './constants'
import { buildReviewerInvocation, extractReviewerResultText } from './invocation'
import { buildReviewPrompt } from './lenses'
import { reviewMetricsPath } from './paths'
import { runStreamingInvocation } from './streaming'
import type { ReviewerManifestEntry, ReviewLaunchKind, ReviewMeta, ReviewStatus } from './types'

type LaunchContext = {
  runDir: string
  repoRoot: string
  kind?: ReviewLaunchKind
}

type ReviewerArtifactPaths = {
  artifactDir: string
  debugFile: string
  eventsPath: string
  finalFile: string
  reviewPath: string
  statusPath: string
  stderrPath: string
  stdoutPath: string
}

type PreparedReviewerLaunch = {
  artifacts: ReviewerArtifactPaths
  effort: ReviewMeta['effort']
  invocation: ReturnType<typeof buildReviewerInvocation>
  kind: ReviewLaunchKind
  timeoutSeconds: number
}

/** launchReviewer runs one reviewer CLI and writes its output artifacts. */
export async function launchReviewer(entry: ReviewerManifestEntry, ctx: LaunchContext): Promise<ReviewMeta> {
  await FS.mkdir(ctx.runDir)
  const prepared = await prepareReviewerLaunch(entry, ctx)
  await resetReviewerArtifacts(prepared.artifacts)
  const result = await runPreparedReviewer(entry, ctx, prepared)
  const finalText = await readFinalTextIfSuccessful(result.status, prepared.invocation.finalPath)
  const reviewText = extractReviewerResultText(entry.reviewer, result.stdout, finalText) ?? ''
  await FS.writeText(prepared.artifacts.reviewPath, reviewText)
  const meta = buildReviewMeta(entry, prepared, result, reviewText)
  await updateFinalStatus(prepared.artifacts.statusPath, meta)
  await FS.writeJson(FS.resolvePath(`${entry.label}.meta.json`, ctx.runDir), meta)
  await appendRuntimeMetric(meta, ctx)
  return meta
}

async function prepareReviewerLaunch(
  entry: ReviewerManifestEntry,
  ctx: LaunchContext,
): Promise<PreparedReviewerLaunch> {
  const effort = entry.effort ?? DEFAULT_EFFORT
  const kind = ctx.kind ?? 'review'
  const timeoutSeconds = entry.timeoutSeconds ?? defaultTimeoutSeconds(entry)
  const promptText = await resolvePromptText(entry, ctx)
  const artifactDir = FS.resolvePath(entry.label, ctx.runDir)
  const debugFile = FS.resolvePath('debug.log', artifactDir)
  const finalFile = FS.resolvePath('final.txt', artifactDir)
  const invocation = buildReviewerInvocation({
    reviewer: entry.reviewer,
    promptText,
    effort,
    debugFile,
    finalFile,
    model: entry.model,
    timeoutSeconds,
  })
  const artifacts = reviewerArtifactPaths(artifactDir, debugFile, finalFile, invocation.outputFormat)
  return { artifacts, effort, invocation, kind, timeoutSeconds }
}

function reviewerArtifactPaths(
  artifactDir: string,
  debugFile: string,
  finalFile: string,
  outputFormat: 'jsonl' | 'text',
): ReviewerArtifactPaths {
  return {
    artifactDir,
    debugFile,
    eventsPath: FS.resolvePath('events.jsonl', artifactDir),
    finalFile,
    reviewPath: FS.resolvePath('review.md', artifactDir),
    statusPath: FS.resolvePath('status.json', artifactDir),
    stderrPath: FS.resolvePath('stderr.log', artifactDir),
    stdoutPath: FS.resolvePath(outputFormat === 'jsonl' ? 'stdout.jsonl' : 'stdout.log', artifactDir),
  }
}

async function runPreparedReviewer(
  entry: ReviewerManifestEntry,
  ctx: LaunchContext,
  { artifacts, effort, invocation, timeoutSeconds }: PreparedReviewerLaunch,
) {
  return runStreamingInvocation({
    artifactDir: artifacts.artifactDir,
    args: invocation.args,
    command: invocation.command,
    cwd: ctx.repoRoot,
    effort,
    eventsPath: artifacts.eventsPath,
    label: entry.label,
    lens: entry.lens,
    model: entry.model,
    outputFormat: invocation.outputFormat,
    reviewer: entry.reviewer,
    statusPath: artifacts.statusPath,
    stderrPath: artifacts.stderrPath,
    stdin: invocation.stdin,
    stdoutPath: artifacts.stdoutPath,
    timeoutSeconds,
  })
}

function buildReviewMeta(
  entry: ReviewerManifestEntry,
  prepared: PreparedReviewerLaunch,
  result: Awaited<ReturnType<typeof runStreamingInvocation>>,
  reviewText: string,
): ReviewMeta {
  const bytes = Buffer.byteLength(reviewText, 'utf8')
  const status: ReviewStatus = result.status === 'ok' && bytes === 0 ? 'empty' : result.status
  return {
    label: entry.label,
    reviewer: entry.reviewer,
    effort: prepared.effort,
    status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    bytes,
    reviewPath: prepared.artifacts.reviewPath,
    kind: prepared.kind,
    artifactDir: prepared.artifacts.artifactDir,
    command: CLI.formatCommand(prepared.invocation.command, { args: prepared.invocation.args }),
    eventsPath: prepared.artifacts.eventsPath,
    firstOutputMs: result.firstOutputMs,
    model: entry.model,
    lens: entry.lens,
    rawPath: prepared.artifacts.stdoutPath,
    stderrPath: prepared.artifacts.stderrPath,
    statusPath: prepared.artifacts.statusPath,
    stdoutPath: prepared.artifacts.stdoutPath,
    timedOut: result.timedOut,
  }
}

async function resolvePromptText(entry: ReviewerManifestEntry, ctx: LaunchContext): Promise<string> {
  if (entry.promptFile !== undefined) {
    return FS.readText(FS.resolvePath(entry.promptFile, ctx.repoRoot))
  }
  const scope = entry.scope ?? (entry.scopeFile === undefined
    ? undefined
    : await FS.readText(FS.resolvePath(entry.scopeFile, ctx.repoRoot)))
  const promptText = buildReviewPrompt({ repoRoot: ctx.repoRoot, scope, lensKey: entry.lens })
  await FS.writeText(FS.resolvePath(`prompt-${entry.label}.md`, ctx.runDir), promptText)
  return promptText
}

async function readFinalTextIfSuccessful(
  status: ReviewStatus,
  finalPath: string | undefined,
): Promise<string | undefined> {
  if (status !== 'ok' || finalPath === undefined || !await FS.exists(finalPath)) {
    return undefined
  }
  return FS.readText(finalPath)
}

/** readRunMetas loads reviewer metadata files from a run directory. */
export async function readRunMetas(runDir: string): Promise<ReviewMeta[]> {
  if (!await FS.isDirectory(runDir)) {
    return []
  }
  const metas: ReviewMeta[] = []
  for (const name of await FS.listDir(runDir)) {
    if (name.endsWith('.meta.json')) {
      metas.push(await FS.readJson<ReviewMeta>(FS.resolvePath(name, runDir)))
    }
  }
  return metas.sort((left, right) => left.label.localeCompare(right.label))
}

async function appendRuntimeMetric(meta: ReviewMeta, ctx: LaunchContext): Promise<void> {
  const metricsPath = reviewMetricsPath(ctx.runDir, ctx.repoRoot)
  const file = await FS.openAppend(metricsPath)
  try {
    await file.write(`${
      JSON.stringify({
        artifactDir: meta.artifactDir,
        bytes: meta.bytes,
        durationMs: meta.durationMs,
        effort: meta.effort,
        firstOutputMs: meta.firstOutputMs,
        kind: meta.kind,
        label: meta.label,
        lens: meta.lens,
        model: meta.model,
        reviewer: meta.reviewer,
        status: meta.status,
        timedOut: meta.timedOut,
        ts: new Date().toISOString(),
      })
    }\n`)
  } finally {
    await file.close()
  }
}

async function updateFinalStatus(statusPath: string, meta: ReviewMeta): Promise<void> {
  const existing = await FS.exists(statusPath) ? await FS.readJson<Record<string, unknown>>(statusPath) : {}
  await FS.writeJson(statusPath, {
    ...existing,
    bytes: meta.bytes,
    kind: meta.kind,
    reviewPath: meta.reviewPath,
    status: meta.status,
    timedOut: meta.timedOut,
    updatedAt: new Date().toISOString(),
  })
}

function defaultTimeoutSeconds(entry: ReviewerManifestEntry): number {
  return entry.reviewer === 'agy' ? DEFAULT_AGY_TIMEOUT_SECONDS : DEFAULT_REVIEW_TIMEOUT_SECONDS
}

async function resetReviewerArtifacts(paths: ReviewerArtifactPaths): Promise<void> {
  await FS.mkdir(paths.artifactDir)
  await Promise.all([
    FS.remove(paths.debugFile),
    FS.remove(paths.eventsPath),
    FS.remove(paths.finalFile),
    FS.remove(paths.reviewPath),
    FS.remove(paths.statusPath),
    FS.remove(paths.stderrPath),
    FS.remove(paths.stdoutPath),
    FS.remove(FS.resolvePath('stdout.jsonl', paths.artifactDir)),
    FS.remove(FS.resolvePath('stdout.log', paths.artifactDir)),
  ])
}

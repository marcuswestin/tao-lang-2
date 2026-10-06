import { Errors, FS, Repo } from '@shared'
import { gitHub, type PrChecksDependencies, repositorySlug } from './PrChecksCommand'

/*
 * `ci-timings --import-durations` closes the loop between what hosted `Verify` measured and what the
 * next run plans with. Every partition job uploads its `summary.json` as the `verify-partition-<k>`
 * artifact, and each summary carries every node's wall time on a CI runner — the population the
 * partition plan is balancing for, which a seed estimated on a developer machine only approximates.
 * The import folds those per-node times into the committed seed, `.github/verify/durations.json`,
 * the way a local run folds its own into `.artifacts/timings/durations.json`: a new node takes the
 * measurement, a known one moves by the wall-time EMA weight, so one contended runner cannot rewrite
 * an estimate. Nodes CI did not run (the host-only complement) keep their entries.
 *
 * It is count-agnostic: it reads every `verify-partition-*` artifact the run produced and takes the
 * partition count from the summaries, so a change to the workflow's `PARTITIONS` needs no change
 * here. Artifact downloads need authentication even on a public repository, so this reads
 * `GH_TOKEN`/`GITHUB_TOKEN` or the `gh` login, where the comparison table needs neither.
 */

const API = 'https://api.github.com'
/** Mirrors `RunTimings.SEED_PATH`; the verification package is not a dependency of this CLI. */
const SEED_PATH = '.github/verify/durations.json'
/** Mirrors `RunTimings.EMA_WEIGHT_WALL`: a CI partition's time is wall time, contention included. */
const EMA_WEIGHT_WALL = 0.3
const PARTITION_ARTIFACT = /^verify-partition-(\d+)$/u

/** ImportDurationsOptions is the flags-ready input `ci-timings --import-durations` passes on. */
export type ImportDurationsOptions = {
  repositoryRoot?: string
  /** The run to import; by default, the newest green `Verify` push to `main`. */
  run?: number
}

type WorkflowRun = { head_branch: string; head_sha: string; html_url?: string; id: number; updated_at: string }
type Artifact = { archive_download_url?: string; expired: boolean; id: number; name: string }
/** The slice of a partition's `GateSummary` the import reads. */
type PartitionSummary = {
  elapsedMs: number
  gates: readonly { elapsedMs: number; name: string; status: string; suite?: string }[]
  partition?: { count: number; digest: string; index: number }
}
type NodeTiming = {
  emaMs: number
  lastMs: number
  lastRunAt: string
  lastWallMs?: number
  samples: number
  source?: 'cpu' | 'wall'
}
type TimingsStore = { nodes: Record<string, NodeTiming>; version: 1 }

/** CiDurationsImport folds a run's partition summaries into the committed duration seed. */
export const CiDurationsImport = {
  async run(
    options: ImportDurationsOptions,
    dependencies: PrChecksDependencies,
  ): Promise<{ exitCode: number; lines: string[] }> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const slug = await repositorySlug(dependencies, root)
    const token = await authToken(dependencies, root)
    const github = gitHub(dependencies, token)
    const run = options.run === undefined
      ? await newestGreenMainRun(github, slug)
      : await github.json<WorkflowRun>(`/repos/${slug}/actions/runs/${options.run}`)

    const artifacts = (await github.json<{ artifacts: Artifact[] }>(
      `/repos/${slug}/actions/runs/${run.id}/artifacts?per_page=100`,
    )).artifacts.filter(artifact => PARTITION_ARTIFACT.test(artifact.name))
    if (artifacts.length === 0) {
      return Errors.throwUserInput(
        `Run ${run.id} has no verify-partition-* artifacts; a partition uploads its summary only when it passed.`,
      )
    }
    const expired = artifacts.filter(artifact => artifact.expired)
    if (expired.length > 0) {
      return Errors.throwUserInput(`Run ${run.id}'s partition artifacts have expired; import a newer run.`)
    }

    const summaries = await Promise.all(artifacts.map(async artifact => ({
      artifact,
      summary: await downloadSummary(dependencies, token, `${API}/repos/${slug}/actions/artifacts/${artifact.id}/zip`),
    })))
    const described = describe(run, summaries)
    const lines = [...described.lines]
    const measured = measuredDurations(summaries.map(entry => entry.summary), described.complete)

    const seedPath = FS.resolvePath(SEED_PATH, root)
    const store = await readStore(seedPath)
    const folded = fold(store, measured.nodes, run.updated_at)
    await FS.writeJson(seedPath, folded.store)
    lines.push(
      `Folded ${measured.nodes.size} durations into ${SEED_PATH} (${measured.suites} suite totals summed from their shards): ${folded.added} new, ${folded.updated} updated, ${
        Object.keys(folded.store.nodes).length - measured.nodes.size
      } kept without a CI measurement.`,
    )
    for (const line of lines) {
      dependencies.writeLine(line)
    }
    return { exitCode: 0, lines }
  },
} as const

/** The artifact endpoints need a token on a public repository too; reuse the environment's or `gh`'s. */
async function authToken(dependencies: PrChecksDependencies, root: string): Promise<string> {
  const configured = dependencies.env['GH_TOKEN'] || dependencies.env['GITHUB_TOKEN']
  if (configured !== undefined && configured !== '') {
    return configured
  }
  const result = await dependencies.run('gh', { args: ['auth', 'token'], cwd: root, stdio: 'pipe' }).catch(() =>
    undefined
  )
  if (
    result === undefined || result.exitCode !== 0 || result.error !== undefined || result.signal !== null
    || result.stdout.trim() === ''
  ) {
    return Errors.throwUserInput(
      'Downloading Verify artifacts needs GitHub authentication: set GH_TOKEN, or run where `gh auth token` works.',
    )
  }
  return result.stdout.trim()
}

async function newestGreenMainRun(github: ReturnType<typeof gitHub>, slug: string): Promise<WorkflowRun> {
  const run = (await github.json<{ workflow_runs: WorkflowRun[] }>(
    `/repos/${slug}/actions/workflows/verify.yml/runs?branch=main&event=push&status=success&per_page=1`,
  )).workflow_runs[0]
  return run ?? Errors.throwUserInput('No green Verify push to main exists yet; name a run with --run <id>.')
}

async function downloadSummary(
  dependencies: PrChecksDependencies,
  token: string,
  url: string,
): Promise<PartitionSummary> {
  const response = await dependencies.fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    return Errors.throwHostEnvironment(
      `GitHub answered ${response.status} for ${url}: ${(await response.text()).slice(0, 300)}`,
    )
  }
  const entries = unzip(new Uint8Array(await response.arrayBuffer()))
  const entry = [...entries].find(([name]) => name === 'summary.json' || name.endsWith('/summary.json'))
  if (entry === undefined) {
    return Errors.throwHostEnvironment(
      `${url} holds no summary.json; found ${[...entries.keys()].join(', ') || 'nothing'}.`,
    )
  }
  const summary = JSON.parse(new TextDecoder().decode(entry[1])) as PartitionSummary
  if (!Array.isArray(summary.gates)) {
    return Errors.throwHostEnvironment(`${url}'s summary.json has no gates array.`)
  }
  return summary
}

/** describe names the run, checks the partitions agree on their plan, and prints the measured spread; `complete` says every partition of one plan reported. */
function describe(
  run: WorkflowRun,
  summaries: readonly { artifact: Artifact; summary: PartitionSummary }[],
): { complete: boolean; lines: string[] } {
  const lines = [
    `Importing run ${run.id} on ${run.head_branch} at ${run.head_sha.slice(0, 8)}, updated ${run.updated_at}.`,
  ]
  const partitions = summaries.map(({ artifact, summary }) => ({
    index: summary.partition?.index ?? Number(PARTITION_ARTIFACT.exec(artifact.name)![1]),
    nodeMs: summary.gates.filter(ran).reduce((total, gate) => total + gate.elapsedMs, 0),
    summary,
  })).sort((a, b) => a.index - b.index)
  const counts = new Set(summaries.map(({ summary }) => summary.partition?.count))
  const digests = new Set(summaries.map(({ summary }) => summary.partition?.digest))
  const count = counts.size === 1 ? [...counts][0] : undefined
  const complete = count !== undefined && count === summaries.length && digests.size === 1
  if (count === undefined) {
    lines.push(`WARN  The ${summaries.length} summaries disagree on the partition count: ${[...counts].join(', ')}.`)
  } else if (count !== summaries.length) {
    lines.push(`WARN  ${summaries.length} of ${count} partitions uploaded a summary; the others are not measured here.`)
  }
  if (digests.size > 1) {
    lines.push(`WARN  The summaries come from ${digests.size} different partition plans.`)
  }
  const sums = partitions.map(partition => partition.nodeMs)
  const least = Math.min(...sums)
  const most = Math.max(...sums)
  lines.push(
    `Measured ${summaries.length}-way spread (node time per partition): ${seconds(least)}–${seconds(most)} s, ratio ${
      least === 0 ? '∞' : (most / least).toFixed(2)
    }.`,
  )
  for (const partition of partitions) {
    lines.push(
      `  partition ${partition.index}: ${seconds(partition.nodeMs)} s of node time in ${
        seconds(partition.summary.elapsedMs)
      } s wall, ${partition.summary.gates.filter(ran).length} nodes`,
    )
  }
  return { complete, lines }
}

function ran(gate: { elapsedMs: number; status: string }): boolean {
  return gate.status !== 'skipped' && Number.isFinite(gate.elapsedMs) && gate.elapsedMs > 0
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(0)
}

/**
 * measuredDurations collects each node's wall time; a node runs in exactly one partition, so the last
 * wins. A sharded suite also gets its total, the sum of its shards: the planner never trusts a shard's
 * own history, because shard membership moves, and apportions the suite's total by ledger cost
 * instead — so the total is the number that re-balances the next plan. A run missing a partition
 * would sum too little, so totals are written only when every partition reported.
 */
function measuredDurations(
  summaries: readonly PartitionSummary[],
  complete: boolean,
): { nodes: Map<string, number>; suites: number } {
  const nodes = new Map<string, number>()
  const suites = new Map<string, number>()
  for (const summary of summaries) {
    for (const gate of summary.gates) {
      if (!ran(gate)) {
        continue
      }
      nodes.set(gate.name, Math.round(gate.elapsedMs))
      if (gate.suite !== undefined && gate.suite !== gate.name) {
        suites.set(gate.suite, (suites.get(gate.suite) ?? 0) + Math.round(gate.elapsedMs))
      }
    }
  }
  if (complete) {
    for (const [suite, totalMs] of suites) {
      nodes.set(suite, totalMs)
    }
  }
  return { nodes, suites: complete ? suites.size : 0 }
}

async function readStore(path: string): Promise<TimingsStore> {
  try {
    const store = await FS.readJson<TimingsStore>(path)
    return store.nodes === undefined || typeof store.nodes !== 'object' ? { nodes: {}, version: 1 } : store
  } catch {
    return { nodes: {}, version: 1 }
  }
}

/**
 * fold applies the measurements to the seed with the local store's wall-time rule, with one
 * difference: a seed entry holding a single sample is a prior — a planner estimate or one run on
 * some developer machine — not an average worth damping toward, so the first CI measurement
 * replaces it outright. From the second sample on, the EMA protects the seed against one slow runner.
 */
export function fold(
  store: TimingsStore,
  measured: ReadonlyMap<string, number>,
  lastRunAt: string,
): { added: number; store: TimingsStore; updated: number } {
  const nodes = { ...store.nodes }
  let added = 0
  let updated = 0
  for (const [name, wallMs] of measured) {
    const previous = nodes[name]
    const cold = previous === undefined || !Number.isFinite(previous.emaMs)
    const prior = cold || (previous.samples ?? 0) <= 1
    cold ? added++ : updated++
    nodes[name] = {
      ...previous,
      emaMs: prior ? wallMs : Math.round(EMA_WEIGHT_WALL * wallMs + (1 - EMA_WEIGHT_WALL) * previous.emaMs),
      lastMs: wallMs,
      lastRunAt,
      lastWallMs: wallMs,
      samples: prior ? 1 : previous.samples + 1,
      source: 'wall',
    }
  }
  const sorted = Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  return { added, store: { nodes: sorted, version: 1 }, updated }
}

/**
 * unzip reads a zip archive's central directory and returns every entry's bytes. GitHub's artifact
 * archives are plain stored or deflated entries, which the runtime's raw inflate decodes without an unzip binary.
 */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) {
    end--
  }
  if (end < 0) {
    return Errors.throwHostEnvironment('The downloaded artifact is not a zip archive.')
  }
  const entryCount = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const entries = new Map<string, Uint8Array>()
  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      return Errors.throwHostEnvironment('The downloaded artifact has a damaged central directory.')
    }
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
    const data = bytes.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) {
      entries.set(name, data)
    } else if (method === 8) {
      entries.set(name, new Uint8Array(Bun.inflateSync(data.slice(), { windowBits: -15 })))
    } else {
      return Errors.throwHostEnvironment(
        `${name} in the downloaded artifact uses zip method ${method}, which is not supported.`,
      )
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

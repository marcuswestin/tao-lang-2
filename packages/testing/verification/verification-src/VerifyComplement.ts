import { FS } from '@shared'
import { GateCatalog } from './GateCatalog'
import { RunArtifacts } from './RunArtifacts'

/*
 * The complement lane is the half of a landing's proof that hosted `Verify` cannot give: the gates
 * that need an unsandboxed macOS host with a window server. Its membership is not a second list to
 * keep in step with the Justfile and the `CI macOS` workflow; it is derived from both. Every gate of the full
 * lane that the catalog marks host-only is a candidate, and the workflow's `CI_HOST_GATES` names
 * the ones a hosted runner already admits, so what remains is exactly what nobody else runs. A
 * workflow with no such key admits none, and the complement is then every host gate. A workflow that
 * does not run on pull requests proves nothing before a merge, so its admission counts as none too.
 *
 * The prepare nodes those gates read come along by the catalog's own edges, because the work graph
 * waits only on dependencies present in the run: a lane holding `studio-smoke` without
 * `_parser-gen` would start the smoke against a missing generated parser.
 */

/** CI_HOST_GATES_KEY is the workflow `env` key naming the host gates `CI macOS` admits. */
export const CI_HOST_GATES_KEY = 'CI_HOST_GATES'
/** WORKFLOW_PATH is where the admission is read from, relative to the repository root. */
export const WORKFLOW_PATH = '.github/workflows/ci-macos.yml'
/** STATUS_CONTEXT is the commit status the lane reports under, beside the `Verify` check. */
export const STATUS_CONTEXT = 'Verify (host)'
/** RECEIPT_FILE sits beside `summary.json` and says what the run was asked to prove. */
export const RECEIPT_FILE = 'complement.json'

const ADMISSION_LINE = new RegExp(`^\\s*${CI_HOST_GATES_KEY}:\\s*'([^']*)'`, 'mu')
/** The top-level `on:` key, through the lines indented under it. */
const TRIGGER_BLOCK = /^on:[^\n]*(?:\n(?:[ \t][^\n]*|[ \t]*))*/mu
const PULL_REQUEST_TRIGGER = /(?<![\w-])pull_request(?![\w-])/u

/** ComplementPlan is what the lane will run, and why each host gate is or is not in it. */
export type ComplementPlan = {
  /** The host gates the workflow admits, in the order it names them. */
  admitted: readonly string[]
  /** Every gate the lane runs: the complement plus the prepare nodes they read. */
  gates: readonly string[]
  /** The host gates nobody else runs; the reason the lane exists. */
  host: readonly string[]
  /** Whether the workflow carried the admission key at all. */
  workflowAdmits: boolean
}

/** ComplementReceipt is written beside the summary so a landing can be audited after the fact. */
export type ComplementReceipt = ComplementPlan & {
  headSha: string
  /** Paths the lane left changed; a landing's tree must be the one that was verified. */
  changedPaths: readonly string[]
  status: 'failure' | 'success'
  summaryPath: string
}

/** admittedHostGates reads the host gates `CI macOS` runs itself from the workflow text. */
export function admittedHostGates(workflowText: string): { admitted: string[]; present: boolean } {
  const match = ADMISSION_LINE.exec(workflowText)
  if (match === null) {
    return { admitted: [], present: false }
  }
  const value = match[1] ?? ''
  return {
    admitted: value === '' ? [] : value.split(',').map(name => name.trim()).filter(name => name !== ''),
    present: true,
  }
}

/**
 * runsOnPullRequests reports whether the workflow's `on:` declares a `pull_request` trigger, in the
 * block, flow, or scalar spelling. Comments are dropped first: a workflow that only mentions the
 * trigger in prose does not run on one, and a host gate it admits is proved on no pull request.
 */
export function runsOnPullRequests(workflowText: string): boolean {
  const block = TRIGGER_BLOCK.exec(workflowText)?.[0] ?? ''
  return PULL_REQUEST_TRIGGER.test(block.replace(/#[^\n]*/gu, ''))
}

/** isHostGate names the gates only an unsandboxed macOS host can run. */
export function isHostGate(name: string): boolean {
  const gate = GateCatalog.metadata(name)
  return gate.requiresUnsandboxed === true || gate.requiresMacOS === true
}

/** plan derives the lane from the full lane's membership and the workflow's admission. */
export function plan(laneGates: readonly string[], workflowText: string): ComplementPlan {
  const reported = admittedHostGates(workflowText)
  // The workflow's gates are proved on a pull request's head only if it runs on pull requests.
  const admission = runsOnPullRequests(workflowText) ? reported : { ...reported, admitted: [] }
  const admitted = new Set(admission.admitted)
  const host = laneGates.filter(name => isHostGate(name) && !admitted.has(name))
  const gates = new Set<string>()
  const include = (name: string): void => {
    if (gates.has(name)) {
      return
    }
    for (const need of GateCatalog.dependenciesOf(name)) {
      include(need)
    }
    gates.add(name)
  }
  for (const name of host) {
    include(name)
  }
  return {
    admitted: admission.admitted,
    gates: laneGates.filter(name => gates.has(name)),
    host,
    workflowAdmits: admission.present,
  }
}

/** readPlan derives the lane from the workflow file in a checkout. */
export async function readPlan(laneGates: readonly string[], repositoryRoot: string): Promise<ComplementPlan> {
  const path = FS.resolvePath(WORKFLOW_PATH, repositoryRoot)
  const text = await FS.exists(path) ? await FS.readText(path) : ''
  return plan(laneGates, text)
}

/** receiptPath is where a run's receipt lives: beside its `summary.json`. */
export function receiptPath(logRoot: string): string {
  return FS.resolvePath(RECEIPT_FILE, logRoot)
}

/** writeReceipt records what the run proved, beside the lane's summary. */
export async function writeReceipt(logRoot: string, receipt: ComplementReceipt): Promise<string> {
  const path = receiptPath(logRoot)
  await FS.writeJson(path, receipt)
  return path
}

export const VerifyComplement = {
  CI_HOST_GATES_KEY,
  RECEIPT_FILE,
  STATUS_CONTEXT,
  SUMMARY_FILE: RunArtifacts.SUMMARY_FILE,
  WORKFLOW_PATH,
  admittedHostGates,
  isHostGate,
  plan,
  readPlan,
  receiptPath,
  runsOnPullRequests,
  writeReceipt,
} as const

import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { type GateSummary } from '@verification/RunSummary'
import { VerificationLanes } from '@verification/VerificationLanes'
import { type ComplementPlan, VerifyComplement } from '@verification/VerifyComplement'
import { type GhRunner, gitHubPulls } from './GitHubPulls'

/*
 * `verify-complement` is the local half of a landing: hosted `Verify` proves the portable gates and
 * the host gates its Linux partitions run, and this runs, on the one macOS host with a window server,
 * exactly the host-only gates hosted Verify does not run. It derives that list from the catalog and
 * `ci-macos.yml` (`VerifyComplement`), runs it as one `./dev gates`
 * lane — a child process rather than a call, so the lock, the GUI lease, Watchman, and the lowered
 * priority are the gates command's own and not a second copy here — and reports the verdict as the
 * `Verify (host)` commit status on HEAD, where `pr-checks` and `open-pr` read it beside `Verify`.
 *
 * The status is posted pending before the lane starts and concluded in a `finally`, so a follower
 * waiting on the head sees the run as a whole: a crash is reported as `error`, never left pending.
 * A receipt beside the lane's `summary.json` records the head, what the workflow admitted, and what
 * ran, which is what an audit of a landing needs that the summary alone does not say.
 */

const STATUS_DESCRIPTION_LIMIT = 140

/** VerifyComplementDependencies isolates process and filesystem effects for testing. */
export type VerifyComplementDependencies = {
  exists: (path: string) => Promise<boolean>
  readJson: (path: string) => Promise<unknown>
  remove: (path: string) => Promise<void>
  run: GhRunner
  writeLine: (line: string) => void
  writeReceipt: typeof VerifyComplement.writeReceipt
}

const defaultDependencies: VerifyComplementDependencies = {
  exists: FS.exists,
  readJson: path => FS.readJson(path),
  remove: path => FS.remove(path),
  run: CLI.run,
  writeLine: HCI.writeLine,
  writeReceipt: VerifyComplement.writeReceipt,
}

/** VerifyComplementOptions is the flags-ready input accepted by the development CLI command. */
export type VerifyComplementOptions = {
  /** The full lane's gate list, from which the host-only complement is derived. */
  gates: readonly string[]
  jobs?: number
  output?: string
  repositoryRoot?: string
  showStudio?: boolean
  /** Post the `Verify (host)` status on HEAD; off for a run whose head is not on GitHub. */
  status?: boolean
}

/** VerifyComplementResult reports the derived plan, the verdict, and where the receipt went. */
export type VerifyComplementResult = {
  exitCode: number
  lines: string[]
  plan: ComplementPlan
  receiptPath?: string
}

/** VerifyComplementCommand is the CLI wiring surface consumed by `dev.ts`. */
export const VerifyComplementCommand = {
  async run(
    options: VerifyComplementOptions,
    dependencies: VerifyComplementDependencies = defaultDependencies,
  ): Promise<VerifyComplementResult> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const lines: string[] = []
    const report = (line: string): void => {
      lines.push(line)
      dependencies.writeLine(line)
    }
    const plan = await VerifyComplement.readPlan(options.gates, root)
    report(
      plan.workflowAdmits
        ? `${VerifyComplement.WORKFLOW_PATH} admits ${describeList(plan.admitted)} on a hosted macOS runner.`
        : `${VerifyComplement.WORKFLOW_PATH} carries no ${VerifyComplement.CI_HOST_GATES_KEY}; no hosted runner admits a host gate.`,
    )
    if (plan.host.length === 0) {
      report('PASS  CI macOS admits every host gate; nothing is left for this machine to run.')
      return { exitCode: 0, lines, plan }
    }
    report(`Complement: ${plan.host.join(' ')}`)

    const headSha = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
    const before = await changedPaths(dependencies, root)
    const github = gitHubPulls(dependencies.run, root, dependencies.writeLine)
    const posts = options.status !== false
    const setStatus = async (
      state: 'error' | 'failure' | 'pending' | 'success',
      description: string,
    ): Promise<void> => {
      if (!posts) {
        return
      }
      try {
        await github.createStatus(headSha, {
          context: VerifyComplement.STATUS_CONTEXT,
          description: description.slice(0, STATUS_DESCRIPTION_LIMIT),
          state,
        })
      } catch (error) {
        // A status is how the run reports to GitHub, not what it proves: a head not yet pushed, or a
        // proxy refusing the route, leaves the local verdict intact and says so.
        report(
          `NOTE  Could not post ${VerifyComplement.STATUS_CONTEXT} on ${headSha.slice(0, 8)}: ${
            Errors.messageOf(error)
          }`,
        )
      }
    }

    await setStatus('pending', `Running ${plan.host.length} host gate(s) locally`)
    const summaryCopy = FS.resolvePath(
      `.artifacts/logs/${VerificationLanes.VERIFY_COMPLEMENT}/summary-${Platform.runtimeProcess.pid}.json`,
      root,
    )
    let summary: GateSummary | undefined
    let concluded = false
    try {
      const lane = await dependencies.run('./dev', {
        args: [
          'gates',
          ...plan.gates,
          '--lane',
          VerificationLanes.VERIFY_COMPLEMENT,
          '--no-cache',
          '--json',
          summaryCopy,
          ...(options.showStudio === true ? ['--show-studio'] : []),
          ...(options.jobs === undefined ? [] : ['--jobs', String(options.jobs)]),
          ...(options.output === undefined ? [] : ['--output', options.output]),
        ],
        cwd: root,
        stdio: 'inherit',
      })
      if (await dependencies.exists(summaryCopy)) {
        summary = await dependencies.readJson(summaryCopy) as GateSummary
        await dependencies.remove(summaryCopy)
      }
      const after = await changedPaths(dependencies, root)
      const changed = after.filter(path => !before.includes(path))
      const passed = lane.exitCode === 0 && lane.error === undefined && lane.signal === null && changed.length === 0
      if (summary !== undefined) {
        const receiptPath = await dependencies.writeReceipt(FS.resolvePath(summary.logRoot, root), {
          ...plan,
          changedPaths: changed,
          headSha,
          status: passed ? 'success' : 'failure',
          summaryPath: FS.resolvePath(VerifyComplement.SUMMARY_FILE, FS.resolvePath(summary.logRoot, root)),
        })
        report(`Receipt: ${receiptPath}`)
        if (changed.length > 0) {
          report(`FAIL  The lane changed the tree this head was pushed without: ${changed.join(' ')}`)
        }
        await setStatus(
          passed ? 'success' : 'failure',
          passed
            ? `${plan.host.length} host gate(s) passed on ${headSha.slice(0, 8)}`
            : summary.firstFailure === undefined
            ? changed.length > 0
              ? 'The lane changed the tree'
              : 'A host gate failed'
            : `${summary.firstFailure.name} failed`,
        )
        concluded = true
        report(
          passed
            ? `PASS  ${VerifyComplement.STATUS_CONTEXT}: ${plan.host.length} host gate(s) passed on ${
              headSha.slice(0, 8)
            }.`
            : `FAIL  ${VerifyComplement.STATUS_CONTEXT} failed on ${headSha.slice(0, 8)}; read ${summary.logRoot}.`,
        )
        return { exitCode: passed ? 0 : 1, lines, plan, receiptPath }
      }
      await setStatus('error', 'The lane ended without a summary')
      concluded = true
      report(`FAIL  The lane ended without writing a summary (exit ${lane.exitCode ?? 'unknown'}).`)
      return { exitCode: 1, lines, plan }
    } finally {
      if (!concluded) {
        await setStatus('error', 'The lane did not conclude')
      }
    }
  },
} as const

function describeList(names: readonly string[]): string {
  return names.length === 0 ? 'no host gate' : names.join(', ')
}

/** Tracked and untracked paths the tree holds beyond HEAD; a lane that adds one changed the tree. */
async function changedPaths(dependencies: VerifyComplementDependencies, root: string): Promise<string[]> {
  const status = (await git(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
  return status.split('\n').filter(line => line !== '').map(line => line.slice(3))
}

async function git(
  dependencies: VerifyComplementDependencies,
  cwd: string,
  args: readonly string[],
): Promise<CLI.CommandResult> {
  const result = await dependencies.run('git', { args, cwd, stdio: 'pipe' })
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    throw new Errors.CommandExecutionError(result)
  }
  return result
}

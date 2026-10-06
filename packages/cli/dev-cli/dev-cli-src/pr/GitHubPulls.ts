import { type CLI, Errors } from '@shared'

/*
 * Every pull-request read and write `open-pr` and `merge-pr` make goes through GitHub's REST API with
 * `gh api`, not through `gh pr`: the `gh pr` subcommands speak GraphQL, which a cloud agent host's
 * GitHub proxy may refuse, while REST answers the same wherever `gh` is logged in. `{owner}/{repo}`
 * is gh's own placeholder, filled from the checkout's `origin`. Turning auto-merge on or off and
 * marking a draft ready have no GitHub REST endpoint, so those two stay on `gh pr` in their callers;
 * for auto-merge, a cloud agent host's proxy offers REST routes of its own under `/ccr/`, which
 * the callers fall back to where `gh pr` is refused and which GitHub itself does not serve.
 */

/** PR_BRANCH_PREFIXES names the branches `open-pr` pushes and `merge-pr` merges. */
const PR_BRANCH_PREFIXES = [
  'feat/',
  // A cloud agent session may push only the one branch its host assigned, named under these.
  'claude/',
  'codex/',
] as const

const REPOSITORY = 'repos/{owner}/{repo}'

/** GhRunner is the injectable process seam every `git` and `gh` call goes through. */
export type GhRunner = (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>

/** PullRequest is the slice of GitHub's REST pull request these commands read. */
export type PullRequest = {
  auto_merge: { commit_message: string | null; commit_title: string | null } | null
  base: { ref: string }
  draft: boolean
  head: { ref: string; sha: string }
  html_url: string
  /** `dirty` when the pull request conflicts with its base. */
  mergeable_state?: string
  /** The squash commit on the base once merged; GitHub omits it from list responses. */
  merge_commit_sha?: string | null
  merged_at: string | null
  number: number
  state: 'closed' | 'open'
}

/** requirePrBranch returns the checked-out branch, refusing any outside `PR_BRANCH_PREFIXES`. */
export async function requirePrBranch(run: GhRunner, root: string, command: string): Promise<string> {
  const result = await run('git', { args: ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd: root, stdio: 'pipe' })
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Errors.CommandExecutionError(result)
  }
  const branch = result.exitCode === 0 ? result.stdout.trim() : ''
  const accepted = PR_BRANCH_PREFIXES.map(prefix => `${prefix}<name>`).join(', ')
  if (branch === '') {
    Errors.throwUserInput(`HEAD is detached; ${command} needs a branch checked out, named ${accepted}.`)
  }
  if (!PR_BRANCH_PREFIXES.some(prefix => branch.startsWith(prefix))) {
    Errors.throwUserInput(`This worktree is on '${branch}', not a ${accepted} branch; ${command} refuses it.`)
  }
  return branch
}

/** GitHubPulls binds the REST calls to one checkout and one runner. */
export function gitHubPulls(run: GhRunner, root: string, writeLine: (line: string) => void) {
  async function api<ValueT>(args: readonly string[]): Promise<ValueT> {
    const result = await run('gh', { args: ['api', ...args], cwd: root, stdio: 'pipe' })
    mustSucceed(result, writeLine)
    const text = result.stdout.trim()
    if (text === '') {
      return undefined as ValueT
    }
    try {
      return JSON.parse(text) as ValueT
    } catch (error) {
      return Errors.throwUnexpected(`gh api printed output that is not JSON: ${Errors.messageOf(error)}`, {
        details: { text },
      })
    }
  }
  const pulls = `${REPOSITORY}/pulls`

  return {
    /** The branch's pull requests, newest first; `head` needs the owner, which gh fills in. */
    async forBranch(branch: string, state: 'all' | 'closed' | 'open'): Promise<PullRequest[]> {
      return await api([`${pulls}?state=${state}&head={owner}:${encodeURIComponent(branch)}&per_page=100`])
    },
    async view(number: number): Promise<PullRequest> {
      return await api([`${pulls}/${number}`])
    },
    async create(fields: { base: string; body: string; head: string; title: string }): Promise<PullRequest> {
      return await api(['--method', 'POST', pulls, ...formFields(fields)])
    },
    async edit(number: number, fields: { body: string; title: string }): Promise<void> {
      await api(['--method', 'PATCH', `${pulls}/${number}`, ...formFields(fields), '--silent'])
    },
    /** How many check runs the commit carries; GitHub creates them some seconds after a push. */
    async checkRunCount(sha: string): Promise<number> {
      return (await api<{ total_count: number }>([`${REPOSITORY}/commits/${sha}/check-runs?per_page=1`])).total_count
    },
    /** The conclusion of the newest check run named `name` on the commit, if one has concluded. */
    async checkConclusion(sha: string, name: string): Promise<string | undefined> {
      const runs = await api<{ check_runs: { conclusion: string | null }[] }>([
        `${REPOSITORY}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest`,
      ])
      return runs.check_runs[0]?.conclusion ?? undefined
    },
    /**
     * Squash-merges with the message verbatim, pinned to `sha` so a later push cannot slip in.
     * The raw result is returned, because a refusal may only mean auto-merge merged it first.
     */
    async squashMerge(
      number: number,
      fields: { body: string; sha: string; title: string },
    ): Promise<CLI.CommandResult> {
      return await run('gh', {
        args: [
          'api',
          '--method',
          'PUT',
          `${pulls}/${number}/merge`,
          ...formFields({
            commit_message: fields.body,
            commit_title: fields.title,
            merge_method: 'squash',
            sha: fields.sha,
          }),
          '--silent',
        ],
        cwd: root,
        stdio: 'pipe',
      })
    },
    /**
     * Turns squash auto-merge on through a cloud agent host's proxy route, for where `gh pr merge
     * --auto` is refused. The raw result is returned: elsewhere the route does not exist.
     */
    async enableHostAutoMerge(number: number, fields: { body: string; title: string }): Promise<CLI.CommandResult> {
      return await run('gh', {
        args: [
          'api',
          '--method',
          'PUT',
          `${pulls}/${number}/ccr/auto_merge`,
          ...formFields({ commit_message: fields.body, commit_title: fields.title, merge_method: 'squash' }),
          '--silent',
        ],
        cwd: root,
        stdio: 'pipe',
      })
    },
    /** Turns auto-merge off through the same host route; the raw result, as above. */
    async disableHostAutoMerge(number: number): Promise<CLI.CommandResult> {
      return await run('gh', {
        args: ['api', '--method', 'DELETE', `${pulls}/${number}/ccr/auto_merge`, '--silent'],
        cwd: root,
        stdio: 'pipe',
      })
    },
    /**
     * Posts a commit status on `sha`. A status is how a run outside Actions reports beside the
     * `Verify` check: `pr-checks` reads statuses with check runs, so a pending one keeps a follower
     * waiting and a concluded one is part of its verdict.
     */
    async createStatus(sha: string, fields: CommitStatusFields): Promise<void> {
      await api([
        '--method',
        'POST',
        `${REPOSITORY}/statuses/${sha}`,
        ...formFields({
          context: fields.context,
          description: fields.description,
          state: fields.state,
          ...(fields.target_url === undefined ? {} : { target_url: fields.target_url }),
        }),
        '--silent',
      ])
    },
    /** Runs for one commit, newest first; defaults to Verify unless all workflows are requested. */
    async verifyRuns(sha: string, allWorkflows = false): Promise<WorkflowRun[]> {
      const body = await api<{ workflow_runs: WorkflowRun[] }>([
        `${REPOSITORY}/actions/${allWorkflows ? 'runs' : 'workflows/verify.yml/runs'}?head_sha=${sha}&per_page=100`,
      ])
      return body.workflow_runs.filter(run => run.head_sha === sha)
    },
    /** Asks Actions to cancel one run; GitHub answers 202 and cancels asynchronously. */
    async cancelRun(id: number): Promise<void> {
      await api(['--method', 'POST', `${REPOSITORY}/actions/runs/${id}/cancel`, '--silent'])
    },
  }
}

/** CommitStatusFields is what a status needs; `description` is capped by GitHub at 140 characters. */
export type CommitStatusFields = {
  context: string
  description: string
  state: 'error' | 'failure' | 'pending' | 'success'
  target_url?: string
}

/** WorkflowRun is the slice of an Actions run these commands read. */
export type WorkflowRun = {
  conclusion: string | null
  head_sha: string
  html_url: string
  id: number
  status: string
}

/** `-f` sends each value as a raw string, so a body beginning with `@` or `-` is never read as a file or flag. */
function formFields(fields: Record<string, string>): string[] {
  return Object.entries(fields).flatMap(([key, value]) => ['-f', `${key}=${value}`])
}

/** mustSucceed prints what the tool said first: the thrown error names only the command line. */
export function mustSucceed(result: CLI.CommandResult, writeLine: (line: string) => void): CLI.CommandResult {
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    const said = (result.stderr || result.stdout).trim()
    if (said !== '') {
      writeLine(`FAIL  ${result.command} said: ${said}`)
    }
    throw new Errors.CommandExecutionError(result)
  }
  return result
}

/** isMerged reads GitHub's REST state the way `gh pr view` reported `MERGED`. */
export function isMerged(pr: PullRequest): boolean {
  return pr.merged_at !== null
}

/** The repository's warn-only Git hook checks: an attribution trailer or an agent identity in a
 * commit message, and a detached HEAD or a branch outside the two work prefixes. Neither check
 * fails a commit. The offending text is never echoed back: naming the rule is enough to find it. */

// The identities a work product must not name. This list is data for the checks below and the one
// place in the repository these words are written; every other file states the rule without them.
const AGENT_IDENTITY_SUBSTRINGS = ['claude', 'anthropic', 'codex', 'chatgpt', 'copilot', 'gemini']
const AGENT_IDENTITY_NUMBERED = /gpt-[0-9]/

const ATTRIBUTION_WARNING =
  'This commit message carries an automated attribution trailer. Commit messages in this repository carry no AI Co-Authored-By trailer and no generated-with line. The commit is not blocked; amend it to drop the trailer.'
const IDENTITY_WARNING =
  'This commit message names an agent identity. Work products here — commit messages included — name none. The commit is not blocked. A path or a harness product read as an identity is a false positive of this check.'
const DETACHED_HEAD_WARNING =
  'This worktree is on a detached HEAD, so a commit made here belongs to no branch. Name one first: ./agent start-branch feat/<name>'

const WORK_BRANCH = /^(?:feat|dev)\/.+/

/** namesAnAgentIdentity reports whether text names one. A token holding a path separator, or
 * starting with a dot, names a file rather than an identity. */
function namesAnAgentIdentity(text: string): boolean {
  return text.split(/\s+/).some(word => {
    if (word === '' || word.includes('/') || word.startsWith('.')) {
      return false
    }
    const lower = word.toLowerCase()
    return AGENT_IDENTITY_SUBSTRINGS.some(pattern => lower.includes(pattern)) || AGENT_IDENTITY_NUMBERED.test(lower)
  })
}

/** isAttributionLine reports whether a line is an automated attribution trailer or a
 * generated-with line. A `Co-Authored-By:` naming a person is not one, which is why the identity
 * check runs over the same line; the robot marker needs no second opinion. */
function isAttributionLine(line: string): boolean {
  if (line.includes('🤖')) {
    return true
  }
  const lower = line.toLowerCase()
  const looksAutomated = lower.startsWith('co-authored-by:') || lower.includes('generated with')
  return looksAutomated && namesAnAgentIdentity(line)
}

/** commitMessageWarnings returns what a commit message will carry into history: an automated
 * attribution trailer, an agent identity, both, or neither. Git's own commentary lines (`#...`)
 * are stripped before the message is stored, and are skipped here for the same reason. */
export function commitMessageWarnings(message: string): string[] {
  const lines = message.split('\n').filter(line => !line.startsWith('#'))
  const attribution = lines.some(isAttributionLine)
  const identity = lines.some(line => !isAttributionLine(line) && namesAnAgentIdentity(line))
  return [...(attribution ? [ATTRIBUTION_WARNING] : []), ...(identity ? [IDENTITY_WARNING] : [])]
}

/** branchWarnings returns what this worktree's HEAD will do to the commit: `branch` is the
 * checked-out branch name, or `undefined` for a detached HEAD. */
export function branchWarnings(branch: string | undefined): string[] {
  if (branch === undefined) {
    return [DETACHED_HEAD_WARNING]
  }
  if (!WORK_BRANCH.test(branch)) {
    return [
      `Branch \`${branch}\` is not a \`feat/<name>\` or \`dev/<name>\` branch. Start a feature branch with ./agent start-branch feat/<name>.`,
    ]
  }
  return []
}

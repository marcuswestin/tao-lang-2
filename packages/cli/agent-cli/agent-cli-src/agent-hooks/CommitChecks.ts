/** The repository's warn-only Git hook checks commit-message attribution and branch placement.
 * Descriptive mentions of a changed harness are allowed. Neither check fails a commit, and the
 * offending text is never echoed back: naming the rule is enough to find it. */

// These identities distinguish AI generated-with lines from ordinary generator descriptions.
const AGENT_IDENTITY_SUBSTRINGS = ['claude', 'anthropic', 'codex', 'chatgpt', 'copilot', 'gemini']
const AGENT_IDENTITY_NUMBERED = /gpt-[0-9]/

const COAUTHOR_WARNING =
  'This commit message contains Co-Authored-By text. No commit message here contains it, regardless of whom it names. The commit is not blocked; amend it to remove the text.'
const AUTOMATED_ATTRIBUTION_WARNING =
  'This commit message carries an automated attribution marker or AI generated-with line. The commit is not blocked; amend it to remove the attribution.'
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

/** Recognize an AI generated-with line or robot marker, leaving parser-generator descriptions alone. */
function isAutomatedAttributionLine(line: string): boolean {
  if (line.includes('🤖')) {
    return true
  }
  const lower = line.toLowerCase()
  return lower.includes('generated with') && namesAnAgentIdentity(line)
}

/** Git's own commentary lines (`#...`) are stripped before the message is stored. */
export function commitMessageWarnings(message: string): string[] {
  const lines = message.split('\n').filter(line => !line.startsWith('#'))
  const coauthor = lines.some(line => /co-authored-by/i.test(line))
  const automatedAttribution = lines.some(isAutomatedAttributionLine)
  return [...(coauthor ? [COAUTHOR_WARNING] : []), ...(automatedAttribution ? [AUTOMATED_ATTRIBUTION_WARNING] : [])]
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

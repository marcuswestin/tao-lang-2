import { AgentConfigFreshness } from '@agent-cli/agent-config/AgentConfigFreshness'
import { readDelegationIssues } from '@agent-cli/delegation/DelegationProfiles'
import { FS, HCI, Platform, Repo } from '@shared'
import { type LintIssueSource, repoLintIssues } from '@verification/repo-lint'

/**
 * repo-lint's own checks live in `packages/testing/verification`, which must not import back into
 * `tao-dev-cli` or `tao-agent-cli` (a cycle otherwise: `verification` -> `dev-cli` -> `verification`).
 * Delegation profile shape and agent-config freshness are rule data `agent-cli` owns, so this entry
 * registers them as extra issue sources instead of `repo-lint.ts` importing them directly.
 */
const EXTRA_ISSUE_SOURCES: readonly LintIssueSource[] = [
  readDelegationIssues,
  async repoRoot =>
    await FS.isFile(FS.resolvePath('.rulesync/rulesync.jsonc', repoRoot))
      ? await AgentConfigFreshness.staleIssues(repoRoot)
      : [],
]

if (import.meta.main) {
  const issues = await repoLintIssues(Repo.getRoot(), EXTRA_ISSUE_SOURCES)
  for (const issue of issues) {
    HCI.writeErrorLine(`repo lint: ${issue}`)
  }
  Platform.runtimeProcess.setExitCode(issues.length === 0 ? 0 : 1)
}

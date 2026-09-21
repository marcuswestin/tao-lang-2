import { FS, HCI, Platform, Repo } from '@shared'
import { type LintIssueSource, repoLintIssues } from '@verification/repo-lint'
import { AgentConfigFreshness } from './agent-config/AgentConfigFreshness'
import { readDelegationIssues } from './delegation/DelegationProfiles'

/**
 * repo-lint's own checks live in `packages/testing/verification`, which must not import back into
 * `packages/dev` (a cycle otherwise: `verification` -> `dev` -> `verification`). Delegation profile
 * shape and agent-config freshness are rule data `dev` owns, so this entry registers them as extra
 * issue sources instead of `repo-lint.ts` importing them directly.
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

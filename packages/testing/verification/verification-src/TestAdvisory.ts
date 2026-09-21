import type { TestLedgerStore } from './TestLedger'
import type { ChangedSelection } from './TestSelection'

/** fullRunReason returns only the highest-priority reason a complete verification is prudent. */
function fullRunReason(selection: ChangedSelection, ledger: TestLedgerStore): string | undefined {
  const paths = selection.changedPaths
  if (
    paths.some(path =>
      path.startsWith('packages/cli/dev-cli/') || path.startsWith('packages/cli/agent-cli/')
      || path === 'agent' || path === 'dev' || path === 'tao'
    )
  ) {
    return 'the developer or agent CLI changed since the comparison point'
  }
  if (paths.some(path => path === 'Justfile' || path.endsWith('/GateCatalog.ts'))) {
    return 'verification gate definitions changed since the comparison point'
  }
  if (
    paths.some(path =>
      path.startsWith('packages/apps/runtime/')
      || path.startsWith('packages/apps/expo-host/')
      || path.endsWith('/verify-release-bundle.ts')
    )
  ) {
    return 'runtime or release-bundle code changed since the comparison point'
  }
  if (
    selection.hasMergeCommit
    && (
      ledger.lastFullRunStartedAt === undefined
      || selection.newestMergeAt === undefined
      || Date.parse(ledger.lastFullRunStartedAt) < Date.parse(selection.newestMergeAt)
    )
  ) {
    return 'a merge commit was brought into this branch'
  }
  if (ledger.lastFullRunStartedAt === undefined) {
    return 'this checkout has no recorded complete test run'
  }
  if (
    selection.newestCommitAt !== undefined
    && Date.parse(ledger.lastFullRunStartedAt) < Date.parse(selection.newestCommitAt)
  ) {
    return 'the last complete test run predates this branch'
  }
  return undefined
}

function line(selection: ChangedSelection, ledger: TestLedgerStore): string | undefined {
  const reason = fullRunReason(selection, ledger)
  return reason === undefined ? undefined : `Note: ${reason} — './agent verify --complete' is worth a pass.`
}

/** TestAdvisory owns the one-line, non-gating complete-run recommendation. */
export const TestAdvisory = { fullRunReason, line } as const

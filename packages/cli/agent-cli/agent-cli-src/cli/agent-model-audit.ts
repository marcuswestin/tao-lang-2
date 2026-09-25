import { Platform } from '@shared'
import { ModelAuditCommand } from '../delegation/ModelAuditCommand'

// The session-start notice: one line when the routing table looks behind this machine, and nothing
// otherwise. A report never blocks a session, so a failed audit says nothing either.
const root = Platform.runtimeProcess.argv[2]
if (root !== undefined) {
  await ModelAuditCommand.run({ brief: true, repoRoot: root }).catch(() => 0)
}

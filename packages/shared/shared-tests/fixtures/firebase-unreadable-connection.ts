/** Isolate a deterministic read denial so the unreadable-connection regression also runs as root. */
import { Assert, Errors, FS, HCI, Platform } from '@shared'
import { MockModule } from '@shared/test'

const rootDir = Platform.runtimeProcess.argv[2]
Assert.defined(rootDir, 'The unreadable-connection fixture requires its project root.')
const connectionPath = FS.resolvePath('.tao/local/connections.json', rootDir)
const originalFs = { ...FS }
const denied: string[] = []

MockModule(new URL('../../shared-src/FS.ts', import.meta.url).pathname, () => ({
  ...originalFs,
  readText(path: string, ...rest: unknown[]) {
    if (path === connectionPath) {
      denied.push(path)
      Errors.throwHostEnvironment('EACCES: fixture connection file is unreadable')
    }
    return (originalFs.readText as (path: string, ...rest: unknown[]) => Promise<string>)(path, ...rest)
  },
}))

const { readFirebaseConnections } = await import('../../shared-src/FirebaseConnections')
let error: unknown
try {
  await readFirebaseConnections(rootDir)
} catch (caught) {
  error = caught
}
HCI.writeLine(
  JSON.stringify({ denied: denied.length, error: error === undefined ? undefined : Errors.messageOf(error) }),
)

/** Isolate a deterministic directory denial so this regression also runs as root. */
import { Assert, Errors, FS, HCI, Platform } from '@shared'
import { MockModule } from '@shared/test'

const rootDir = Platform.runtimeProcess.argv[2]
Assert.defined(rootDir, 'The directory-denial fixture requires its root path.')
const originalFs = { ...FS }
const traversed: string[] = []
const denied: string[] = []
const denial = 'EACCES: fixture directory is unreadable'

MockModule(new URL('../../../../shared/shared-src/FS.ts', import.meta.url).pathname, () => ({
  ...originalFs,
  walk(path: string, options: FS.WalkOptions = {}) {
    return originalFs.walk(path, {
      ...options,
      excludeDirectory(name) {
        if (options.excludeDirectory?.(name)) {
          return true
        }
        traversed.push(name)
        if (name === 'denied') {
          denied.push(name)
          Errors.throwHostEnvironment(denial)
        }
        return false
      },
    })
  },
}))

const { runCheck } = await import('../../cli-src/source-commands')
const results = await runCheck(FS.resolvePath('fixture/App.tao', rootDir))
const traversedByCheck = [...traversed]
Assert(denied.length === 0, 'The targeted check entered an unrelated sibling.')

// Prove the injected fault intercepts a real recursive filesystem walk, not just a direct mock call.
let walkError: unknown
try {
  for await (const _path of FS.walk(rootDir)) {
    // Consume the real walker until it reaches the denied sibling.
  }
} catch (error) {
  walkError = error
}
Assert(Errors.messageOf(walkError) === denial, 'The broad walk must reach the injected directory denial.')
HCI.writeLine(JSON.stringify({ results, traversedByCheck, deniedByWalk: denied }))

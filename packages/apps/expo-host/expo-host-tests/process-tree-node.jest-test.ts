import { Platform, ProcessTree } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

Describe('Node process cleanup on macOS', () => {
  Test('does not load Bun FFI when taking a process-tree snapshot', () => {
    Expect(Platform.runtimeBunVersion).toBeUndefined()
    const descendants = ProcessTree.descendants(process.pid)
    const identities = ProcessTree.identities([process.pid])

    Expect(descendants.every(child => child.pid !== process.pid)).toBe(true)
    Expect([...identities.keys()]).toEqual([process.pid])
  })
})

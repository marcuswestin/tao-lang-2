import { Describe, Expect, Test } from '@shared/test'
import { assertHostLease, HostControlError, type HostLeaseIdentity } from '../host-control-src/host-control'

const current: HostLeaseIdentity = { generation: 'generation-2', name: 'browser-session-1' }

Describe('host control lease fences', () => {
  Test('accepts only the current target name and generation', () => {
    Expect(() => assertHostLease(current, current)).not.toThrow()
    Expect(() => assertHostLease(current, { ...current, generation: 'generation-1' })).toThrow(HostControlError)
    Expect(() => assertHostLease(current, { ...current, name: 'browser-session-2' })).toThrow(HostControlError)
  })
})

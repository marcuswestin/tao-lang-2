import { Switch } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { StudioProtocol, studioProtocolChannel, studioProtocolVersion } from '../studio-src/StudioProtocol'

const inheritedKeys = ['constructor', 'toString', '__proto__', 'hasOwnProperty']

Describe('dispatch tables read their own keys only', () => {
  Test('a window message typed as an inherited Object member parses to undefined', () => {
    for (const type of inheritedKeys) {
      const message = { channel: studioProtocolChannel, evil: 'payload', protocolVersion: studioProtocolVersion, type }
      Expect(StudioProtocol.parseMessage(message)).toBeUndefined()
    }
  })

  Test('a socket message typed as an inherited Object member is rejected as unknown', () => {
    for (const type of inheritedKeys) {
      Expect(() => Switch.on({ type } as { type: 'known' }, 'type', { known: () => 'handled' }))
        .toThrow('Unhandled property value')
    }
  })

  Test('Switch rejects a discriminant that names an inherited Object member', () => {
    for (const kind of inheritedKeys) {
      Expect(() => Switch.kind({ kind } as { kind: 'known' }, { known: () => 'handled' }))
        .toThrow('Unhandled item kind')
    }
  })
})

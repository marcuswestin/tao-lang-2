import { FS } from '@shared'
import { Describe } from '@shared/test'
import { registerReceiptMutationTest } from './ProjectRefreshReceiptTestSupport'

Describe('watched project refresh receipt inputs', () => {
  const fixture = {
    'Main.tao': 'type Answer is one of One, Two\n',
    'Nested/Value.ts': 'export const value = 1\n',
  }
  registerReceiptMutationTest(
    'invalidates authored source and preserves authoritative cold parity',
    fixture,
    paths => paths['Main.tao']!,
    'function Answer( {\n',
    'stale',
  )
  registerReceiptMutationTest(
    'invalidates authored tsconfig and preserves authoritative cold parity',
    fixture,
    (_paths, root) => FS.resolvePath('tsconfig.json', root),
    '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"strict":false}}\n',
    'stale',
  )
  registerReceiptMutationTest(
    'invalidates changed nested ownership and preserves authoritative cold parity',
    fixture,
    (_paths, root) => FS.resolvePath('Nested/.tao/store/project.json', root),
    '{"id":"11111111-1111-4111-8111-111111111111"}\n',
    'fresh',
  )
  registerReceiptMutationTest(
    'invalidates lock changes and preserves authoritative cold parity',
    fixture,
    (_paths, root) => FS.resolvePath('.tao/store/lock.jsonc', root),
    '{broken',
    'stale',
  )
  registerReceiptMutationTest(
    'invalidates package topology and preserves authoritative cold parity',
    fixture,
    (_paths, root) => FS.resolvePath('package.json', root),
    '{"name":"changed-topology"}\n',
    'fresh',
  )
})

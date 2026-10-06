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
    'invalidates lock changes and preserves authoritative cold parity',
    fixture,
    (_paths, root) => FS.resolvePath('.tao/store/lock.jsonc', root),
    '{broken',
    'stale',
  )
})

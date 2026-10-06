import { FS } from '@shared'
import { Describe } from '@shared/test'
import { registerReceiptMutationCases } from './ProjectRefreshReceiptTestSupport'

Describe('watched project refresh receipt inputs', () => {
  registerReceiptMutationCases('invalidates authored inputs and preserves authoritative cold parity', {
    'Main.tao': 'type Answer is one of One, Two\n',
    'Nested/Value.ts': 'export const value = 1\n',
  }, [
    {
      title: 'authored source',
      target: paths => paths['Main.tao']!,
      content: 'function Answer( {\n',
      expectedStatus: 'stale',
    },
    {
      title: 'authored tsconfig',
      target: (_paths, root) => FS.resolvePath('tsconfig.json', root),
      content: '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"strict":false}}\n',
      expectedStatus: 'stale',
    },
    {
      title: 'lock changes',
      target: (_paths, root) => FS.resolvePath('.tao/store/lock.jsonc', root),
      content: '{broken',
      expectedStatus: 'stale',
    },
  ])
})

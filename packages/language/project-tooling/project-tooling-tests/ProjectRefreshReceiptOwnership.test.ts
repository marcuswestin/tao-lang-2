import { FS } from '@shared'
import { Describe } from '@shared/test'
import { registerReceiptMutationCases } from './ProjectRefreshReceiptTestSupport'

Describe('watched project refresh receipt ownership inputs', () => {
  registerReceiptMutationCases('invalidates ownership inputs and preserves authoritative cold parity', {
    'Main.tao': 'type Answer is one of One, Two\n',
    'Nested/Value.ts': 'export const value = 1\n',
  }, [
    {
      title: 'changed nested ownership',
      target: (_paths, root) => FS.resolvePath('Nested/.tao/store/project.json', root),
      content: '{"id":"11111111-1111-4111-8111-111111111111"}\n',
      expectedStatus: 'fresh',
    },
    {
      title: 'package topology',
      target: (_paths, root) => FS.resolvePath('package.json', root),
      content: '{"name":"changed-topology"}\n',
      expectedStatus: 'fresh',
    },
  ])
})

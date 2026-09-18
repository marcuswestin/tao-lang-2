import { Describe, Expect, Test } from '@shared/test'
import { bridgeValidationMessages } from '../validator-src/validators/bridge-validator'
import {
  accepts,
  app,
  rejects,
  stubView,
  validationErrorMessages,
  withValidatedFiles,
} from './test-validate'

function bridgeApp(declarations: string): string {
  return `${declarations}\n${app('render Empty()', stubView('Empty'))}`
}

Describe('validator: the TypeScript bridge', () => {
  Test(
    'accepts a bridged call and a bridged name against a declared type',
    accepts(bridgeApp(`
      function Words(Value text) returns number { return CountWords(Value) from ./Text.ts }
      let Stamp is text = BuildStamp from ./Build.ts
    `)),
  )

  Test(
    'accepts a head name that no Tao declaration provides, because it names an export',
    accepts(bridgeApp('function Words(Value text) returns number { return countWordsImpl(Value) from ./Text.ts }')),
  )

  Test(
    'rejects a bridged function result with no declared return type',
    rejects(
      bridgeApp('function Words(Value text) { return CountWords(Value) from ./Text.ts }'),
      bridgeValidationMessages.untyped,
    ),
  )

  Test(
    'rejects a bridged binding with no ascribed type',
    rejects(
      bridgeApp('let Stamp = BuildStamp from ./Build.ts'),
      bridgeValidationMessages.untyped,
    ),
  )

  Test(
    'rejects an expression head that names no single export',
    rejects(
      bridgeApp('function Words(Value text) returns number { return 1 + 2 from ./Text.ts }'),
      bridgeValidationMessages.head,
    ),
  )

  Test(
    'still resolves the arguments of a bridged call, which are ordinary Tao values',
    rejects(
      bridgeApp('function Words(Value text) returns number { return CountWords(Missing) from ./Text.ts }'),
      "Could not resolve reference to ValueDeclaration named 'Missing'.",
    ),
  )

  Test(
    'rejects a path that is not a TypeScript sidecar',
    rejects(
      bridgeApp('function Words(Value text) returns number { return CountWords(Value) from @tao/text }'),
      bridgeValidationMessages.path('@tao/text'),
    ),
  )

  Test('accepts a bridge whose sidecar is on disk beside the declaring file', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': bridgeApp('let Stamp is text = BuildStamp from ./Build.ts'),
      'Build.ts': 'export const BuildStamp = "stamp"',
    }, result => {
      Expect(validationErrorMessages(result)).toEqual([])
    })
  })

  Test('reports a missing bridged sidecar at its Tao expression', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': bridgeApp('let Stamp is text = BuildStamp from ./Missing.ts'),
    }, result => {
      const message = bridgeValidationMessages.missing('./Missing.ts')
      Expect(validationErrorMessages(result)).toContain(message)
      const diagnostic = result.diagnostics.find(candidate => candidate.message === message)
      Expect(diagnostic?.filePath).toContain('Main.tao')
      Expect(diagnostic?.range).toBeDefined()
    })
  })

  Test('reports a missing sidecar bridged from a function result', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': bridgeApp(
        'function Words(Value text) returns number { return CountWords(Value) from ./Missing.ts }',
      ),
    }, result => {
      Expect(validationErrorMessages(result)).toContain(bridgeValidationMessages.missing('./Missing.ts'))
    })
  })

  // `Adapter item is HNAdapter from ./HNAdapter.ts` is the shape HNReader configures a datasource
  // with, and the one position where a bridge sat inside an otherwise-checked declaration unchecked.
  Test('reports a missing sidecar bridged by a configuration slot default', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': bridgeApp(`
        public type HttpSource is nav with {
          Adapter item is HNAdapter from ./Missing.ts
          nav SourceImpl from ./SourceImpl.ts
        }
      `),
      'SourceImpl.ts': 'export function SourceImpl() {}',
    }, result => {
      Expect(validationErrorMessages(result)).toContain(bridgeValidationMessages.missing('./Missing.ts'))
    })
  })

  Test('reports a missing sidecar named through a parent directory', async () => {
    await withValidatedFiles('nested/Main.tao', {
      'nested/Main.tao': bridgeApp('let Stamp is text = BuildStamp from ../Missing.ts'),
    }, result => {
      Expect(validationErrorMessages(result)).toContain(bridgeValidationMessages.missing('../Missing.ts'))
    })
  })

  Test('reports the path shape once, without also reporting the file missing', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': bridgeApp('let Stamp is text = BuildStamp from @tao/text'),
    }, result => {
      const errors = validationErrorMessages(result)
      Expect(errors).toContain(bridgeValidationMessages.path('@tao/text'))
      Expect(errors.filter(message => message.includes('does not exist'))).toEqual([])
    })
  })
})

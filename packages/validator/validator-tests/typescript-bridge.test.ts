import { Describe, Test } from '@shared/test'
import { bridgeValidationMessages } from '../validator-src/validators/bridge-validator'
import { accepts, app, rejects, stubView } from './test-validate'

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
      "No value named 'Missing' is in scope.",
    ),
  )

  Test(
    'rejects a path that is not a TypeScript sidecar',
    rejects(
      bridgeApp('function Words(Value text) returns number { return CountWords(Value) from @tao/text }'),
      bridgeValidationMessages.path('@tao/text'),
    ),
  )
})

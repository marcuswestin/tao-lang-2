import { Describe, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { accepts, app, rejects, stubView } from './test-validate'

function compactApp(declarations: string): string {
  return `${declarations}\n${app('render Empty()', stubView('Empty'))}`
}

Describe('validator: the compact when form', () => {
  Test(
    'accepts a yes/no subject with the universal label and with no negative branch',
    accepts(compactApp(`
      function Ready(Done boolean) returns text { return when Done "Ready" / not "Waiting" }
      function Maybe(Done boolean) { return when Done "Ready" }
    `)),
  )

  Test(
    'accepts a declared no-pole alias as the label',
    accepts(`
      data Documents / Document {
         Title text,
         Final yes / Draft no
      }
      ${compactApp('function Status(Document) returns text { return when Document.Final "Final" / Draft "Draft" }')}
    `),
  )

  Test(
    "rejects a label that is neither the universal one nor the subject's alias",
    rejects(
      `
      data Documents / Document {
         Title text,
         Final yes / Draft no
      }
      ${compactApp('function Status(Document) returns text { return when Document.Final "Final" / Open "Draft" }')}
    `,
      FunctionalCoreValidator.messages.compactWhenLabel('Open', 'Draft'),
    ),
  )

  Test(
    'rejects a subject that is not a yes/no value',
    rejects(
      compactApp('function Label(Count number) returns text { return when Count "Some" / not "None" }'),
      FunctionalCoreValidator.messages.compactWhenSubject,
    ),
  )

  Test(
    'rejects incompatible outcomes, as the block form does',
    rejects(
      compactApp('function Mixed(Done boolean) returns text { return when Done "Ready" / not 1 }'),
      FunctionalCoreValidator.messages.conditionalBranch,
    ),
  )
})

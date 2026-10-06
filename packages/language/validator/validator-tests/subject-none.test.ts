import { Describe, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { accepts, rejects, stubContainer, stubView } from './test-validate'

const runtimeViews = `${stubContainer('Stack')}${stubView('Text', 'Value text')}`

Describe('validator: public none subject case', () => {
  Test(
    'classifies an actual optional entity union as an entity guard subject',
    accepts(`
      data Authors / Author { Name text }
      view Main(Person Author?) {
        render Stack() { guard Person { none -> { Text("Unknown author") } } }
      }
      ${runtimeViews}
    `),
  )

  Test(
    'does not classify other nullable values as entity guard subjects',
    rejects(
      `
      view Main(Value text?) {
        render Stack() { guard Value { none -> { Text("Unknown value") } } }
      }
      ${runtimeViews}
    `,
      FunctionalCoreValidator.messages.subjectCases,
    ),
  )

  Test(
    'accepts none as an entity read-net case',
    accepts(`
      data Documents / Document { Title text }
      view Main(Document) { render Stack() { guard Document { none -> { Text("Gone") } } } }
      ${runtimeViews}
    `),
  )

  Test(
    'accepts missing as a declared enum case name',
    accepts(`
      type Availability is one of missing, Available
      view Main(Current Availability) {
        action Check() { check Current is missing }
        render Stack() {
          when Current {
            missing -> { Text("Unavailable") }
            Available -> { Text("Ready") }
            otherwise -> { Text("Unknown") }
          }
        }
      }
      ${runtimeViews}
    `),
  )

  Test(
    'rejects missing as an entity guard case',
    rejects(
      `
        data Documents / Document { Title text }
        view Main(Document) { render Stack() { guard Document { missing -> { Text("Gone") } } } }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.invalidCase('missing', 'an entity subject'),
    ),
  )

  Test(
    'rejects missing in an app guard',
    rejects(
      `
        app NetApp { id "netapp" version "1.0.0" name "NetApp" view Main guard { missing -> { } } }
        view Main() { render Text("Ready") }
        ${runtimeViews}
      `,
      FunctionalCoreValidator.messages.appGuardCase('missing'),
    ),
  )

  Test(
    'does not treat missing as a built-in entity case test',
    rejects(`
      data Documents / Document { Title text }
      view Main(Document) { action Check() { check Document is missing } render Stack() }
      ${runtimeViews}
    `),
  )
})

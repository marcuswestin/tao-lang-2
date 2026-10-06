import { Describe, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { unitsValidationMessages } from '../validator-src/validators/units-validator'
import { accepts, app, rejects, stubView } from './test-validate'

function unitApp(declarations: string): string {
  return `${declarations}\n${app('render Text("Ready")', stubView('Text', 'Value text'))}`
}

Describe('validator: unit values', () => {
  Test(
    'keeps inherited associated calls after a numeric unit reading out of legacy unit validation',
    accepts(unitApp(`
      abstract type Scalar is numeric with {
        func ToText() fails never -> text { return "quantity" }
      }
      type Span is Scalar with { units { seconds 1 (default), minutes 60 } }
      func Read(Value Span) -> text { return Value.seconds().ToText() }
    `)),
  )

  Test(
    'accepts building, reading back, and converting durations of one family',
    accepts(unitApp(`
      function Round(Wait duration) returns number { return Wait.s }
      function Longer(Wait duration) returns duration { return Wait + 30.seconds }
      function Ratio(Wait duration) returns number { return Wait / 1.min }
      function Scaled(Wait duration) returns duration { return Wait * 2 }
      function Reading(Wait duration) returns text { return Wait.Clock }
    `)),
  )

  Test(
    'rejects a unit accessor that names no unit of any family',
    rejects(
      unitApp('function Wrong() returns number { return 10.furlongs }'),
      unitsValidationMessages.unknownUnit('furlongs', 'number'),
    ),
  )

  Test(
    'rejects reading a duration in a unit it does not have',
    rejects(
      unitApp('function Wrong(Wait duration) returns number { return (Wait + 1.s).meters }'),
      unitsValidationMessages.unknownUnit('meters', 'duration'),
    ),
  )

  Test(
    'rejects a unit accessor on a value that is neither a number nor a unit value',
    rejects(
      unitApp('function Wrong(Label text) returns number { return (Label + "x").s }'),
      unitsValidationMessages.notAUnitReceiver('s', 'text'),
    ),
  )

  Test(
    'rejects adding a bare number to a duration',
    rejects(
      unitApp('function Wrong(Wait duration) returns duration { return Wait + 1 }'),
      FunctionalCoreValidator.messages.dimensional('duration', '+', 'number'),
    ),
  )

  Test(
    'rejects adding two times, which no calendar pair defines',
    rejects(
      unitApp('function Wrong(At time, Also time) returns time { return At + Also }'),
      FunctionalCoreValidator.messages.dimensional('time', '+', 'time'),
    ),
  )

  Test(
    'rejects scaling a duration by another duration',
    rejects(
      unitApp('function Wrong(Wait duration) returns duration { return Wait * 2.s }'),
      FunctionalCoreValidator.messages.dimensional('duration', '*', 'duration'),
    ),
  )

  Test(
    'accepts the calendar pairs and comparison against the bare literal zero',
    accepts(unitApp(`
      function Elapsed(From time, To time) returns duration { return To - From }
      function Deadline(From time, Wait duration) returns time { return From + Wait }
      function Ran(Left duration) returns boolean { return Left > 0 }
      function Same(Left duration) returns boolean { return Left == 60.s }
    `)),
  )
})

import * as Shared from '../shared-src/shared'

const Assert: typeof Shared.Assert = Shared.Assert
const Errors: typeof Shared.Errors = Shared.Errors
const Switch: typeof Shared.Switch = Shared.Switch
// @ts-expect-error Error helpers should be accessed through Errors.* from the shared barrel.
const throwUserInput = Shared.throwUserInput
void throwUserInput

declare const maybeText: string | undefined
Assert.defined(maybeText, 'text should be defined')
const textLength: number = maybeText.length
void textLength

declare const unknownValue: unknown
Assert.is(unknownValue, isNumber, 'value should be number')
const doubled: number = unknownValue * 2
void doubled

declare const maybeIterations: number | undefined
Assert.input(maybeIterations, 'Iterations must be a positive integer.')
const iterations: number = maybeIterations
void iterations

const throwUserInputFromErrors: (messageForUser: string) => never = Errors.throwUserInput
const throwUnexpectedFromErrors: (messageForUser: string) => never = Errors.throwUnexpected
const throwHostEnvironmentFromErrors: (messageForUser: string) => never = Errors.throwHostEnvironment
void throwUserInputFromErrors
void throwUnexpectedFromErrors
void throwHostEnvironmentFromErrors

type Item =
  | { $type: 'text'; value: string; mode: 'read' }
  | { $type: 'count'; value: number; mode: 'write' }

type Status =
  | { kind: 'ready'; value: string }
  | { kind: 'empty'; value: number }

declare const item: Item
declare const status: Status

const callableRendered: string = Switch<'text' | 'count', string>('text', {
  text: () => 'text',
  count: () => 'count',
})
void callableRendered

const rendered: string = Switch.type(item, {
  text: text => text.value,
  count: count => count.value.toString(),
})
void rendered

const statusRendered: string = Switch.kind(status, {
  ready: ready => ready.value,
  empty: empty => empty.value.toString(),
})
void statusRendered

declare const optionalItem: Item | undefined
declare const optionalStatus: Status | undefined
const maybeRendered: string = Switch.typeMaybe(optionalItem, {
  text: text => text.value,
  count: count => count.value.toString(),
  undefined: () => 'missing',
})
void maybeRendered

const maybeStatusRendered: string = Switch.kindMaybe(optionalStatus, {
  ready: ready => ready.value,
  empty: empty => empty.value.toString(),
  undefined: () => 'missing',
})
void maybeStatusRendered

// @ts-expect-error Missing the count handler must remain a type error.
Switch.type(item, {
  text: text => text.value,
})

// @ts-expect-error Missing the empty handler must remain a type error.
Switch.kind(status, {
  ready: ready => ready.value,
})

// @ts-expect-error Missing the undefined handler must remain a type error.
Switch.typeMaybe(optionalItem, {
  text: text => text.value,
  count: count => count.value.toString(),
})

// @ts-expect-error Missing the undefined handler must remain a type error.
Switch.kindMaybe(optionalStatus, {
  ready: ready => ready.value,
  empty: empty => empty.value.toString(),
})

const mode: string = Switch.property(item, 'mode', {
  read: () => 'readable',
  write: () => 'writable',
})
void mode

declare const optionalMode: 'raw' | undefined
const optionalModeName: string = Switch(optionalMode, {
  raw: () => 'raw',
  undefined: () => 'normal',
})
void optionalModeName

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

// `Assert` and `Assert.input` narrow the operands of the expression they are given, not merely the
// reference passed. Without that, every type-guard and discriminated-union site has to stay a
// hand-written `if` around a typed throw, which is what this fixture exists to prevent regressing.
declare const guardedValue: unknown
Assert(isRecord(guardedValue) && typeof guardedValue['id'] === 'string', 'a record carrying an id')
const guardedId: unknown = guardedValue['id']
void guardedId

declare const authoredValue: unknown
Assert.input(Array.isArray(authoredValue), 'the rows to be a list')
const authoredCount: number = authoredValue.length
void authoredCount

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

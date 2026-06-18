import { Assert, Errors, Switch } from '../shared-src/shared'

// @ts-expect-error Error helpers should be accessed through Errors.* from the shared barrel.
import { throwUserInput } from '../shared-src/shared'

void throwUserInput

declare const maybeText: string | undefined
Assert.defined(maybeText, 'text should be defined')
const textLength: number = maybeText.length
void textLength

declare const unknownValue: unknown
Assert.is(unknownValue, isNumber, 'value should be number')
const doubled: number = unknownValue * 2
void doubled

const throwUserInputFromErrors: (messageForUser: string) => never = Errors.throwUserInput
const throwUnexpectedFromErrors: (messageForUser: string) => never = Errors.throwUnexpected
void throwUserInputFromErrors
void throwUnexpectedFromErrors

type Item =
  | { $type: 'text'; value: string; mode: 'read' }
  | { $type: 'count'; value: number; mode: 'write' }

declare const item: Item

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

declare const optionalItem: Item | undefined
const maybeRendered: string = Switch.typeMaybe(optionalItem, {
  text: text => text.value,
  count: count => count.value.toString(),
  undefined: () => 'missing',
})
void maybeRendered

// @ts-expect-error Missing the count handler must remain a type error.
Switch.type(item, {
  text: text => text.value,
})

// @ts-expect-error Missing the undefined handler must remain a type error.
Switch.typeMaybe(optionalItem, {
  text: text => text.value,
  count: count => count.value.toString(),
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

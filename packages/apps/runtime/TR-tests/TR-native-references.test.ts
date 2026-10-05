import TR from '@runtime/TR'
import { UserInputError } from '@runtime/TR-errors'
import {
  createNativeReferenceGroup,
  createNativeReferenceType,
  type NativeReferenceType,
} from '@runtime/TR-native-references'
import { Describe, Expect, Test } from '@shared/test'

class NativeFile {
  #text = 'before'
  lifecycleCalls: string[] = []

  get text() {
    return this.#text
  }
  set text(value: string) {
    this.#text = value
  }
  append(suffix: string) {
    this.#text += suffix
    return this.#text
  }
  *[Symbol.iterator]() {
    yield this.#text
  }
  close() {
    this.lifecycleCalls.push('close')
  }
  release() {
    this.lifecycleCalls.push('release')
  }
  delete() {
    this.lifecycleCalls.push('delete')
  }
  cancel() {
    this.lifecycleCalls.push('cancel')
  }
}

const fileType = () => createNativeReferenceType('File', (value): value is NativeFile => value instanceof NativeFile)

class NativePhoto extends NativeFile {}

function referenceFamily() {
  const group = createNativeReferenceGroup()
  const File = group.define('File', (value): value is NativeFile => value instanceof NativeFile)
  const Writable = group.define(
    'Writable',
    (value): value is { append(suffix: string): string } => value instanceof NativeFile,
  )
  const Photo = group.define('Photo', (value): value is NativePhoto => value instanceof NativePhoto, [File, Writable])
  const Sibling = group.define('File', (value): value is NativeFile => value instanceof NativeFile)
  return { group, File, Writable, Photo, Sibling }
}

Describe('native references', () => {
  Test('retains object identity per descriptor even when display names match', () => {
    const first = fileType()
    const second = fileType()
    const native = new NativeFile()
    const reference = first.wrap(native)

    const widened: TR.NativeReference<unknown> = reference
    // @ts-expect-error An arbitrary boxed value must not become a typed native File reference.
    const invalidNarrowing: TR.NativeReference<NativeFile> = widened
    void invalidNarrowing

    Expect(first.wrap(native)).toBe(reference)
    Expect(first.unwrap(reference)).toBe(native)
    Expect(second.wrap(native)).not.toBe(reference)
    Expect(() => second.unwrap(reference)).toThrow(UserInputError)
    Expect(() => second.release(reference)).toThrow(UserInputError)
    Expect(first.unwrap(reference)).toBe(native)
  })

  Test('rejects invalid native values and forged handles', () => {
    const type = fileType()
    const reference = type.wrap(new NativeFile())
    const forged = Object.create(Object.getPrototypeOf(reference))

    Expect(() => type.wrap({} as NativeFile)).toThrow('The native value is not valid for File.')
    Expect(() => type.unwrap(forged)).toThrow(UserInputError)
    Expect(() => type.release(forged)).toThrow(UserInputError)
    Expect(() => type.unwrap({})).toThrow(UserInputError)
    Expect(() => type.unwrap(null)).toThrow(UserInputError)
    Expect(Object.keys(reference)).toEqual([])
    Expect(Reflect.ownKeys(reference)).toEqual([])
  })

  Test('preserves private method receivers and reads changing getters', () => {
    const type = fileType()
    const native = new NativeFile()
    const reference = type.wrap(native)

    Expect(type.get(reference, 'text')).toBe('before')
    native.text = 'changed'
    Expect(type.get(reference, 'text')).toBe('changed')
    type.set(reference, 'text', 'written')
    Expect(native.text).toBe('written')
    Expect(type.invoke(reference, 'append', ['!'])).toBe('written!')
    Expect(type.get(reference, 'text')).toBe('written!')
    Expect(() => type.invoke(reference, 'text', [])).toThrow(UserInputError)
    Expect(() => type.invoke(reference, 'missing', [])).toThrow(UserInputError)
    Object.defineProperty(native, 'fixed', { value: 1 })
    Expect(() => type.set(reference, 'fixed', 2)).toThrow(UserInputError)
  })

  Test('preserves symbol method receivers and reports unavailable symbol members', () => {
    const type = fileType()
    const native = new NativeFile()
    const reference = type.wrap(native)
    const iterator = type.invoke(reference, Symbol.iterator, []) as Iterator<string>

    Expect(iterator.next()).toEqual({ value: 'before', done: false })
    Expect(type.get(reference, Symbol.iterator)).toBe(native[Symbol.iterator])
    Expect(() => type.invoke(reference, Symbol.toPrimitive, [])).toThrow(
      "native method 'Symbol(Symbol.toPrimitive)' is not available.",
    )
    Object.defineProperty(native, Symbol.toStringTag, { value: 'NativeFile' })
    Expect(() => type.set(reference, Symbol.toStringTag, 'Changed')).toThrow(
      "native property 'Symbol(Symbol.toStringTag)' cannot be changed.",
    )
  })

  Test('expires only the wrapper and allows a fresh reference to the same native value', () => {
    const type = fileType()
    const native = new NativeFile()
    const reference = type.wrap(native)

    type.release(reference)
    type.release(reference)
    Expect(() => fileType().release(reference)).toThrow(UserInputError)
    Expect(native.lifecycleCalls).toEqual([])
    Expect(() => type.unwrap(reference)).toThrow('This File native reference has been released.')
    Expect(() => type.get(reference, 'text')).toThrow(UserInputError)
    Expect(() => type.set(reference, 'text', 'after')).toThrow(UserInputError)
    Expect(() => type.invoke(reference, 'append', ['!'])).toThrow(UserInputError)
    const fresh = type.wrap(native)
    Expect(fresh).not.toBe(reference)
    Expect(type.unwrap(fresh)).toBe(native)
    type.release(reference)
    Expect(type.wrap(native)).toBe(fresh)
  })

  Test('rejects JSON serialization directly and inside ordinary structures', () => {
    const type = fileType()
    const reference = type.wrap(new NativeFile())

    Expect(() => JSON.stringify(reference)).toThrow(UserInputError)
    Expect(() => JSON.stringify({ file: reference })).toThrow('A native reference cannot be serialized.')
    type.release(reference)
    Expect(() => JSON.stringify(reference)).toThrow(UserInputError)
  })

  Test('keeps wrapper identity when ordinary runtime structures are copied', () => {
    const reference = fileType().wrap(new NativeFile())
    const source = { details: { file: reference } }
    const copy = TR.Copy(TR.Value(source)).evaluate().jsValue

    Expect(copy).not.toBe(source)
    Expect(copy.details).not.toBe(source.details)
    Expect(copy.details.file).toBe(reference)
    Expect(TR.Copy(TR.Value(reference)).evaluate().jsValue).toBe(reference)
  })

  Test('canonicalizes function payloads and boxes primitives without scalar interning', () => {
    const functions = createNativeReferenceType(
      'Callback',
      (value): value is () => string => typeof value === 'function',
    )
    const callback = () => 'called'
    const reference = functions.wrap(callback)
    Expect(functions.wrap(callback)).toBe(reference)
    Expect(functions.invoke(reference, 'call', [undefined])).toBe('called')
    functions.release(reference)
    Expect(functions.unwrap(functions.wrap(callback))).toBe(callback)

    const numbers = createNativeReferenceType('Number', (value): value is number => typeof value === 'number')
    const first = numbers.wrap(42)
    Expect(numbers.wrap(42)).not.toBe(first)
    Expect(numbers.unwrap(first)).toBe(42)
    Expect(numbers.invoke(first, 'toFixed', [1])).toBe('42.0')
  })

  Test('shares a checked derived handle with its nominal base and protocol', () => {
    const { File, Writable, Photo, Sibling } = referenceFamily()
    const native = new NativePhoto()
    const reference = Photo.wrap(native)

    Expect(File.wrap(native)).toBe(reference)
    Expect(Writable.wrap(native)).toBe(reference)
    Expect(File.unwrap(reference)).toBe(native)
    Expect(Writable.invoke(reference, 'append', ['!'])).toBe('before!')
    Expect(Photo.unwrap(reference).text).toBe('before!')
    Expect(Sibling.is(reference)).toBe(false)
    Expect(() => Sibling.unwrap(reference)).toThrow(UserInputError)
    Expect(() => Sibling.release(reference)).toThrow(UserInputError)
  })

  Test('adds derived and protocol membership only after an explicit checked wrap', () => {
    const { File, Writable, Photo } = referenceFamily()
    const native = new NativePhoto()
    const reference = File.wrap(native)

    Expect(File.is(reference)).toBe(true)
    Expect(Photo.is(reference)).toBe(false)
    Expect(Writable.is(reference)).toBe(false)
    Expect(() => Photo.unwrap(reference)).toThrow(UserInputError)
    Expect(() => Photo.wrap(reference as unknown as NativePhoto)).toThrow(UserInputError)
    Expect(Photo.wrap(native)).toBe(reference)
    Expect(Photo.is(reference)).toBe(true)
    Expect(Writable.is(reference)).toBe(true)
    Expect(Photo.unwrap(reference)).toBe(native)
  })

  Test('checks parent predicates before adding any new memberships', () => {
    const { group, File } = referenceFamily()
    const Before = group.define(
      'Before',
      (value): value is NativeFile => value instanceof NativeFile && value.text === 'before',
    )
    const Photo = group.define('Photo', (value): value is NativePhoto => value instanceof NativePhoto, [File, Before])
    const native = new NativePhoto()
    const reference = File.wrap(native)
    native.text = 'changed'

    Expect(() => Photo.wrap(native)).toThrow('The native value is not valid for Before.')
    Expect(Photo.is(reference)).toBe(false)
    Expect(Before.is(reference)).toBe(false)
    Expect(File.unwrap(reference)).toBe(native)
    native.text = 'before'
    Expect(Photo.wrap(native)).toBe(reference)
    Expect(Before.unwrap(reference)).toBe(native)
  })

  Test('rejects foreign groups and preserves captured ancestry against parent-list mutation', () => {
    const { group, Photo } = referenceFamily()
    const foreign = referenceFamily()
    const native = new NativePhoto()
    const reference = Photo.wrap(native)

    Expect(foreign.Photo.wrap(native)).not.toBe(reference)
    Expect(foreign.Photo.is(reference)).toBe(false)
    Expect(() => foreign.Photo.unwrap(reference)).toThrow(UserInputError)
    Expect(() =>
      group.define('ForeignChild', (value): value is NativePhoto => value instanceof NativePhoto, [foreign.File])
    ).toThrow('must belong to the same group')

    const parents: NativeReferenceType<unknown>[] = []
    const Base = group.define('Base', (value): value is NativeFile => value instanceof NativeFile, parents)
    const Derived = group.define('Derived', (value): value is NativePhoto => value instanceof NativePhoto, [Base])
    parents.push(Derived)
    const Leaf = group.define('Leaf', (value): value is NativePhoto => value instanceof NativePhoto, [Derived])
    const leaf = Leaf.wrap(native)
    Expect(Base.unwrap(leaf)).toBe(native)
    Expect(Derived.unwrap(leaf)).toBe(native)
  })

  Test('releases every checked view while keeping fresh handles isolated from old release calls', () => {
    const { File, Writable, Photo, Sibling } = referenceFamily()
    const native = new NativePhoto()
    const reference = Photo.wrap(native)
    Writable.release(reference)

    for (const descriptor of [File, Writable, Photo]) {
      Expect(descriptor.is(reference)).toBe(false)
      Expect(() => descriptor.unwrap(reference)).toThrow('native reference has been released.')
      Expect(() => descriptor.release(reference)).not.toThrow()
    }
    Expect(() => Sibling.release(reference)).toThrow(UserInputError)
    Expect(native.lifecycleCalls).toEqual([])
    const fresh = File.wrap(native)
    Expect(fresh).not.toBe(reference)
    Expect(Photo.is(fresh)).toBe(false)
    Photo.release(reference)
    Expect(File.unwrap(fresh)).toBe(native)
    Expect(Photo.wrap(native)).toBe(fresh)
  })

  Test('inspects live memberships without reading or coercing raw payloads', () => {
    const { File, Photo } = referenceFamily()
    const native = new NativePhoto()
    let reads = 0
    Object.defineProperty(native, 'text', {
      get() {
        reads += 1
        return 'before'
      },
    })
    const reference = Photo.wrap(native)
    const forged = Object.create(Object.getPrototypeOf(reference))

    Expect(File.is(reference)).toBe(true)
    Expect(Photo.is(native)).toBe(false)
    Expect(Photo.is(forged)).toBe(false)
    Expect(Photo.is(null)).toBe(false)
    Expect(Photo.is('Photo')).toBe(false)
    Expect(reads).toBe(0)
    Photo.release(reference)
    Expect(Photo.is(reference)).toBe(false)
    Expect(reads).toBe(0)
  })
})

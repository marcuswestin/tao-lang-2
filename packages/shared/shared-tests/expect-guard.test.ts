import { Describe, Expect, Test } from '@shared/test'
import { Errors } from '../shared-src/shared'

/**
 * Bun's formatter prints a value once per path that reaches it, so a Langium AST node — reachable
 * through `$container`, `$document` and `$cstNode` at every level — expands exponentially when a
 * deep-equality matcher reports a difference. One `expect([nodeA]).toEqual([nodeB])` went from
 * 185 MB to 4.1 GB in two seconds and took a 128 GB machine out of application memory. These tests
 * use a hand-built node-shaped object: nothing here may reproduce the runaway itself.
 */
function langiumShaped(type = 'Foo'): Record<string, unknown> {
  const node: Record<string, unknown> = { $type: type, name: 'value' }
  node['$container'] = { $type: 'Container', members: [node] }
  node['$cstNode'] = { offset: 0, text: 'value' }
  return node
}

const GUARDED = [
  'toContainEqual',
  'toEqual',
  'toMatchInlineSnapshot',
  'toMatchObject',
  'toMatchSnapshot',
  'toStrictEqual',
] as const

Describe('Expect Langium guard', () => {
  Test('every guarded matcher refuses a Langium-shaped received value', () => {
    for (const matcher of GUARDED) {
      Expect(() => (Expect(langiumShaped()) as Record<string, (value: unknown) => void>)[matcher]?.({}))
        .toThrow(new RegExp(`Expect\\(\\.\\.\\.\\)\\.${matcher} refuses a Langium AST node`, 'u'))
    }
  })

  Test('a guarded matcher refuses a Langium-shaped expected argument too', () => {
    Expect(() => Expect({ name: 'value' }).toEqual(langiumShaped())).toThrow(/refuses a Langium AST node/u)
    Expect(() => Expect([{ name: 'value' }]).toContainEqual(langiumShaped())).toThrow(/refuses a Langium AST/u)
  })

  Test('the refusal names the matcher, the cause, and what to do instead', () => {
    Expect(() => Expect([langiumShaped()]).toEqual([langiumShaped()])).toThrow(/Expect\(\.\.\.\)\.toEqual/u)
    Expect(() => Expect([langiumShaped()]).toEqual([langiumShaped()])).toThrow(/once per path/u)
    Expect(() => Expect([langiumShaped()]).toEqual([langiumShaped()])).toThrow(/128 GB machine/u)
    Expect(() => Expect([langiumShaped()]).toEqual([langiumShaped()])).toThrow(/toHaveLength/u)
    Expect(() => Expect([langiumShaped()]).toEqual([langiumShaped()])).toThrow(/Expect\.Unguarded/u)
  })

  Test('the guard holds through the .not chain', () => {
    Expect(() => Expect(langiumShaped()).not.toEqual({})).toThrow(/refuses a Langium AST node/u)
    Expect(() => Expect({}).not.toMatchObject(langiumShaped())).toThrow(/refuses a Langium AST node/u)
  })

  Test('the guard holds through the .resolves and .rejects chains', async () => {
    const node = langiumShaped()
    const rejected = Promise.reject(new Errors.UnexpectedBehaviorError('never observed'))
    rejected.catch(() => undefined)

    Expect(() => Expect(Promise.resolve(node)).resolves.toEqual(node)).toThrow(/refuses a Langium AST node/u)
    Expect(() => Expect(rejected).rejects.toEqual(node)).toThrow(/refuses a Langium AST node/u)
    // Ordinary async chains keep working.
    await Expect(Promise.resolve(3)).resolves.toBe(3)
  })

  Test('a value reachable only through $container is not itself refused', () => {
    // The guard never follows $container: recursing into the multiply reachable links is the very
    // thing that explodes, so a wrapper two levels above a node compares normally.
    Expect({ outer: { inner: { holder: langiumShaped() } } }).toEqual({
      outer: { inner: { holder: Expect['any'](Object) } },
    })
  })

  Test('$type alone, without $container or $cstNode, is not Langium-shaped', () => {
    Expect({ $type: 'Foo', name: 'value' }).toEqual({ $type: 'Foo', name: 'value' })
  })

  Test('ordinary objects and arrays are still compared normally', () => {
    Expect({ items: [1, 2, 3], name: 'plain' }).toEqual({ items: [1, 2, 3], name: 'plain' })
    Expect([{ name: 'a' }, { name: 'b' }]).toStrictEqual([{ name: 'a' }, { name: 'b' }])
    Expect({ nested: { deep: true } }).toMatchObject({ nested: { deep: true } })
    Expect([{ id: 1 }]).toContainEqual({ id: 1 })
    Expect({ a: 1 }).not.toEqual({ a: 2 })
  })

  Test('unguarded matchers still work on a Langium-shaped value', () => {
    const node = langiumShaped('Member')

    Expect(node['$type']).toBe('Member')
    Expect([node]).toHaveLength(1)
    Expect([node].map(entry => entry['name'])).toEqual(['value'])
    Expect(node).toHaveProperty('$cstNode')
  })

  Test('Expect.Unguarded lets structural equality through', () => {
    const node = langiumShaped()

    Expect.Unguarded(node).toEqual(node)
    Expect.Unguarded([node]).toContainEqual(node)
    Expect.Unguarded(node).not.toEqual({ $type: 'Other' })
  })

  Test('the runner statics survive the wrapper', () => {
    Expect({ id: 7, name: 'plain' }).toEqual({ id: Expect['any'](Number), name: 'plain' })
    Expect({ id: 7, name: 'plain' }).toEqual(Expect['objectContaining']({ name: 'plain' }))
    Expect({ name: 'plain text' }).toEqual({ name: Expect['stringContaining']('plain') })
    Expect(typeof Expect['any']).toBe('function')
    Expect(typeof Expect['objectContaining']).toBe('function')
    Expect(typeof Expect['stringContaining']).toBe('function')
  })

  Test('Expect.Is still narrows through the wrapper', () => {
    const value: unknown = 'text'

    Expect.Is(value, (candidate): candidate is string => typeof candidate === 'string')

    Expect(value.toUpperCase()).toBe('TEXT')
  })
})

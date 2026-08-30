import { Describe, Expect, Test } from '@shared/test'
import TR from '../TaoRuntime-src/TR'
import { canonicalDescriptor, declarationIdentity, fnv1a } from '../TaoRuntime-src/TR-navigation-identity'
import { configuredStack } from './TR-navigation-test-fixtures'

const viewIdentity = declarationIdentity([
  'tao.declaration',
  1,
  'cookbook',
  '@widgets',
  'Status',
  'view',
  'StatusBadge',
])

Describe('canonical navigation identity', () => {
  Test('uses the exact owner-relative declaration tuple and stable FNV-1a vectors', () => {
    Expect(viewIdentity.canonical).toBe(
      '["tao.declaration",1,"cookbook","@widgets","Status","view","StatusBadge"]',
    )
    Expect(fnv1a('')).toBe(0x811c9dc5)
    Expect(fnv1a('hello')).toBe(0x4f9f2cab)
  })

  Test('canonicalizes configured values structurally and confirms equality beyond the hash', () => {
    const first = canonicalDescriptor(viewIdentity, {
      Count: { evaluate: () => ({ jsValue: 0 }) },
      Label: { evaluate: () => ({ jsValue: 'Ready' }) },
    })
    const second = canonicalDescriptor(viewIdentity, {
      Label: { evaluate: () => ({ jsValue: 'Ready' }) },
      Count: { evaluate: () => ({ jsValue: -0 }) },
    })

    Expect(first.hash).toBe(second.hash)
    Expect(first.canonical).toBe(second.canonical)
  })

  Test('rejects unsupported and cyclic host values instead of using object identity', () => {
    Expect(() => canonicalDescriptor(viewIdentity, { Action: () => {} })).toThrow('function')
    const cyclic: Record<string, unknown> = {}
    cyclic['Self'] = cyclic
    Expect(() => canonicalDescriptor(viewIdentity, cyclic)).toThrow('cycle')
  })

  Test('scopes persisted entity tokens to the complete configured provider binding', () => {
    const declaration = TR.Data.Declaration(
      'ScopedMemory',
      { connect: () => ({ load: () => undefined, save: () => {} }) },
      TR.Navigation.Identity([
        'tao.declaration',
        1,
        'cookbook',
        '@workspace',
        'App',
        'datasource',
        'ScopedMemory',
      ]),
    )
    const first = TR.Data.Configure(declaration, { Namespace: TR.Value('first') })
    const firstAgain = TR.Data.Configure(declaration, { Namespace: TR.Value('first') })
    const second = TR.Data.Configure(declaration, { Namespace: TR.Value('second') })
    const opaque = TR.Data.Configure(declaration, { Callback: TR.Action(() => {}) })

    Expect(first.bindingIdentity()).toBe(firstAgain.bindingIdentity())
    Expect(first.bindingIdentity()).not.toBe(second.bindingIdentity())
    Expect(opaque.bindingIdentity()).toBeUndefined()
  })

  Test('keeps re-evaluated module view closures local to their app generation', () => {
    const identity = TR.Navigation.Identity([
      'tao.declaration',
      1,
      'hot-reload',
      '@workspace',
      'App',
      'view',
      'Home',
    ])
    const first = TR.Navigation.View({ identity, name: 'Home', render: () => 'first' })
    const firstApp = TR.Navigation.App({
      auxiliaries: () => ({}),
      name: 'First',
      navigator: () => configuredStack('First', TR.Navigation.ViewReference(identity)),
    })
    const second = TR.Navigation.View({ identity, name: 'Home', render: () => 'second' })
    const secondApp = TR.Navigation.App({
      auxiliaries: () => ({}),
      name: 'Second',
      navigator: () => configuredStack('Second', TR.Navigation.ViewReference(identity)),
    })

    Expect(second).not.toBe(first)
    Expect(firstApp.resolvePresentable(identity.canonical).render({})).toBe('first')
    Expect(secondApp.resolvePresentable(identity.canonical).render({})).toBe('second')
  })
})

import TR from '@runtime/TR'
import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import type { TaoEvaluable } from '../TaoRuntime-src/TR-action-values'
import { RuntimeAssert } from '../TaoRuntime-src/TR-assert'
import type { TaoCapability } from '../TaoRuntime-src/TR-capabilities'
import { UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'
import { getJSValue } from '../TaoRuntime-src/TR-js-value'
import { completeRuntimeValue } from '../TaoRuntime-src/TR-reactive-values'

const capabilities = TR.Capability

Describe('Capability witnesses', () => {
  Test('retains selected live behavior in item fields and writable field reads', () => {
    const source = TR.Cell(TR.Value('Before'))
    const carrier = capabilities.attach(source, {
      text: TR.Function((receiver: TaoEvaluable<string>) => TR.Value(`Value:${getJSValue(receiver)}`)),
    })
    const row = TR.Value({ Content: capabilities.storedValue(carrier), Count: capabilities.storedValue(TR.Value(2)) })
    const writable = TR.Cell(row)
    for (const owner of [row, writable]) {
      const field = capabilities.read(TR.Member(owner, ['Content']))
      Expect(field).toBe(carrier)
      Expect(TR.Call<string>(capabilities.method(field, 'text')).getJSValue()).toBe('Value:Before')
      Expect(TR.Member(owner, ['Count']).getJSValue()).toBe(2)
    }
    source.set(TR.Value('After'))
    Expect(TR.Call<string>(capabilities.method(capabilities.read(TR.Member(row, ['Content'])), 'text')).getJSValue())
      .toBe('Value:After')
    const replacement = capabilities.attach(TR.Value('Replacement'), {
      text: TR.Function((receiver: TaoEvaluable<string>) => TR.Value(`New:${getJSValue(receiver)}`)),
    })
    const writableContent = TR.Member(writable, ['Content']) as TR.Writable<string>
    writableContent.set(replacement)
    Expect(
      TR.Call<string>(capabilities.method(capabilities.read(TR.Member(writable, ['Content'])), 'text')).getJSValue(),
    )
      .toBe('New:Replacement')
    Expect(TR.Call<string>(capabilities.method(capabilities.read(TR.Member(row, ['Content'])), 'text')).getJSValue())
      .toBe('Value:After')
  })

  Test('hands back the original live entity source for a concrete witness after keyed transport', async () => {
    const schema = TR.Data.Schema({
      name: 'SlotBooks',
      schemaVersion: 1,
      entities: { Book: { collection: 'Books', fields: { Title: { kind: 'text' } } } },
    }, { load: () => undefined, save: () => {} })
    await TR.Data.Settle(schema)
    TR.Data.Create(schema, 'Book', { Title: TR.Value('Before') })
    const book = schema.query({ entity: 'Book', filters: [] })[0]!
    const id = TR.Data.NativeEntityContext(book).id
    const source = TR.Value(book)
    const keyed = capabilities.attach(source, {
      Key: TR.Function((receiver: typeof source) => {
        Expect(receiver).toBe(source)
        return TR.Value(id)
      }),
    })
    const forwarded = capabilities.reproject(keyed, { Key: 'Key' })
    Expect(TR.Call(capabilities.method(forwarded, 'Key')).getJSValue()).toBe(id)
    const concrete = capabilities.concreteSource(forwarded)
    Expect(concrete).toBe(source)
    Expect(concrete.evaluate().jsValue).toBe(book)
    Expect(capabilities.concreteSource(source)).toBe(source)
    const rendered = capabilities.attach(concrete, {
      Render: TR.Function((receiver: typeof source) => {
        Expect(receiver).toBe(source)
        return TR.Value(TR.Data.Read(receiver.evaluate().jsValue, 'Title'))
      }),
    })
    const render = capabilities.method(rendered, 'Render')
    Expect(TR.Call(render).getJSValue()).toBe('Before')
    TR.Data.Update(source, { Title: TR.Value('After') })
    await TR.Data.Settle(schema)
    Expect(TR.Call(render).getJSValue()).toBe('After')
    Expect(schema.query({ entity: 'Book', filters: [] })[0]).toBe(book)
    Expect(() => capabilities.attach(forwarded, {})).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.method(forwarded, 'Render')).toThrow(UnexpectedBehaviorError)
  })

  Test('rejects ordinary values and copied carrier backing at a checked capability read', () => {
    const carrier = capabilities.attach(TR.Value('Original'), {})
    Expect(capabilities.read(carrier)).toBe(carrier)
    Expect(() => capabilities.read(TR.Value('Original'))).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.read(TR.Value({ ...carrier }))).toThrow(UnexpectedBehaviorError)
  })

  Test('rebinds selected adapted witnesses to a new live Self result without reading or changing the donor', () => {
    const original = TR.Cell(TR.Value('Original'))
    const replacement = TR.Cell(TR.Value('Replacement'))
    let reads = 0
    const source = TR.Alias(() => {
      reads += 1
      return replacement.evaluate()
    })
    const donor = capabilities.attach(original, {
      display: TR.Function((receiver: TaoEvaluable<string>, suffix: TaoEvaluable<string>) =>
        TR.Value(`${getJSValue(receiver)}${getJSValue(suffix)}`)
      ),
      clone: TR.Function((receiver: TaoEvaluable<string>) => {
        Expect(receiver).toBe(source)
        return receiver
      }),
    })
    const projected = capabilities.reproject(donor, { text: 'display', clone: 'clone' }, {
      text: selected => TR.Function((receiver: TR.Evaluable) => selected.invoke(receiver, TR.Value('!'))),
    })
    const rebound = capabilities.rebind(projected, source)
    const text = capabilities.method(rebound, 'text')
    Expect(reads).toBe(0)
    Expect(TR.Call<string>(text).getJSValue()).toBe('Replacement!')
    Expect(TR.Call<string>(capabilities.method(rebound, 'clone')).getJSValue()).toBe('Replacement')
    replacement.set(TR.Value('Changed'))
    Expect(TR.Call<string>(text).getJSValue()).toBe('Changed!')
    Expect(TR.Call<string>(capabilities.method(projected, 'text')).getJSValue()).toBe('Original!')
    Expect(() => capabilities.method(rebound, 'display')).toThrow(UnexpectedBehaviorError)
    Expect(Object.getOwnPropertySymbols(rebound)).toEqual([])
  })

  Test('unwraps an owned result carrier and rejects counterfeit rebind inputs without getter probes', () => {
    const source = TR.Value('New')
    const donor = capabilities.attach(TR.Value('Old'), {
      identity: TR.Function((receiver: TaoEvaluable<string>) => receiver),
    })
    const wrapped = capabilities.attach(source, {})
    const rebound = capabilities.rebind(donor, wrapped)
    Expect(TR.Call<string>(capabilities.method(rebound, 'identity'))).toBe(source)
    let probes = 0
    const counterfeit = {
      get evaluate() {
        probes += 1
        return () => TR.Value('Counterfeit')
      },
    } as unknown as TaoCapability<string>
    Expect(() => capabilities.rebind(counterfeit, source)).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.rebind(donor, counterfeit)).toThrow(UnexpectedBehaviorError)
    Expect(probes).toBe(0)
  })
  Test('selects legitimate receiver facades once and retains the selected live concrete source', () => {
    let current = 'Before'
    let sourceReads = 0
    const source: TaoEvaluable<string> = {
      evaluate() {
        sourceReads += 1
        return TR.Value(current)
      },
    }
    const carrier = capabilities.attach(source, {
      display: TR.Function((receiver: TaoEvaluable<string>) => {
        Expect(receiver).toBe(source)
        return TR.Value(`Original:${getJSValue(receiver)}`)
      }),
    })
    const replacement = capabilities.attach(TR.Value('Replacement'), {
      display: TR.Function(() => TR.Value('Replacement')),
    })
    let selected = carrier
    let selections = 0
    let evaluationAccesses = 0
    const receiver: TaoEvaluable<string> = {
      get evaluate() {
        evaluationAccesses += 1
        return () => {
          selections += 1
          return selected
        }
      },
    }
    const legacy = capabilities.method(receiver, 'display')
    const completed = capabilities.method(completeRuntimeValue(receiver), 'display')
    const alias = capabilities.method(
      TR.Alias(() => {
        selections += 1
        return selected
      }),
      'display',
    )
    Expect([sourceReads, selections, evaluationAccesses]).toEqual([0, 3, 2])
    selected = replacement
    current = 'After'
    for (const held of [legacy, completed, alias]) {
      Expect(TR.Call<string>(held).getJSValue()).toBe('Original:After')
    }
    Expect([sourceReads, selections, evaluationAccesses]).toEqual([3, 3, 2])
    Expect(TR.Call<string>(capabilities.method(receiver, 'display')).getJSValue()).toBe('Replacement')
    Expect(() => capabilities.method(TR.Value(carrier), 'display')).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.method({ evaluate: () => TR.Value('Wrong') }, 'display'))
      .toThrow(UnexpectedBehaviorError)
  })

  Test('typechecks ordinary and complete receiver inputs through the real runtime graph', async () => {
    await withTaoFiles('capability-receiver-inputs', {}, async (_, root) => {
      const program = FS.resolvePath('Check.ts', root)
      await FS.writeText(
        program,
        `
        import TR from ${JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))}
        import type { TaoEvaluable } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-values.ts'))
        }
        import { completeRuntimeValue } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-reactive-values.ts'))
        }
        import { RuntimeAssert } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-assert.ts'))
        }
        const source = TR.Cell(TR.Value('Before'))
        const carrier = TR.Capability.attach(source, {
          display: TR.Function((receiver: TaoEvaluable<string>) => TR.Value(receiver.evaluate().jsValue))
        })
        const ordinary: TaoEvaluable<string> = { evaluate: () => carrier }
        const complete = completeRuntimeValue(ordinary)
        const held = [ordinary, complete, TR.Alias(() => carrier)]
          .map(receiver => TR.Capability.method(receiver, 'display'))
        source.set(TR.Value('After'))
        RuntimeAssert(held.every(method => TR.Call<string>(method).getJSValue() === 'After'), 'live receivers retained')
        const row = TR.Cell(TR.Value({ Content: 'Before' }))
        const field = TR.Member(row, ['Content'])
        RuntimeAssert.defined(field.set, 'a writable content field')
        field.set(TR.Value('After'))
        RuntimeAssert(field.getJSValue() === 'After', 'writable member retained')
      `,
      )
      const config = FS.resolvePath('tsconfig.json', root)
      await FS.writeJson(config, {
        extends: Repo.resolvePath('packages/tsconfig.base.json'),
        compilerOptions: {
          allowImportingTsExtensions: true,
          composite: false,
          declaration: false,
          incremental: false,
          jsx: 'react-jsx',
          lib: ['ES2023', 'DOM'],
          noEmit: true,
          rootDir: '/',
          typeRoots: [Repo.resolvePath('node_modules/@types')],
          types: ['bun', 'node'],
        },
        files: [program],
        include: [],
      })
      const checked = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [Repo.resolvePath('node_modules/typescript-native/bin/tsc'), '--project', config],
        processPolicy: 'test',
      })
      Expect({ exitCode: checked.exitCode, stdout: checked.stdout, stderr: checked.stderr })
        .toEqual({ exitCode: 0, stdout: '', stderr: '' })
      const executed = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: executed.exitCode, stdout: executed.stdout, stderr: executed.stderr })
        .toEqual({ exitCode: 0, stdout: '', stderr: '' })
    })
  })

  Test('keeps receiver backing private so public property writes cannot diverge from selected witnesses', () => {
    const source = TR.Cell(TR.Value('Original'))
    const carrier = capabilities.attach(source, {
      display: TR.Function((receiver: TaoEvaluable<string>) => {
        Expect(receiver).toBe(source)
        return TR.Value(`Token:${getJSValue(receiver)}`)
      }),
    })
    const held = capabilities.method(carrier, 'display')
    Expect(Object.getOwnPropertyNames(carrier)).toEqual([])
    Expect(Object.getOwnPropertySymbols(carrier)).toEqual([])
    Object.assign(carrier, { source: TR.Value('Replacement') })
    Expect(carrier.getJSValue()).toBe('Original')
    Expect(TR.Call<string>(held).getJSValue()).toBe('Token:Original')
    source.set(TR.Value('Changed'))
    Expect(carrier.getJSValue()).toBe('Changed')
    Expect(TR.Call<string>(held).getJSValue()).toBe('Token:Changed')
  })

  Test('attaches, projects and binds legacy sources without getter probes or evaluations', () => {
    let reads = 0
    let evaluationAccesses = 0
    let current = 'Before'
    const source = {
      get evaluate() {
        evaluationAccesses += 1
        return () => {
          reads += 1
          return TR.Value(current)
        }
      },
      get jsValue() {
        RuntimeAssert(false, 'no direct source payload probe')
        return ''
      },
      get getJSValue() {
        RuntimeAssert(false, 'no source accessor probe')
        return undefined
      },
    }
    const display = TR.Function((receiver: TaoEvaluable<string>) => {
      Expect(receiver).toBe(source)
      return TR.Value(`Token:${getJSValue(receiver)}`)
    })
    const carrier = capabilities.attach(source, { display })
    const projected = capabilities.reproject(carrier, { text: 'display' })
    Expect(capabilities.concreteSource(carrier)).toBe(source)
    Expect(capabilities.concreteSource(projected)).toBe(source)
    const held = capabilities.method(projected, 'text')
    Expect(carrier.evaluate()).toBe(carrier)
    Expect(projected.evaluate()).toBe(projected)
    Expect(Object.keys(carrier).includes('jsValue')).toBe(false)
    Expect(Object.keys(projected).includes('jsValue')).toBe(false)
    Expect([reads, evaluationAccesses]).toEqual([0, 0])
    Expect(TR.Call<string>(held).getJSValue()).toBe('Token:Before')
    current = 'After'
    Expect(TR.Call<string>(held).getJSValue()).toBe('Token:After')
    Expect(carrier.jsValue).toBe('After')
    Expect(projected.getJSValue()).toBe('After')
    Expect(getJSValue(projected)).toBe('After')
    Expect([reads, evaluationAccesses]).toEqual([5, 5])
  })

  Test('selects distinct implementations for identical erased payloads', () => {
    const source = TR.Value('Same')
    const token = capabilities.attach(source, {
      display: TR.Function((receiver: TaoEvaluable<string>) => TR.Value(`Token:${getJSValue(receiver)}`)),
    })
    const label = capabilities.attach(source, {
      display: TR.Function((receiver: TaoEvaluable<string>) => TR.Value(`Label:${getJSValue(receiver)}`)),
    })
    Expect(token.getJSValue()).toBe('Same')
    Expect(label.getJSValue()).toBe('Same')
    Expect(TR.Call<string>(capabilities.method(token, 'display')).getJSValue()).toBe('Token:Same')
    Expect(TR.Call<string>(capabilities.method(label, 'display')).getJSValue()).toBe('Label:Same')
  })

  Test('preserves attached and projected carriers through ordinary function arguments and returns', () => {
    const source = TR.Cell(TR.Value('Before'))
    const carrier = capabilities.attach(source, {
      display: TR.Function((receiver: TaoEvaluable<string>, suffix: TaoEvaluable<string>) => {
        Expect(receiver).toBe(source)
        return TR.Value(`Token:${getJSValue(receiver)}${getJSValue(suffix)}`)
      }),
    })
    const projected = capabilities.reproject(carrier, { text: 'display' })
    const relay = TR.Function((value: TaoCapability<string>) => value)
    const returned = TR.Call<string>(relay, projected)
    Expect(completeRuntimeValue(carrier)).toBe(carrier)
    Expect(completeRuntimeValue(projected)).toBe(projected)
    Expect(TR.Call<string>(relay, carrier)).toBe(carrier)
    Expect(returned).toBe(projected)
    const held = capabilities.method(returned, 'text')
    Expect(TR.Call<string>(held, TR.Value('!')).getJSValue()).toBe('Token:Before!')
    source.set(TR.Value('After'))
    Expect(TR.Call<string>(held, TR.Value('?')).getJSValue()).toBe('Token:After?')
    Expect(returned.getJSValue()).toBe('After')
    Expect(returned).toBe(projected)
  })

  Test('reprojects selected witnesses repeatedly while retaining the original receiver and argument order', () => {
    const source = TR.Value('Receiver')
    const first = TR.Value('First')
    const second = TR.Value('Second')
    let calls = 0
    const selected = TR.Function((receiver: TaoEvaluable<string>, a: TR.Value<string>, b: TR.Value<string>) => {
      calls += 1
      Expect(receiver).toBe(source)
      Expect(a).toBe(first)
      Expect(b).toBe(second)
      return TR.Value(`${getJSValue(receiver)}:${a.getJSValue()}:${b.getJSValue()}`)
    })
    const carrier = capabilities.attach(source, { selected, omitted: TR.Function(() => TR.Value('Unused')) })
    const projected = capabilities.reproject(carrier, { renamed: 'selected', another: 'selected' })
    const again = capabilities.reproject(projected, { final: 'renamed' })
    Expect(projected === carrier).toBe(false)
    Expect(again === projected).toBe(false)
    Expect(calls).toBe(0)
    Expect(TR.Call<string>(capabilities.method(again, 'final'), first, second).getJSValue())
      .toBe('Receiver:First:Second')
    Expect(TR.Call<string>(capabilities.method(projected, 'another'), first, second).getJSValue())
      .toBe('Receiver:First:Second')
    Expect(calls).toBe(2)
    Expect(() => capabilities.method(projected, 'omitted')).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.reproject(again, { restored: 'selected' })).toThrow(UnexpectedBehaviorError)
  })

  Test('retains ordinary callable results when a selected method returns another function or capability', () => {
    const source = TR.Value('Same')
    const nested = TR.Function(() => TR.Value('Nested'))
    const inner = capabilities.attach(source, { display: TR.Function(() => TR.Value('Inner')) })
    const outer = capabilities.attach(source, {
      function: TR.Function(() => nested),
      capability: TR.Function(() => inner),
    })
    const returnedFunction = capabilities.method(outer, 'function').invoke()
    Expect(returnedFunction).toBe(nested)
    Expect(TR.Call<string>(returnedFunction as TR.Function).getJSValue()).toBe('Nested')
    const returnedCapability = TR.Call<string>(capabilities.method(outer, 'capability'))
    Expect(returnedCapability).toBe(inner)
    Expect(TR.Call<string>(capabilities.method(returnedCapability, 'display')).getJSValue())
      .toBe('Inner')
  })

  Test('adapts proved parameter correspondence without sampling the original receiver', () => {
    const source = TR.Cell(TR.Value('Before'))
    const left = TR.Value('Left')
    const right = TR.Value('Right')
    let calls = 0
    const carrier = capabilities.attach(source, {
      selected: TR.Function((receiver: TaoEvaluable<string>, second: TR.Value<string>, first: TR.Value<string>) => {
        calls += 1
        Expect(receiver).toBe(source)
        Expect(first).toBe(left)
        Expect(second).toBe(right)
        return TR.Value(`${getJSValue(receiver)}:${first.getJSValue()}:${second.getJSValue()}`)
      }),
    })
    const adapters = {
      ordered: (selected: TR.Function) =>
        TR.Function((receiver: TR.Evaluable, first: TR.Evaluable, second: TR.Evaluable) =>
          selected.invoke(receiver, second, first)
        ),
    }
    const projected = capabilities.reproject(carrier, { ordered: 'selected' }, adapters)
    adapters.ordered = () => TR.Function(() => TR.Value('Replacement'))
    const again = capabilities.reproject(projected, { final: 'ordered' })
    const held = capabilities.method(again, 'final')
    Expect(calls).toBe(0)
    Expect(TR.Call<string>(held, left, right).getJSValue()).toBe('Before:Left:Right')
    source.set(TR.Value('After'))
    Expect(TR.Call<string>(held, left, right).getJSValue()).toBe('After:Left:Right')
    Expect(calls).toBe(2)
  })

  Test('snapshots selected tables and treats prototype-looking keys as ordinary own requirements', () => {
    const selected = TR.Function(() => TR.Value('Selected'))
    const witnesses = { ['__proto__']: selected, constructor: selected }
    const carrier = capabilities.attach(TR.Value('Same'), witnesses)
    witnesses.constructor = TR.Function(() => TR.Value('Replacement'))
    const projected = capabilities.reproject(carrier, { ['__proto__']: 'constructor' })
    Expect(TR.Call<string>(capabilities.method(carrier, 'constructor')).getJSValue()).toBe('Selected')
    Expect(TR.Call<string>(capabilities.method(carrier, '__proto__')).getJSValue()).toBe('Selected')
    Expect(TR.Call<string>(capabilities.method(projected, '__proto__')).getJSValue()).toBe('Selected')
    Expect(() => capabilities.method(carrier, 'toString')).toThrow(UnexpectedBehaviorError)
  })

  Test('rejects unowned values and invalid selections without inspecting hostile value getters', () => {
    let probes = 0
    const unowned = {
      evaluate() {
        return this
      },
      get jsValue() {
        probes += 1
        RuntimeAssert(false, 'no unowned payload probe')
        return ''
      },
    }
    Expect(() => capabilities.method(unowned, 'display')).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.reproject(unowned as unknown as TaoCapability<string>, {}))
      .toThrow(UnexpectedBehaviorError)
    Expect(probes).toBe(0)
    const carrier = capabilities.attach(TR.Value('Same'), {})
    Expect(() => capabilities.method(carrier, 'missing')).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.reproject(carrier, { text: 'missing' })).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.attach(carrier, {})).toThrow(UnexpectedBehaviorError)
  })
})

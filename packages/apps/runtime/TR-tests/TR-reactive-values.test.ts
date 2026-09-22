import TR from '@runtime/TR'
import { nativeMutationLeaseCandidate } from '@runtime/TR-reactive-values'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoDataConnection, TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'

const noteDefinition: TaoDataSchemaDefinition = {
  name: 'ReactiveCopyNotes',
  entities: {
    Note: {
      collection: 'Notes',
      fields: { Title: { kind: 'text' } },
    },
  },
}

const memoryConnection = (): TaoDataConnection => ({
  load: () => undefined,
  save: () => {},
})

function identity(name: string): TR.DeclarationIdentity {
  return TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'ReactiveValues', 'enum', name])
}

Describe('reactive writable values', () => {
  Test('inspects retained readonly props without reading an inactive provider generation', () => {
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Before') })
    const note = schema.query({ entity: 'Note', filters: [] })[0]
    let reads = 0
    const argument = TR.Readonly<string>(TR.Alias(() => {
      reads += 1
      return TR.Member(TR.Value(note), ['Title'])
    }))

    Expect(argument.jsValue).toBe('Before')
    TR.Data.Update(TR.Value(note), { Title: TR.Value('After') })
    Expect(argument.jsValue).toBe('After')
    Expect('set' in argument).toBe(false)
    schema.configure(memoryConnection())

    // React's development prop diff enumerates retained props after a provider replacement.
    // Inspection must not execute the old argument's live read; explicit evaluation still must.
    Expect(() => Object.assign({}, argument)).not.toThrow()
    Expect(reads).toBe(2)
    Expect(() => argument.evaluate()).toThrow(
      "Entity handle 'Note-1' belongs to an inactive provider generation.",
    )
  })

  Test('reads a copied action cell through its action transaction before committing', async () => {
    const draft = TR.Cell<{ Title: string }>(TR.Value({ Title: 'Before' }))
    const save = TR.Action(() => {
      TR.Set(TR.Member(draft, ['Title']) as TR.Writable<string>, () => TR.Value('After'))
      Expect(draft.evaluate().jsValue).toEqual({ Title: 'After' })
    })

    await save.jsValue.invoke()

    Expect(draft.evaluate().jsValue).toEqual({ Title: 'After' })
  })

  Test('updates one writable item field without dropping its siblings', () => {
    const draft = TR.Cell(TR.Value({ Body: 'Keep', Title: 'Before' }))

    TR.Set(TR.Member(draft, ['Title']) as TR.Writable<string>, () => TR.Value('After'))

    Expect(draft.evaluate().jsValue).toEqual({ Body: 'Keep', Title: 'After' })
  })

  Test('copies ordinary nested structures without sharing their storage', () => {
    const original = { Details: { Labels: ['one'] } }
    const copy = TR.Copy<typeof original>(TR.Value(original))

    original.Details.Labels.push('two')

    Expect(copy.evaluate().jsValue).toEqual({ Details: { Labels: ['one'] } })
  })

  Test('retains direct and nested enum case identities while copying ordinary structure', () => {
    const Status = TR.Enum(identity('CopyStatus'), ['Draft', 'Published'])
    const direct = TR.Copy(Status['Published']!)
    const nested = TR.Copy(TR.Value({ Details: { Status: Status['Published']!.evaluate().jsValue } }))

    Expect(TR.IsCase(direct, Status['Published']!).evaluate().jsValue).toBe(true)
    Expect(TR.IsCase(TR.Member(nested, ['Details', 'Status']), Status['Published']!).evaluate().jsValue).toBe(true)
    Expect(nested.evaluate().jsValue.Details.Status).toBe(Status['Published']!.evaluate().jsValue)
  })

  Test('retains copied action callbacks as invokable runtime values', async () => {
    const received: string[] = []
    const action = TR.Action(() => received.push('called'))
    const copy = TR.Copy(action)

    Expect(copy.evaluate().jsValue).toBe(action.evaluate().jsValue)
    await TR.Do(copy)

    Expect(received).toEqual(['called'])
  })

  Test('copies ordinary structure while retaining a live entity handle', () => {
    const schema = TR.Data.Schema(noteDefinition, memoryConnection())
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Before') })
    const note = schema.query({ entity: 'Note', filters: [] })[0] as Record<string, unknown>
    const copy = TR.Copy(TR.Value({ Details: { Labels: ['one'] }, Note: note }))

    Expect(copy.evaluate().jsValue.Note).toBe(note)
    TR.Data.Update(TR.Value(note), { Title: TR.Value('After') })

    Expect(TR.Member(copy, ['Note', 'Title']).evaluate().jsValue).toBe('After')
    Expect(copy.evaluate().jsValue.Details).toEqual({ Labels: ['one'] })
  })

  Test('rolls back shared mapped and copied writable cells after an action failure', async () => {
    const shared = TR.Cell(TR.Value({ Body: 'Shared body', Title: 'Shared title' }))
    const copied = TR.Cell(TR.Value({ Body: 'Copied body', Title: 'Copied title' }))
    const change = TR.Action((next: TR.Value<{ Body: string; Title: string }>) => TR.Set(shared, () => next))
    const sharedParameter = TR.Mapped(() => shared.evaluate(), change)
    const Failure = TR.Enum(identity('WriteRejected'), ['Rejected'])
    const reject = TR.Action(() => {
      TR.Set(TR.Member(sharedParameter, ['Title']) as TR.Writable<string>, () => TR.Value('Changed shared'))
      TR.Set(TR.Member(copied, ['Title']) as TR.Writable<string>, () => TR.Value('Changed copied'))

      Expect(shared.evaluate().jsValue).toEqual({ Body: 'Shared body', Title: 'Changed shared' })
      Expect(copied.evaluate().jsValue).toEqual({ Body: 'Copied body', Title: 'Changed copied' })
      TR.Fail(Failure['Rejected']!, 'Do not commit drafts.')
    })

    const stop = TR.Errors.onFailure(() => {})
    await reject.evaluate().jsValue.invoke()
    stop()

    Expect(shared.evaluate().jsValue).toEqual({ Body: 'Shared body', Title: 'Shared title' })
    Expect(copied.evaluate().jsValue).toEqual({ Body: 'Copied body', Title: 'Copied title' })
  })

  Test('routes a live native mutation through its Tao action and rejects it after revocation', async () => {
    const received: string[] = []
    const lease = TR.NativeMutationLease(TR.Action((next: TR.Value<string>) => {
      received.push(next.evaluate().jsValue)
    }))

    await lease.set('Saved')
    lease.revoke()

    Expect(received).toEqual(['Saved'])
    Expect(() => lease.set('Late')).toThrow('A native control tried to update a value after it unmounted.')
  })

  Test('keeps an aborted render candidate inert while its committed predecessor stays live', async () => {
    const received: string[] = []
    const committed = nativeMutationLeaseCandidate(
      TR.Action((next: TR.Value<string>) => {
        received.push(`first:${next.evaluate().jsValue}`)
      }).evaluate().jsValue,
    )
    committed.commit(undefined)

    const abandoned = nativeMutationLeaseCandidate(
      TR.Action((next: TR.Value<string>) => {
        received.push(`abandoned:${next.evaluate().jsValue}`)
      }).evaluate().jsValue,
    )

    Expect(() => abandoned.lease.set('during render')).toThrow(
      'A native control tried to update a value after it unmounted.',
    )
    await committed.lease.set('still committed')

    Expect(received).toEqual(['first:still committed'])
  })

  Test('activates a committed replacement and revokes the previous native callback', async () => {
    const received: string[] = []
    const first = nativeMutationLeaseCandidate(
      TR.Action((next: TR.Value<string>) => {
        received.push(`first:${next.evaluate().jsValue}`)
      }).evaluate().jsValue,
    )
    first.commit(undefined)
    const replacement = nativeMutationLeaseCandidate(
      TR.Action((next: TR.Value<string>) => {
        received.push(`next:${next.evaluate().jsValue}`)
      }).evaluate().jsValue,
    )

    replacement.commit(first)

    Expect(() => first.lease.set('late')).toThrow('A native control tried to update a value after it unmounted.')
    await replacement.lease.set('saved')

    Expect(received).toEqual(['next:saved'])
  })
})

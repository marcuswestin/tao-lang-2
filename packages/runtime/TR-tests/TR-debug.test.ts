import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoDataConnection, TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'
import type { TaoDebugEvent } from '../TaoRuntime-src/TR-debug'

const definition: TaoDataSchemaDefinition = {
  name: 'DebugNotes',
  entities: {
    Note: {
      collection: 'Notes',
      fields: { Title: { kind: 'text' } },
    },
  },
}

function recordingSchema(): ReturnType<typeof TR.Data.Schema> {
  const connection: TaoDataConnection = { load: () => undefined, save: () => undefined }
  return TR.Data.Schema(definition, connection)
}

function identity(name: string): TR.DeclarationIdentity {
  return TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'Debug', 'enum', name])
}

function notes(schema: ReturnType<typeof TR.Data.Schema>): number {
  return schema.query({ entity: 'Note', filters: [] }).length
}

/** instrumented mirrors what the compiler emits under `debug: true`: a gate before each statement. */
function instrumented(schema: ReturnType<typeof TR.Data.Schema>) {
  return TR.Action(async () => {
    await TR.Debug.At({ action: 'AddTwo', path: '0' }, {})
    TR.Data.Create(schema, 'Note', { Title: TR.Value('First') })
    await TR.Debug.At({ action: 'AddTwo', path: '1' }, {})
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Second') })
  }, { name: 'AddTwo' })
}

function nextEvent(kind: TaoDebugEvent['kind']): Promise<TaoDebugEvent> {
  return new Promise(resolve => {
    const stop = TR.Debug.onEvent(event => {
      if (event.kind === kind) {
        stop()
        resolve(event)
      }
    })
  })
}

Describe('Tao debugger', () => {
  Test('runs an instrumented body straight through with no breakpoint set', async () => {
    TR.Debug.Reset()
    const schema = recordingSchema()
    await instrumented(schema).jsValue.invoke()
    Expect(notes(schema)).toBe(2)
    Expect(TR.Debug.Paused()).toBeUndefined()
    const entry = TR.Debug.Journal().at(-1)
    Expect(entry?.action).toBe('AddTwo')
    Expect(entry?.outcome).toBe('committed')
  })

  Test('pauses at a breakpoint, keeps the overlay private while paused, then steps and continues', async () => {
    TR.Debug.Reset()
    const schema = recordingSchema()
    TR.Debug.Configure({ steps: [{ action: 'AddTwo', path: '1' }] })

    const pausedEvent = nextEvent('paused')
    const pending = instrumented(schema).jsValue.invoke()
    const event = await pausedEvent
    Expect(event.kind === 'paused' && event.pause.step.path).toBe('1')
    Expect(TR.Debug.Paused()?.frames).toEqual(['AddTwo'])
    // The first statement wrote to the overlay, but a read from outside the paused root sees the
    // committed store: nothing has been published.
    Expect(notes(schema)).toBe(0)
    Expect(TR.Debug.Journal().at(-1)?.outcome).toBe('running')
    // The pause describes the row the first statement created as a pending data write.
    const writes = TR.Debug.Paused()?.pendingWrites ?? []
    Expect(writes).toHaveLength(1)
    Expect(writes[0]?.kind).toBe('data')
    Expect(writes[0]?.committed).toBeUndefined()
    Expect((writes[0]?.pending as { Title?: string } | undefined)?.Title).toBe('First')

    TR.Debug.Continue()
    await pending
    Expect(TR.Debug.Paused()).toBeUndefined()
    Expect(notes(schema)).toBe(2)
    Expect(TR.Debug.Journal().at(-1)?.outcome).toBe('committed')
  })

  Test('step over stops at the next statement of the same frame', async () => {
    TR.Debug.Reset()
    const schema = recordingSchema()
    TR.Debug.Configure({ steps: [{ action: 'AddTwo', path: '0' }] })

    const first = nextEvent('paused')
    const pending = instrumented(schema).jsValue.invoke()
    await first
    Expect(TR.Debug.Paused()?.step.path).toBe('0')

    const second = nextEvent('paused')
    TR.Debug.Step('over')
    await second
    Expect(TR.Debug.Paused()?.step.path).toBe('1')
    Expect(notes(schema)).toBe(0)

    TR.Debug.Continue()
    await pending
    Expect(notes(schema)).toBe(2)
  })

  Test('an action-entry breakpoint pauses before the first statement', async () => {
    TR.Debug.Reset()
    const schema = recordingSchema()
    TR.Debug.Configure({ actions: ['AddTwo'] })
    const first = nextEvent('paused')
    const pending = instrumented(schema).jsValue.invoke()
    await first
    Expect(TR.Debug.Paused()?.step.path).toBe('0')
    Expect(TR.Debug.Paused()?.pendingWrites).toHaveLength(0)
    TR.Debug.Continue()
    await pending
    Expect(notes(schema)).toBe(2)
  })

  Test('journals a failed root with its case', async () => {
    TR.Debug.Reset()
    const Failure = TR.Enum(identity('DebugFailure'), ['Rejected'])
    const stop = TR.Errors.onFailure(() => undefined)
    const failing = TR.Action(() => {
      TR.Fail(Failure['Rejected']!, 'No.')
    }, { name: 'Refuse' })
    await failing.jsValue.invoke()
    stop()
    const entry = TR.Debug.Journal().at(-1)
    Expect(entry?.action).toBe('Refuse')
    Expect(entry?.outcome).toBe('failed')
    Expect(entry?.failureCase).toBe('Rejected')
  })
})

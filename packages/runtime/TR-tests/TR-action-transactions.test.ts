import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { deferTransactionCommit, transactionResource } from '../TaoRuntime-src/TR-action-transactions'
import type {
  TaoDataConnection,
  TaoDataConnectionObserver,
  TaoDataSchemaDefinition,
} from '../TaoRuntime-src/TR-data'
import { onUnownedFailure } from '../TaoRuntime-src/TR-errors'

const definition: TaoDataSchemaDefinition = {
  name: 'TransactionalNotes',
  entities: {
    Note: {
      collection: 'Notes',
      fields: { Title: { kind: 'text' } },
    },
  },
}

function recordingSchema(): { saved: string[]; schema: ReturnType<typeof TR.Data.Schema> } {
  const saved: string[] = []
  const connection: TaoDataConnection = {
    load: () => undefined,
    save: snapshot => {
      saved.push(snapshot)
    },
  }
  return { saved, schema: TR.Data.Schema(definition, connection) }
}

Describe('Tao action transactions', () => {
  Test('lets a response root interrupt an ask and restores the suspended transaction', async () => {
    const { saved, schema } = recordingSchema()
    let respond!: () => void
    const answer = new Promise<void>(resolve => {
      respond = resolve
    })
    const asking = TR.Action(async () => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Before ask') })
      await answer
      TR.Data.Create(schema, 'Note', { Title: TR.Value('After ask') })
    }, { name: 'AskFirst' })
    const response = TR.Action(() => respond(), { interrupt: true, name: 'Respond' })

    const pending = asking.jsValue.invoke()
    Expect(response.jsValue.invoke()).toBeUndefined()
    await pending
    await TR.Data.Settle(schema)

    Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(2)
    Expect(saved).toHaveLength(1)
  })

  Test('settles a response only after its async interrupt transaction releases the asking transaction', async () => {
    const { saved, schema } = recordingSchema()
    let settleAnswer!: () => void
    let releaseResponse!: () => void
    const answer = new Promise<void>(resolve => {
      settleAnswer = resolve
    })
    const responseGate = new Promise<void>(resolve => {
      releaseResponse = resolve
    })
    let askingSettled = false
    const asking = TR.Action(async () => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Before ask') })
      await answer
      TR.Data.Create(schema, 'Note', { Title: TR.Value('After ask') })
      askingSettled = true
    }, { name: 'AskFirst' })
    const response = TR.Action(async () => {
      TR.Navigation.Respond({ response: { respond: settleAnswer } })
      await responseGate
    }, { interrupt: true, name: 'Respond' })

    const askingPending = asking.jsValue.invoke()
    const responsePending = response.jsValue.invoke()
    await Promise.resolve()
    Expect(askingSettled).toBe(false)

    releaseResponse()
    await responsePending
    await askingPending
    await TR.Data.Settle(schema)

    Expect(askingSettled).toBe(true)
    Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(2)
    Expect(saved).toHaveLength(1)
  })

  Test('commits one provider snapshot after read-your-writes succeeds', async () => {
    const { saved, schema } = recordingSchema()
    const seen: number[] = []
    const action = TR.Action(() => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Draft') })
      seen.push(schema.query({ entity: 'Note', filters: [] }).length)
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Ready') })
    }, { name: 'SaveNotes' })

    await action.jsValue.invoke()
    await TR.Data.Settle(schema)

    Expect(seen).toEqual([1])
    Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(2)
    Expect(saved).toHaveLength(1)
    Expect(saved[0]).toContain('Ready')
  })

  Test('rolls back a nested failure and skips the remaining caller block', async () => {
    const { saved, schema } = recordingSchema()
    const Failure = TR.Enum(['Rejected'])
    const reached: string[] = []
    const reports: unknown[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report))
    const inner = TR.Action(() => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Temporary') })
      Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(1)
      TR.Fail(Failure['Rejected']!, 'The note could not be saved.')
    }, { name: 'Inner' })
    const outer = TR.Action(async () => {
      await TR.Do(inner)
      reached.push('after-do')
    }, { name: 'Outer' })

    await outer.jsValue.invoke()
    stop()

    Expect(reached).toEqual([])
    Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(0)
    Expect(saved).toEqual([])
    Expect(reports).toEqual([Expect['objectContaining']({
      action: 'Outer',
      case: 'Rejected',
      frames: ['Outer', 'Inner'],
      message: 'The note could not be saved.',
      retryEligible: true,
    })])
  })

  Test('applies action deltas to a newer committed provider snapshot', async () => {
    const saved: string[] = []
    let observer: TaoDataConnectionObserver | undefined
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const schema = TR.Data.Schema(definition, {
      load: () => undefined,
      save: snapshot => {
        saved.push(snapshot)
      },
      subscribe: next => {
        observer = next
        return () => {}
      },
    })
    const action = TR.Action(async () => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Local') })
      await gate
    }, { name: 'MergeNote' })

    const pending = action.jsValue.invoke()
    observer?.snapshot(JSON.stringify({
      formatVersion: 1,
      nextId: 100,
      rows: { Note: [{ Id: 'Note-99', Title: 'Remote' }] },
      schemaVersion: 1,
    }))
    release()
    await pending
    await TR.Data.Settle(schema)

    const titles = schema.query({ entity: 'Note', filters: [] })
      .map(row => TR.Data.Read(row, 'Title'))
    Expect(titles).toEqual(['Remote', 'Local'])
    Expect(saved).toHaveLength(1)
  })

  Test('preflights every resource before publishing any transactional store', async () => {
    const firstSaved: string[] = []
    const secondSaved: string[] = []
    let secondObserver: TaoDataConnectionObserver | undefined
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const first = TR.Data.Schema({ ...definition, name: 'FirstNotes' }, {
      load: () => undefined,
      save: snapshot => {
        firstSaved.push(snapshot)
      },
    })
    const second = TR.Data.Schema({ ...definition, name: 'SecondNotes' }, {
      load: () => undefined,
      save: snapshot => {
        secondSaved.push(snapshot)
      },
      subscribe: observer => {
        secondObserver = observer
        return () => {}
      },
    })
    const failures: unknown[] = []
    const stop = TR.Errors.onFailure(failure => failures.push(failure))
    const action = TR.Action(async () => {
      TR.Data.Create(first, 'Note', { Title: TR.Value('First local') })
      TR.Data.Create(second, 'Note', { Title: TR.Value('Second local') })
      await gate
    }, { name: 'SaveBoth' })

    const pending = action.jsValue.invoke()
    secondObserver?.snapshot(JSON.stringify({
      formatVersion: 1,
      nextId: 2,
      rows: { Note: [{ Id: 'Note-1', Title: 'Remote collision' }] },
      schemaVersion: 1,
    }))
    release()
    await pending
    stop()

    Expect(first.query({ entity: 'Note', filters: [] })).toHaveLength(0)
    Expect(firstSaved).toEqual([])
    Expect(second.query({ entity: 'Note', filters: [] })).toHaveLength(1)
    Expect(secondSaved).toEqual([])
    Expect(failures).toHaveLength(1)
  })

  Test('rolls back resources already published when a later publish fails', async () => {
    const firstKey = {}
    const secondKey = {}
    let firstPublished = 'before'
    let secondPublished = 'before'
    const failures: unknown[] = []
    const stop = TR.Errors.onFailure(failure => failures.push(failure))
    const action = TR.Action(() => {
      transactionResource(
        firstKey,
        () => 'after',
        value => {
          firstPublished = value
        },
        undefined,
        () => {
          firstPublished = 'before'
        },
      )
      transactionResource(
        secondKey,
        () => 'after',
        value => {
          secondPublished = value
          throw new Error('second publish failed')
        },
        undefined,
        () => {
          secondPublished = 'before'
        },
      )
    }, { name: 'PublishBoth' })

    await action.jsValue.invoke()
    stop()

    Expect(firstPublished).toBe('before')
    Expect(secondPublished).toBe('before')
    Expect(failures).toHaveLength(1)
  })

  Test('isolates a post-commit effect failure and continues later post-commit cleanup', () => {
    const unowned: unknown[] = []
    const completed: string[] = []
    const stop = onUnownedFailure(error => unowned.push(error))
    try {
      const action = TR.Action(() => {
        deferTransactionCommit(() => {
          throw new Error('response publication failed')
        })
        deferTransactionCommit(() => completed.push('later effect'))
      }, { name: 'PostCommitEffects' })

      Expect(action.jsValue.invoke()).toBeUndefined()
      Expect(completed).toEqual(['later effect'])
      Expect(unowned).toHaveLength(1)
    } finally {
      stop()
    }
  })

  Test('uses the failure-message ladder and disables retry after a foreign effect', async () => {
    const Failure = TR.Enum(['Offline'])
    const reports: any[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report))
    const action = TR.ForeignAction(
      () => {
        throw { case: 'Offline' }
      },
      'Publish',
      [{ case: Failure['Offline']!, sentence: 'Publishing is unavailable.' }],
    )

    await action.jsValue.invoke(TR.Value({ password: 'private', title: 'Draft' }))
    stop()

    Expect(reports[0]).toEqual(Expect['objectContaining']({
      case: 'Offline',
      message: 'Publishing is unavailable.',
      retryEligible: false,
    }))
    Expect(reports[0].arguments[0].jsValue).toEqual({ title: 'Draft' })

    const unknown = TR.ForeignAction(
      () => {
        throw { case: 'Rejected' }
      },
      'Publish',
      [{ case: Failure['Offline']!, sentence: 'This sentence belongs only to Offline.' }],
    )
    const stopUnknown = TR.Errors.onFailure(report => reports.push(report))
    await unknown.jsValue.invoke()
    stopUnknown()

    Expect(reports[1]).toEqual(Expect['objectContaining']({
      case: 'Rejected',
      message: "Couldn't finish 'Publish.' Nothing was changed.",
      retryEligible: false,
    }))
  })

  Test('passes an omitted optional foreign argument across the boundary as undefined', async () => {
    const received: unknown[] = []
    const action = TR.ForeignAction(
      value => {
        received.push(value)
      },
      'OptionalEffect',
      [],
      { requiredArguments: 0 },
    )

    await action.jsValue.invoke(undefined)

    Expect(received).toEqual([undefined])
  })

  Test('reports a missing required foreign argument without calling the host implementation', async () => {
    const reports: any[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report))
    let calls = 0
    const action = TR.ForeignAction(
      (_required = 'host default') => {
        calls += 1
      },
      'RequiredEffect',
      [],
      { requiredArguments: 1 },
    )

    await action.jsValue.invoke()
    stop()

    Expect(calls).toBe(0)
    Expect(reports).toHaveLength(1)
    Expect(reports[0]).toMatchObject({
      action: 'RequiredEffect',
      message: "Foreign action 'RequiredEffect' is missing required argument 1 of 1.",
      retryEligible: true,
    })
  })

  Test('retains only the latest 50 redacted action failures for capture', () => {
    TR.Errors.reset()
    const stop = TR.Errors.onFailure(() => {})
    try {
      for (let index = 0; index < 55; index += 1) {
        TR.Action(() => {
          throw new Error(`failure ${index}`)
        }, { name: `Failure${index}` }).jsValue.invoke()
      }
      const history = TR.Errors.capture()
      Expect(history).toHaveLength(50)
      Expect(history[0]?.action).toBe('Failure5')
      Expect(history[49]?.action).toBe('Failure54')
    } finally {
      stop()
      TR.Errors.reset()
    }
  })

  Test('runs A then C while resolving superseded pending B as skipped', async () => {
    const calls: string[] = []
    const completions: string[] = []
    let releaseA!: () => void
    let startedA!: () => void
    const aGate = new Promise<void>(resolve => {
      releaseA = resolve
    })
    const aStarted = new Promise<void>(resolve => {
      startedA = resolve
    })
    const syncDraft = TR.ForeignAction(
      async (content: string) => {
        calls.push(content)
        if (content === 'A') {
          startedA()
          await aGate
        }
        completions.push(content)
      },
      'SyncDraft',
      [],
      { runs: 'latest' },
    )

    const a = syncDraft.jsValue.invoke(TR.Value('A'))
    await aStarted
    let bResolved = false
    const b = Promise.resolve(syncDraft.jsValue.invoke(TR.Value('B'))).then(() => {
      bResolved = true
    })
    const c = syncDraft.jsValue.invoke(TR.Value('C'))
    await Promise.resolve()
    Expect(bResolved).toBe(true)
    await b
    releaseA()
    await a
    await c

    Expect(calls).toEqual(['A', 'C'])
    Expect(completions).toEqual(['A', 'C'])
  })

  Test('keeps the newest invocation out of an older detached transaction and reports its failure', async () => {
    const Failure = TR.Enum(['Conflict'])
    const calls: string[] = []
    const reports: any[] = []
    let releaseA!: () => void
    let startedA!: () => void
    const aGate = new Promise<void>(resolve => {
      releaseA = resolve
    })
    const aStarted = new Promise<void>(resolve => {
      startedA = resolve
    })
    const stop = TR.Errors.onFailure(report => reports.push(report))
    const syncDraft = TR.ForeignAction(
      async (content: string) => {
        calls.push(content)
        if (content === 'A') {
          startedA()
          await aGate
        }
        if (content === 'C') {
          throw { caseName: 'Conflict' }
        }
      },
      'SyncDraft',
      [{ case: Failure['Conflict']!, sentence: 'This file changed under this edit.' }],
      { runs: 'latest' },
    )
    const launch = TR.Action(() => {
      TR.Async(async () => {
        await TR.Do(syncDraft, TR.Value('A'))
      })
    }, { name: 'Launch' })

    await launch.jsValue.invoke()
    await aStarted
    const b = syncDraft.jsValue.invoke(TR.Value('B'))
    const c = syncDraft.jsValue.invoke(TR.Value('C'))
    await b
    releaseA()
    await c
    for (let turn = 0; turn < 10 && reports.length === 0; turn += 1) {
      await Promise.resolve()
    }
    stop()

    Expect(calls).toEqual(['A', 'C'])
    Expect(reports).toEqual([Expect['objectContaining']({
      action: 'SyncDraft',
      case: 'Conflict',
      frames: ['SyncDraft'],
      message: 'This file changed under this edit.',
      retryEligible: false,
    })])
  })
})

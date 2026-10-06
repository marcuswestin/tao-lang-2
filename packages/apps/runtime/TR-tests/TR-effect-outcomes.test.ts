import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import {
  captureActionContinuation,
  deferTransactionCommit,
  resumeActionContinuation,
} from '../TaoRuntime-src/TR-action-transactions'
import type { TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'
import { runJoinedEffectOutcome, type TaoEffectContract } from '../TaoRuntime-src/TR-effect-outcomes'
import { actionExitOf, TaoActionFailure, UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'

const definition: TaoDataSchemaDefinition = {
  name: 'OutcomeNotes',
  entities: {
    Note: {
      collection: 'Notes',
      fields: { Title: { kind: 'text' } },
    },
  },
}

const ExportFailure = TR.Enum(
  TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'Outcomes', 'enum', 'ExportFailure']),
  ['Offline', 'TooLarge'],
)

const contract = { declared: ['Offline', 'TooLarge'], name: 'Export' }

function notesSchema(): { saved: string[]; schema: ReturnType<typeof TR.Data.Schema> } {
  const saved: string[] = []
  return {
    saved,
    schema: TR.Data.Schema(definition, {
      load: () => undefined,
      save: snapshot => {
        saved.push(snapshot)
      },
    }),
  }
}

function titles(schema: ReturnType<typeof TR.Data.Schema>): unknown[] {
  return schema.query({ entity: 'Note', filters: [] }).map(row => TR.Data.Read(row, 'Title'))
}

/** failingExport writes a note and then fails the way `mode` names, inside the caller's transaction. */
function failingExport(schema: ReturnType<typeof TR.Data.Schema>, mode: string): TR.Action<[]> {
  return TR.Action(async () => {
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Callee') })
    await Promise.resolve()
    if (mode === 'Offline' || mode === 'TooLarge') {
      TR.Fail(ExportFailure[mode]!, `${mode} sentence.`)
    }
    if (mode === 'throw') {
      TR.Errors.failHost('The disk went away.')
    }
  }, { name: 'Export' })
}

/** runOutcome invokes `callee` from a root that writes first, and records the outcome that ran. */
async function runOutcome(
  callee: (schema: ReturnType<typeof TR.Data.Schema>) => TR.Action<[]>,
  outcomeNames: readonly string[],
  effectContract: TaoEffectContract = contract,
): Promise<{ ran: string[]; reports: unknown[]; schema: ReturnType<typeof TR.Data.Schema>; tail: boolean }> {
  const { schema } = notesSchema()
  const ran: string[] = []
  const reports: unknown[] = []
  let tail = false
  const stop = TR.Errors.onFailure(report => reports.push(report))
  const root = TR.Action(async () => {
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Caller') })
    await TR.WhenDo(
      () => TR.Do(callee(schema)),
      effectContract,
      outcomeNames.map(name => [name, message => ran.push(`${name}: ${message.evaluate().jsValue}`)] as const),
    )
    tail = true
  }, { name: 'Root' })
  await root.jsValue.invoke()
  await TR.Data.Settle(schema)
  stop()
  return { ran, reports, schema, tail }
}

/** Canonical outcome tests keep root failures observable rather than letting the root consume them. */
async function joinedRoot(body: () => unknown): Promise<void> {
  const reports: unknown[] = []
  const stop = TR.Errors.onFailure(report => reports.push(report))
  try {
    await TR.Action(body, { name: 'JoinedRoot' }).jsValue.invoke()
  } finally {
    stop()
  }
  Expect(reports).toEqual([])
}

Describe('Tao effect outcomes', () => {
  Test('uses otherwise only after specific success and failure handlers', async () => {
    const rejected = await runOutcome(schema => failingExport(schema, 'Offline'), ['otherwise', 'rejected'])
    Expect(rejected.ran).toEqual(['rejected: Offline sentence.'])
    const fallback = await runOutcome(schema => failingExport(schema, 'Offline'), ['otherwise'])
    Expect(fallback.ran).toEqual(['otherwise: Offline sentence.'])
    const saved = await runOutcome(schema => failingExport(schema, 'none'), ['otherwise'])
    Expect(saved.ran).toEqual(['otherwise: '])
  })

  Test('runs saved after the verb finishes and keeps its writes', async () => {
    const { ran, reports, schema, tail } = await runOutcome(
      schema => failingExport(schema, 'none'),
      ['saved', 'rejected', 'error'],
    )
    Expect(ran).toEqual(['saved: '])
    Expect(tail).toBe(true)
    Expect(titles(schema)).toEqual(['Caller', 'Callee'])
    Expect(reports).toEqual([])
  })

  Test('rolls back the verb while the caller keeps its earlier write, and runs the named case', async () => {
    const { ran, reports, schema, tail } = await runOutcome(
      schema => failingExport(schema, 'Offline'),
      ['saved', 'Offline', 'rejected'],
    )
    Expect(ran).toEqual(['Offline: Offline sentence.'])
    Expect(tail).toBe(true)
    Expect(titles(schema)).toEqual(['Caller'])
    Expect(reports).toEqual([])
  })

  Test('lets rejected catch a declared case the site does not name, with its sentence', async () => {
    const { ran, schema } = await runOutcome(schema => failingExport(schema, 'TooLarge'), ['Offline', 'rejected'])
    Expect(ran).toEqual(['rejected: TooLarge sentence.'])
    Expect(titles(schema)).toEqual(['Caller'])
  })

  Test('routes a failure the verb never declared to error, and never to rejected', async () => {
    const { ran } = await runOutcome(schema => failingExport(schema, 'throw'), ['rejected', 'error'])
    Expect(ran).toEqual(['error: The disk went away.'])
  })

  Test('propagates an unhandled failure exactly as a plain do failure', async () => {
    const { ran, reports, schema, tail } = await runOutcome(
      schema => failingExport(schema, 'TooLarge'),
      ['saved', 'Offline', 'error'],
    )
    Expect(ran).toEqual([])
    Expect(tail).toBe(false)
    Expect(titles(schema)).toEqual([])
    Expect(reports).toEqual([Expect['objectContaining']({
      action: 'Root',
      case: 'TooLarge',
      frames: ['Root', 'Export'],
      message: 'TooLarge sentence.',
    })])
  })

  Test('restores a state overlay and drops a resource the verb touched first', async () => {
    const count = TR.Cell(TR.Value(0))
    const label = TR.Cell(TR.Value('before'))
    const seen: unknown[] = []
    const callee = TR.Action(() => {
      TR.Set(count, () => TR.Value(2))
      TR.Set(label, () => TR.Value('callee'))
      TR.Fail(ExportFailure['Offline']!, 'Offline sentence.')
    }, { name: 'Export' })
    const root = TR.Action(async () => {
      TR.Set(count, () => TR.Value(1))
      await TR.WhenDo(() => TR.Do(callee), contract, [[
        'rejected',
        () => seen.push(count.evaluate().jsValue, label.evaluate().jsValue),
      ]])
    }, { name: 'Root' })
    await root.jsValue.invoke()

    Expect(seen).toEqual([1, 'before'])
    Expect(count.evaluate().jsValue).toBe(1)
    Expect(label.evaluate().jsValue).toBe('before')
  })

  Test('drops a commit effect the rolled-back verb queued and keeps the caller one', async () => {
    const published: string[] = []
    const callee = TR.Action(() => {
      deferTransactionCommit(() => published.push('callee'))
      TR.Fail(ExportFailure['Offline']!, 'Offline sentence.')
    }, { name: 'Export' })
    const root = TR.Action(async () => {
      deferTransactionCommit(() => published.push('caller'))
      await TR.WhenDo(() => TR.Do(callee), contract, [['rejected', () => undefined]])
    }, { name: 'Root' })
    await root.jsValue.invoke()

    Expect(published).toEqual(['caller'])
  })

  Test('falls back to a message naming the verb when nothing says more', async () => {
    const seen: unknown[] = []
    const callee = TR.Action(() => {
      TR.Fail(ExportFailure['Offline']!, '')
    }, { name: 'Export' })
    const root = TR.Action(async () => {
      await TR.WhenDo(() => TR.Do(callee), contract, [[
        'Offline',
        message => seen.push(message.evaluate().jsValue),
      ]])
    }, { name: 'Root' })
    await root.jsValue.invoke()

    Expect(seen).toEqual(["Couldn't finish 'Export.' Nothing was changed."])
  })
  Test('reads any declared failure of a dynamic verb as rejected, and a throw as error', async () => {
    const seen: string[] = []
    const unknownContract = { declared: null, name: 'Callback' }
    const declaredFailure = TR.Action(() => {
      TR.Fail(ExportFailure['TooLarge']!, 'TooLarge sentence.')
    }, { name: 'Callback' })
    const thrown = TR.Action(() => {
      TR.Errors.failHost('The disk went away.')
    }, { name: 'Callback' })
    const root = TR.Action(async () => {
      for (const callee of [declaredFailure, thrown]) {
        await TR.WhenDo(() => TR.Do(callee), unknownContract, [
          ['rejected', message => seen.push(`rejected: ${message.evaluate().jsValue}`)],
          ['error', message => seen.push(`error: ${message.evaluate().jsValue}`)],
        ])
      }
    }, { name: 'Root' })
    await root.jsValue.invoke()

    Expect(seen).toEqual(['rejected: TooLarge sentence.', 'error: The disk went away.'])
  })

  Test('executes known and additional dynamic failures of an open named wrapper', async () => {
    const openContract = { declared: ['Offline'], open: true, name: 'Wrapper' }
    for (const mode of ['Offline', 'TooLarge', 'throw']) {
      const { ran, reports, schema, tail } = await runOutcome(
        schema => TR.Action(async () => await TR.Do(failingExport(schema, mode)), { name: 'Wrapper' }),
        ['Offline', 'rejected', 'error'],
        openContract,
      )
      const expected = mode === 'Offline'
        ? 'Offline: Offline sentence.'
        : mode === 'TooLarge'
        ? 'rejected: TooLarge sentence.'
        : 'error: The disk went away.'

      Expect(ran).toEqual([expected])
      Expect(reports).toEqual([])
      Expect(tail).toBe(true)
      Expect(titles(schema)).toEqual(['Caller'])
    }
  })

  Test('keeps a deliberate extra case an error when the contract is closed', async () => {
    const { ran } = await runOutcome(
      schema => failingExport(schema, 'TooLarge'),
      ['TooLarge', 'rejected', 'error'],
      { declared: ['Offline'], name: 'Export' },
    )

    Expect(ran).toEqual(['error: TooLarge sentence.'])
  })

  Test('never treats an arbitrary throw as a known Unexpected modeled failure', async () => {
    const { ran } = await runOutcome(
      schema => failingExport(schema, 'throw'),
      ['Unexpected', 'rejected', 'error'],
      { declared: ['Unexpected'], open: true, name: 'Export' },
    )

    Expect(ran).toEqual(['error: The disk went away.'])
  })

  Test('routes a raw foreign throw to error while restoring its savepoint', async () => {
    const { ran, reports, schema, tail } = await runOutcome(
      schema =>
        TR.ForeignAction(
          () => {
            TR.Data.Create(schema, 'Note', { Title: TR.Value('Foreign') })
            TR.Errors.failHost('The disk went away.')
          },
          'Publish',
          [],
        ),
      ['rejected', 'error'],
      { declared: [], open: true, name: 'Publish' },
    )

    Expect(reports).toEqual([])
    Expect(tail).toBe(true)
    Expect(titles(schema)).toEqual(['Caller'])
    Expect(ran).toEqual(['error: The disk went away.'])
  })

  Test('preserves a raw foreign throw through a named joined wrapper', async () => {
    const reached: string[] = []
    const { ran, reports, schema, tail } = await runOutcome(
      schema =>
        TR.Action(async () => {
          TR.Data.Create(schema, 'Note', { Title: TR.Value('Wrapper') })
          const publish = TR.ForeignAction(
            () => {
              TR.Data.Create(schema, 'Note', { Title: TR.Value('Foreign') })
              TR.Errors.failHost('The disk went away.')
            },
            'Publish',
            [],
          )
          await TR.Do(publish)
          reached.push('after publish')
        }, { name: 'Wrapper' }),
      ['rejected', 'error'],
      { declared: [], open: true, name: 'Wrapper' },
    )

    Expect(reached).toEqual([])
    Expect(reports).toEqual([])
    Expect(tail).toBe(true)
    Expect(titles(schema)).toEqual(['Caller'])
    Expect(ran).toEqual(['error: The disk went away.'])
  })

  Test('preserves a raw foreign throw through a joined result wrapper', async () => {
    const reached: string[] = []
    const { ran, reports, schema, tail } = await runOutcome(
      schema =>
        TR.Action(async () => {
          TR.Data.Create(schema, 'Note', { Title: TR.Value('Wrapper') })
          const read = TR.ForeignAction(
            () => {
              TR.Data.Create(schema, 'Note', { Title: TR.Value('Read') })
              TR.Errors.failHost('The disk went away.')
            },
            'Read',
            [],
          )
          await TR.DoResult<string>(read)
          reached.push('after read')
        }, { name: 'ReadAndDiscard' }),
      ['rejected', 'error'],
      { declared: [], open: true, name: 'ReadAndDiscard' },
    )

    Expect(reached).toEqual([])
    Expect(reports).toEqual([])
    Expect(tail).toBe(true)
    Expect(titles(schema)).toEqual(['Caller'])
    Expect(ran).toEqual(['error: The disk went away.'])
  })

  Test('routes actual typed provider cases including Unexpected to rejected in an open contract', async () => {
    const ProviderFailure = TR.Enum(
      TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'Outcomes', 'enum', 'ProviderFailure']),
      ['Offline', 'Unexpected'],
    )
    for (const caseName of ['Offline', 'Unexpected']) {
      const { ran, reports, schema, tail } = await runOutcome(
        schema =>
          TR.ForeignAction(
            () => {
              TR.Data.Create(schema, 'Note', { Title: TR.Value('Foreign') })
              throw { case: ProviderFailure[caseName]! }
            },
            'Publish',
            [],
          ),
        ['rejected', 'error'],
        { declared: ['Offline'], open: true, name: 'Publish' },
      )

      Expect(reports).toEqual([])
      Expect(tail).toBe(true)
      Expect(titles(schema)).toEqual(['Caller'])
      Expect(ran).toEqual(["rejected: Couldn't finish 'Publish.' Nothing was changed."])
    }
  })

  Test('handles a known case locally and propagates the open remainder to its caller', async () => {
    const locallyHandled: string[] = []
    const partial = (schema: ReturnType<typeof TR.Data.Schema>, mode: string): TR.Action<[]> =>
      TR.Action(async () => {
        TR.Data.Create(schema, 'Note', { Title: TR.Value('Wrapper') })
        await TR.WhenDo(
          () => TR.Do(failingExport(schema, mode)),
          { declared: ['Offline'], open: true, name: 'Export' },
          [['Offline', message => locallyHandled.push(message.evaluate().jsValue as string)]],
        )
      }, { name: 'Partial' })
    const handled = await runOutcome(schema => partial(schema, 'Offline'), ['saved'], {
      declared: [],
      open: true,
      name: 'Partial',
    })
    const propagated = await runOutcome(schema => partial(schema, 'TooLarge'), ['rejected'], {
      declared: [],
      open: true,
      name: 'Partial',
    })
    const unhandled = await runOutcome(schema => partial(schema, 'TooLarge'), ['saved'], {
      declared: [],
      open: true,
      name: 'Partial',
    })

    Expect(locallyHandled).toEqual(['Offline sentence.'])
    Expect(handled.ran).toEqual(['saved: '])
    Expect(titles(handled.schema)).toEqual(['Caller', 'Wrapper'])
    Expect(propagated.ran).toEqual(['rejected: TooLarge sentence.'])
    Expect(titles(propagated.schema)).toEqual(['Caller'])
    Expect(propagated.reports).toEqual([])
    Expect(unhandled.ran).toEqual([])
    Expect(unhandled.tail).toBe(false)
    Expect(titles(unhandled.schema)).toEqual([])
    Expect(unhandled.reports).toEqual([Expect['objectContaining']({
      action: 'Root',
      case: 'TooLarge',
      frames: ['Root', 'Partial', 'Export'],
    })])
  })

  Test('preserves joined result failure and savepoint rollback through an open wrapper', async () => {
    const { ran, reports, schema, tail } = await runOutcome(
      schema =>
        TR.Action(async () => {
          const read = TR.ForeignAction(
            async () => {
              TR.Data.Create(schema, 'Note', { Title: TR.Value('Read') })
              TR.Fail(ExportFailure['TooLarge']!, 'TooLarge sentence.')
            },
            'Read',
            [],
          )
          await TR.DoResult<string>(read)
          TR.Data.Create(schema, 'Note', { Title: TR.Value('After read') })
        }, { name: 'ReadAndDiscard' }),
      ['rejected', 'error'],
      { declared: [], open: true, name: 'ReadAndDiscard' },
    )

    Expect(ran).toEqual(['rejected: TooLarge sentence.'])
    Expect(reports).toEqual([])
    Expect(tail).toBe(true)
    Expect(titles(schema)).toEqual(['Caller'])
  })

  Test('contains a dynamic failure in detached work without rolling back its launcher', async () => {
    const { schema } = notesSchema()
    const ran: string[] = []
    const reports: unknown[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report))
    let finished!: () => void
    const committed = new Promise<void>(resolve => {
      finished = resolve
    })
    const root = TR.Action(() => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Caller') })
      TR.Async(async () => {
        TR.Data.Create(schema, 'Note', { Title: TR.Value('Detached') })
        await TR.WhenDo(
          () => TR.Do(failingExport(schema, 'TooLarge')),
          { declared: [], open: true, name: 'Callback' },
          [
            ['rejected', message => ran.push(message.evaluate().jsValue as string)],
            ['error', message => ran.push(`error: ${message.evaluate().jsValue}`)],
          ],
        )
        deferTransactionCommit(finished)
      })
    }, { name: 'Root' })
    try {
      await root.jsValue.invoke()
      await committed
      await TR.Data.Settle(schema)

      Expect(ran).toEqual(['TooLarge sentence.'])
      Expect(reports).toEqual([])
      Expect(titles(schema)).toEqual(['Caller', 'Detached'])
    } finally {
      stop()
    }
  })

  Test('never reuses the id of a row the rolled-back verb created', async () => {
    const { schema } = notesSchema()
    const ids = (): unknown[] => schema.query({ entity: 'Note', filters: [] }).map(row => TR.Data.Read(row, 'Id'))
    let calleeIds: unknown[] = []
    const callee = TR.Action(() => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Callee') })
      calleeIds = ids()
      TR.Fail(ExportFailure['Offline']!, 'Offline sentence.')
    }, { name: 'Export' })
    const root = TR.Action(async () => {
      await TR.WhenDo(() => TR.Do(callee), contract, [[
        'rejected',
        () => TR.Data.Create(schema, 'Note', { Title: TR.Value('Retry') }),
      ]])
    }, { name: 'Root' })
    await root.jsValue.invoke()
    await TR.Data.Settle(schema)

    Expect(titles(schema)).toEqual(['Retry'])
    Expect(calleeIds).toHaveLength(1)
    Expect(ids()[0]).not.toBe(calleeIds[0])
  })

  Test('drops the detached async work the rolled-back verb queued and keeps the caller work', async () => {
    const ran: string[] = []
    let finished!: () => void
    const last = new Promise<void>(resolve => {
      finished = resolve
    })
    const callee = TR.Action(() => {
      TR.Async(async () => {
        ran.push('callee')
      })
      TR.Fail(ExportFailure['Offline']!, 'Offline sentence.')
    }, { name: 'Export' })
    const root = TR.Action(async () => {
      TR.Async(async () => {
        ran.push('caller before')
      })
      await TR.WhenDo(() => TR.Do(callee), contract, [['rejected', () => undefined]])
      TR.Async(async () => {
        ran.push('caller after')
        finished()
      })
    }, { name: 'Root' })
    await root.jsValue.invoke()
    await last

    Expect(ran).toEqual(['caller before', 'caller after'])
  })

  Test('runs no outcome for a runs latest call a newer call superseded', async () => {
    const ran: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const sync = TR.ForeignAction(
      async (content: string) => {
        if (content === 'A') {
          await gate
        }
      },
      'Sync',
      [],
      { runs: 'latest' },
    )
    const outcomes = (label: string): TR.CaseBranch<unknown>[] => [
      ['saved', () => ran.push(`${label} saved`)],
      ['rejected', () => ran.push(`${label} rejected`)],
      ['error', () => ran.push(`${label} error`)],
    ]
    const running = sync.jsValue.invoke(TR.Value('A'))
    const superseded = TR.WhenDo(() => sync.jsValue.invoke(TR.Value('B')), contract, outcomes('B'))
    const newest = TR.WhenDo(() => sync.jsValue.invoke(TR.Value('C')), contract, outcomes('C'))
    await superseded
    release()
    await running
    await newest

    Expect(ran).toEqual(['C saved'])
  })
})

Describe('Tao canonical joined outcomes', () => {
  Test('forwards the actual joined result value to done without replacing its identity', async () => {
    const { saved, schema } = notesSchema()
    const read = TR.ForeignAction(
      () => {
        TR.Data.Create(schema, 'Note', { Title: TR.Value('Read') })
        return { Title: 'Result' }
      },
      'Read',
      [],
    )
    let result: TR.Value<{ Title: string }> | undefined
    await joinedRoot(async () => {
      const handled = await runJoinedEffectOutcome(
        async () => {
          result = await TR.DoResult<{ Title: string }>(read)
          return result
        },
        { name: 'Read', declared: [], open: true },
        [
          ['done', payload => {
            Expect(payload).toBe(result)
            Expect(TR.Member(result!, ['Title']).evaluate().jsValue).toBe('Result')
            TR.Data.Create(schema, 'Note', { Title: TR.Value('Handler') })
            return 'handled'
          }],
        ],
      )
      Expect(handled).toBe('handled')
    })
    await TR.Data.Settle(schema)

    Expect(titles(schema)).toEqual(['Read', 'Handler'])
    Expect(saved).toHaveLength(1)
  })

  Test('keeps synchronous done payload and handler results synchronous', async () => {
    const value = TR.Value('Actual result')
    const handled = { done: true }
    await joinedRoot(() => {
      const result = runJoinedEffectOutcome(() => value, { name: 'Sync', declared: [] }, [
        ['done', payload => {
          Expect(payload).toBe(value)
          return handled
        }],
      ])
      Expect(result).toBe(handled)
    })
  })

  Test('delivers a Message record to the named case before broad error and restores the savepoint', async () => {
    const { saved, schema } = notesSchema()
    const seen: string[] = []
    await joinedRoot(async () => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Caller') })
      await runJoinedEffectOutcome(() => TR.Do(failingExport(schema, 'Offline')), contract, [
        ['error', () => seen.push('broad error')],
        ['Offline', payload => {
          Expect(Object.isFrozen(payload)).toBe(true)
          Expect(TR.Member(TR.Value(payload), ['Message']).evaluate().jsValue).toBe('Offline sentence.')
          Expect(titles(schema)).toEqual(['Caller'])
          seen.push('named')
          TR.Data.Create(schema, 'Note', { Title: TR.Value('Handler') })
        }],
      ])
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Tail') })
    })
    await TR.Data.Settle(schema)

    Expect(seen).toEqual(['named'])
    Expect(titles(schema)).toEqual(['Caller', 'Handler', 'Tail'])
    Expect(saved).toHaveLength(1)
  })

  Test('uses broad error for known, additional modeled, and raw foreign failures', async () => {
    for (
      const [mode, declared] of [
        ['TooLarge', ['TooLarge']],
        ['TooLarge', []],
        ['foreign throw', []],
      ] as const
    ) {
      const { schema } = notesSchema()
      const seen: unknown[] = []
      const callee = mode === 'TooLarge' ? failingExport(schema, mode) : TR.ForeignAction(
        () => {
          TR.Data.Create(schema, 'Note', { Title: TR.Value('Foreign') })
          TR.Errors.failHost('The disk went away.')
        },
        'Export',
        [],
      )
      await joinedRoot(async () => {
        TR.Data.Create(schema, 'Note', { Title: TR.Value('Caller') })
        await runJoinedEffectOutcome(() => TR.Do(callee), { name: 'Export', declared }, [
          ['error', payload => seen.push(TR.Member(TR.Value(payload), ['Message']).evaluate().jsValue)],
        ])
        seen.push('tail')
      })
      await TR.Data.Settle(schema)

      Expect(seen).toEqual(mode === 'TooLarge' ? ['TooLarge sentence.', 'tail'] : ['The disk went away.', 'tail'])
      Expect(titles(schema)).toEqual(['Caller'])
    }
  })

  Test('joins an unawaited async done handler before draining lexical cleanup', async () => {
    const gate = Deferred()
    const started = Deferred()
    const { saved, schema } = notesSchema()
    const seen: string[] = []
    let pending: unknown
    const action = joinedRoot(() =>
      TR.ActionScope(() => {
        TR.Defer(() => {
          seen.push('cleanup')
          TR.Data.Create(schema, 'Note', { Title: TR.Value('Cleanup') })
        })
        pending = runJoinedEffectOutcome(() => TR.Value('result'), { name: 'Read', declared: [] }, [
          ['done', async () => {
            const continuation = captureActionContinuation()
            started.resolve()
            await gate.promise
            resumeActionContinuation(continuation)
            seen.push('handler')
            TR.Data.Create(schema, 'Note', { Title: TR.Value('Handler') })
            return 'handled'
          }],
        ])
        seen.push('body-end')
      })
    )
    await started.promise
    const beforeRelease = [...seen]
    const savedBeforeRelease = [...saved]
    gate.resolve()
    const settled = await Promise.allSettled([action, Promise.resolve(pending)])
    await TR.Data.Settle(schema)

    Expect(beforeRelease).toEqual(['body-end'])
    Expect(savedBeforeRelease).toEqual([])
    Expect(settled).toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: 'handled' },
    ])
    Expect(seen).toEqual(['body-end', 'handler', 'cleanup'])
    Expect(titles(schema)).toEqual(['Handler', 'Cleanup'])
    Expect(saved).toHaveLength(1)
  })

  Test('retains the original primary and all cleanup faults when no canonical failure arm handles them', async () => {
    const primary = Object.freeze(new TaoActionFailure('Offline', 'Offline sentence.'))
    const firstCleanup = new UnexpectedBehaviorError('First cleanup failed.')
    const lastCleanup = new UnexpectedBehaviorError('Last cleanup failed.')
    const { schema } = notesSchema()
    let caught: unknown
    let originalExit: unknown
    const callee = TR.Action(() => {
      try {
        return TR.ActionScope(() => {
          TR.Data.Create(schema, 'Note', { Title: TR.Value('Callee') })
          TR.Defer(() => {
            throw firstCleanup
          })
          TR.Defer(() => {
            throw lastCleanup
          })
          throw primary
        })
      } catch (error) {
        originalExit = error
        throw error
      }
    }, { name: 'Export' })
    await joinedRoot(async () => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Caller') })
      try {
        await runJoinedEffectOutcome(() => TR.Do(callee), contract, [['done', () => undefined]])
      } catch (error) {
        caught = error
      }
      Expect(titles(schema)).toEqual(['Caller'])
    })
    await TR.Data.Settle(schema)

    Expect(caught).toBe(originalExit)
    Expect(actionExitOf(caught)?.primary).toBe(primary)
    Expect(actionExitOf(caught)?.cleanupFailures).toEqual([lastCleanup, firstCleanup])
    Expect(actionExitOf(caught)?.stage).toBe('body')
    Expect(titles(schema)).toEqual(['Caller'])
  })
})

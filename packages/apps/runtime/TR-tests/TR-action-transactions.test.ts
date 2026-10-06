import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import {
  actionCancellationSignal,
  beginActionLaunch,
  cancelActionContinuation,
  captureActionContinuation,
  deferDetached,
  deferTransactionCommit,
  registerDeferredAction,
  resumeActionContinuation,
  runAction,
  runActionScope,
  settleActionRoots,
  type TaoActionContinuation,
  transactionResource,
} from '../TaoRuntime-src/TR-action-transactions'
import type {
  TaoDataConnection,
  TaoDataConnectionObserver,
  TaoDataSchemaDefinition,
} from '../TaoRuntime-src/TR-data'
import { onUnownedFailure, UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'

const definition: TaoDataSchemaDefinition = {
  name: 'TransactionalNotes',
  entities: {
    Note: {
      collection: 'Notes',
      fields: { Title: { kind: 'text' } },
    },
  },
}

function identity(name: string): TR.DeclarationIdentity {
  return TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'Transactions', 'enum', name])
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

/** A cooperative signal fixture proves root lifecycle, independently of the unpublished checked Wait leaf. */
function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!signal) {
      resolve()
    } else if (signal.aborted) {
      reject(signal.reason)
    } else {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }
  })
}

Describe('Tao action transactions', () => {
  Test('drains detached continuations and children without putting them in the foreground queue', async () => {
    const started = Deferred()
    const release = Deferred()
    const childStarted = Deferred()
    const childRelease = Deferred()
    await runAction('Launch', [], () => {
      deferDetached(async () => {
        const continuation = captureActionContinuation()
        started.resolve()
        await release.promise
        resumeActionContinuation(continuation)
        deferDetached(async () => {
          childStarted.resolve()
          await childRelease.promise
        })
      })
    })
    await started.promise
    let drained = false
    const drain = settleActionRoots().then(() => {
      drained = true
    })
    try {
      for (let turn = 0; turn < 10; turn++) {
        await Promise.resolve()
      }
      Expect(drained).toBe(false)
      release.resolve()
      await childStarted.promise
      for (let turn = 0; turn < 10; turn++) {
        await Promise.resolve()
      }
      Expect(drained).toBe(false)
    } finally {
      release.resolve()
      childRelease.resolve()
      await drain
    }
    Expect(drained).toBe(true)
  })

  Test('does not drain abandoned detached work into a replacement launch', async () => {
    const started = Deferred()
    const release = Deferred()
    const finished = Deferred()
    await runAction('Launch', [], () => {
      deferDetached(async () => {
        started.resolve()
        await release.promise
        finished.resolve()
      })
    })
    await started.promise
    try {
      beginActionLaunch()
      await settleActionRoots()
    } finally {
      release.resolve()
      await finished.promise
    }
  })

  Test('lets a foreground action release detached work while that work is suspended', async () => {
    const started = Deferred()
    const release = Deferred()
    const finished = Deferred()
    const events: string[] = []
    await runAction('Launch', [], () => {
      deferDetached(async () => {
        const continuation = captureActionContinuation()
        events.push('background starts')
        started.resolve()
        await release.promise
        resumeActionContinuation(continuation)
        events.push('background finishes')
        finished.resolve()
      })
    })
    await started.promise
    const foreground = runAction('Release', [], () => {
      events.push('foreground releases work')
      release.resolve()
    })
    try {
      for (let turn = 0; turn < 10; turn++) {
        await Promise.resolve()
      }
      Expect(events).toContain('foreground releases work')
    } finally {
      release.resolve()
      await foreground
      await finished.promise
      await settleActionRoots()
    }
    Expect(events).toEqual(['background starts', 'foreground releases work', 'background finishes'])
  })

  Test(
    'shares the actual root cancellation signal with joined work and gives detached roots their own signal',
    async () => {
      Expect(actionCancellationSignal()).toBeUndefined()
      const detachedFinished = Deferred()
      let parent: AbortSignal | undefined
      let joined: AbortSignal | undefined
      let detached: AbortSignal | undefined
      const child = TR.Action(() => {
        joined = actionCancellationSignal()
      }, { name: 'Joined' })
      await TR.Action(async () => {
        parent = actionCancellationSignal()
        await TR.Do(child)
        deferDetached(async () => {
          detached = actionCancellationSignal()
          detachedFinished.resolve()
        })
      }, { name: 'SignalRoot' }).jsValue.invoke()
      await detachedFinished.promise
      await settleActionRoots()

      Expect(parent).toBeDefined()
      Expect(joined).toBe(parent)
      Expect(detached).toBeDefined()
      Expect(detached).not.toBe(parent)
      Expect(detached?.aborted).toBe(false)
      Expect(actionCancellationSignal()).toBeUndefined()
      Expect(() => cancelActionContinuation({ transaction: {} })).toThrow()
    },
  )

  Test(
    'abandons and aborts all old live roots including an interrupted root and roots queued in the old launch',
    async () => {
      const cleanupGate = Deferred()
      const cleanupStarted = Deferred()
      const seen: string[] = []
      const receipts: string[] = []
      const reports: unknown[] = []
      const count = TR.Cell(TR.Value(0))
      let asking: AbortSignal | undefined
      let interrupting: AbortSignal | undefined
      let queued: AbortSignal | undefined
      let current: AbortSignal | undefined
      const stop = TR.Errors.onFailure(report => reports.push(report))
      const old = runAction(
        'OldRoot',
        [],
        () =>
          runActionScope(async () => {
            asking = actionCancellationSignal()
            asking?.addEventListener('abort', () => {
              seen.push(`abort old after ${receipts.join(',')}`)
            }, { once: true })
            registerDeferredAction(async () => {
              const continuation = captureActionContinuation()
              Expect(actionCancellationSignal()).toBeUndefined()
              seen.push('old cleanup start')
              cleanupStarted.resolve()
              await cleanupGate.promise
              resumeActionContinuation(continuation)
              TR.Set(count, () => TR.Value(999))
              seen.push('old cleanup finish')
            })
            TR.Set(count, () => TR.Value(1))
            await waitForAbort(asking)
            seen.push('old tail')
          }),
        false,
        false,
        undefined,
        receipt => receipts.push(`old ${receipt.outcome}`),
      )
      const oldQueued = runAction(
        'QueuedOldRoot',
        [],
        () =>
          runActionScope(async () => {
            queued = actionCancellationSignal()
            seen.push(`queued starts aborted ${queued?.aborted}`)
            await waitForAbort(queued)
            seen.push('queued tail')
          }),
        false,
        false,
        undefined,
        receipt => receipts.push(`queued ${receipt.outcome}`),
      )
      const interrupt = runAction(
        'InterruptRoot',
        [],
        () =>
          runActionScope(async () => {
            interrupting = actionCancellationSignal()
            await waitForAbort(interrupting)
            seen.push('interrupt tail')
          }),
        false,
        true,
        undefined,
        receipt => receipts.push(`interrupt ${receipt.outcome}`),
      )
      try {
        Expect(asking).toBeDefined()
        Expect(interrupting).toBeDefined()
        Expect(interrupting).not.toBe(asking)
        beginActionLaunch()
        await TR.Action(() => {
          current = actionCancellationSignal()
          TR.Set(count, () => TR.Value(10))
        }, { name: 'NewRoot' }).jsValue.invoke()
        await cleanupStarted.promise

        Expect(asking?.aborted).toBe(true)
        Expect(interrupting?.aborted).toBe(true)
        Expect(current?.aborted).toBe(false)
        Expect(current).not.toBe(asking)
        Expect(count.evaluate().jsValue).toBe(10)
        Expect(receipts).toEqual(['old abandoned', 'queued abandoned', 'interrupt abandoned'])
        Expect(seen).toEqual([
          'abort old after old abandoned,queued abandoned,interrupt abandoned',
          'old cleanup start',
        ])
      } finally {
        cleanupGate.resolve()
        await Promise.all([old, oldQueued, interrupt])
        stop()
      }

      Expect(queued?.aborted).toBe(true)
      Expect(seen).toEqual([
        'abort old after old abandoned,queued abandoned,interrupt abandoned',
        'old cleanup start',
        'old cleanup finish',
        'queued starts aborted true',
      ])
      Expect(receipts).toEqual(['old abandoned', 'queued abandoned', 'interrupt abandoned'])
      Expect(reports).toEqual([])
      Expect(count.evaluate().jsValue).toBe(10)
      Expect(actionCancellationSignal()).toBeUndefined()
    },
  )

  Test('cancels a live suspended continuation without cancelling its interrupt root', async () => {
    const interruptGate = Deferred()
    const reports: unknown[] = []
    let askingContinuation: TaoActionContinuation = {}
    let interruptContinuation: TaoActionContinuation = {}
    let asking: AbortSignal | undefined
    let interrupting: AbortSignal | undefined
    const stop = TR.Errors.onFailure(report => reports.push(report))
    const old = TR.Action(() =>
      runActionScope(async () => {
        askingContinuation = captureActionContinuation()
        asking = actionCancellationSignal()
        await waitForAbort(asking)
      }), { name: 'AskingRoot' }).jsValue.invoke()
    const interrupt = TR.Action(() =>
      runActionScope(async () => {
        interruptContinuation = captureActionContinuation()
        interrupting = actionCancellationSignal()
        await interruptGate.promise
        resumeActionContinuation(interruptContinuation)
        Expect(actionCancellationSignal()).toBe(interrupting)
      }), { name: 'InterruptRoot', interrupt: true }).jsValue.invoke()
    try {
      Expect(() =>
        cancelActionContinuation({
          transaction: askingContinuation.transaction,
          scope: interruptContinuation.scope,
        })
      ).toThrow()
      Expect(asking?.aborted).toBe(false)
      Expect(interrupting?.aborted).toBe(false)
      Expect(cancelActionContinuation(askingContinuation)).toBe(true)
      await old
      Expect(asking?.aborted).toBe(true)
      Expect(interrupting?.aborted).toBe(false)
    } finally {
      interruptGate.resolve()
      await Promise.all([old, interrupt])
      stop()
    }

    Expect(reports).toEqual([Expect['objectContaining']({
      action: 'AskingRoot',
      case: 'cancelled',
      message: 'Cancelled',
    })])
    Expect(actionCancellationSignal()).toBeUndefined()
  })

  // REMOVAL CANDIDATE: Async response-release coverage also preserves asking writes and one commit; this adds synchronous interrupt completion.
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
    const Failure = TR.Enum(identity('NestedFailure'), ['Rejected'])
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
          throw new UnexpectedBehaviorError('second publish failed')
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
          throw new UnexpectedBehaviorError('response publication failed')
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
    const Failure = TR.Enum(identity('ForeignFailure'), ['Offline'])
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
      for (let index = 0; index < 52; index += 1) {
        TR.Action(() => {
          throw new UnexpectedBehaviorError(`failure ${index}`)
        }, { name: `Failure${index}` }).jsValue.invoke()
      }
      const history = TR.Errors.capture()
      Expect(history).toHaveLength(50)
      Expect(history[0]?.action).toBe('Failure2')
      Expect(history[49]?.action).toBe('Failure51')
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
    const Failure = TR.Enum(identity('DetachedFailure'), ['Conflict'])
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
